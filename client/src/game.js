// 1 試合分のクライアント処理。
// - 自分の移動はクライアント側で即時反映し、サーバーへ位置を送る
// - ボールはサーバーの状態を基準に、共有の物理で「現在のサーバー時刻」まで先読みして表示する
// - 自分の打球はローカルで即座に反映し、サーバーがラグ補償つきで検証する
import * as THREE from 'three';
import {
  SHOT, DT, DT_MS, MOVE_SPEED, MOVE_ACCEL, SWING_WINDOW, KITCHEN, DIVE_RECOVER, forwardSign, sideOf,
} from '@shared/constants.js';
import {
  cloneRally, stepRally, hitBlockReason, applyHit, contactQuality, predictBounce, inCourt,
} from '@shared/rally.js';
import { clampPlayer } from '@shared/match.js';
import { rightSign, aimPoint } from '@shared/shot.js';
import { Chibi } from './characters.js';
import { makeBlob, makeRing } from './scene.js';
import { sfx } from './audio.js';
import { music } from './music.js';

const INTERP_TICKS = 6; // 相手の表示は 100ms 遅らせて補間する
const SEND_INTERVAL = 1000 / 30;
const HOLD_MAX_MS = 1200;

/** キャラクターモデルの向き (モデルは +z が正面) */
function baseRot(idx) {
  return idx === 0 ? Math.PI : 0;
}

/** 飛びつく向き (ボールに向かって最大 1.2m) */
function diveVec(ball, px, pz) {
  const dx = ball[0] - px;
  const dz = ball[2] - pz;
  const d = Math.hypot(dx, dz) || 1;
  const k = Math.min(1.2, Math.max(0, d - 0.6)) / d;
  return [dx * k, dz * k];
}

function swingKind(idx, ball, px) {
  if (ball[1] > 1.5) return 'oh';
  return (ball[0] - px) * rightSign(idx) >= -0.15 ? 'fh' : 'bh';
}

export class GameSession {
  /**
   * @param {object} p
   * @param {import('./scene.js').GameScene} p.scene
   * @param {import('./net.js').Connection} p.conn
   * @param {any} p.start
   * @param {import('./input.js').Input} p.input
   * @param {any} p.hud
   */
  constructor({ scene, conn, start, input, hud }) {
    this.scene = scene;
    this.conn = conn;
    this.input = input;
    this.hud = hud;
    this.you = start.you;
    this.opp = 1 - start.you;
    this.players = start.players;
    this.opts = start.opts;
    this.startTime = start.startTime;

    this.objects = [];
    this.chars = this.players.map((p, i) => {
      const ch = new Chibi(p.char);
      ch.root.rotation.y = baseRot(i);
      scene.scene.add(ch.root);
      const shadow = makeBlob(1.1, 0.8);
      const ring = makeRing(1.25, i === this.you ? 0x39a7ff : 0xff4d5e);
      scene.scene.add(shadow, ring);
      this.objects.push(ch.root, shadow, ring);
      ch.shadow = shadow;
      ch.ring = ring;
      return ch;
    });
    scene.setViewSide(this.you);
    scene.kitchenGlow.position.z = -forwardSign(this.you) * KITCHEN / 2;
    // 狙いマーカー (今の入力で打ったときの着地点)
    this.aimMark = makeRing(0.8, 0x39a7ff);
    this.aimMark.visible = false;
    scene.scene.add(this.aimMark);
    this.objects.push(this.aimMark);

    this.me = { x: 0, z: 0, vx: 0, vz: 0, ry: 0, rs: -1, recoverUntil: 0 };
    this.remote = { x: 0, z: 0, ry: 0, speed: 0, rs: -1 };
    this.remoteBuf = [];
    this.phase = 'serve';
    this.score = [0, 0];
    this.rallyInfo = null;
    this.sim = null; // {tick, rally}
    this.pendingHit = null;
    this.swingWin = null;
    this.serveSentAt = -1e9;
    this.lastSoundTick = -1;
    this.lastCheckTick = -1;
    this.visOff = new THREE.Vector3();
    this.lastSend = 0;
    this.lastSwingSeq = [-1, -1];
    this.lastEmoteSeq = [-1, -1];
    this.over = false;
    this.hintSeq = -1;
    this.landingKey = '';
    this.landingPos = null;
    this.ballDisp = new THREE.Vector3();
    this.tmpV = new THREE.Vector3();
    this.events = [];
    this.time = 0;

    hud.setPlayers(this.players[this.you], this.players[this.opp], this.opts);
    hud.setScore(0, 0, null);
  }

  estTick() {
    return (this.conn.serverNow() - this.startTime) / DT_MS;
  }

  // ---------- 受信 ----------
  handle(msg) {
    switch (msg.t) {
      case 's':
        this.onSnapshot(msg);
        break;
      case 'ev':
        this.onEvent(msg.e);
        break;
      case 'hitNo':
        this.pendingHit = null;
        break;
      case 'clock':
        this.startTime = msg.startTime;
        break;
      case 'rematch':
        this.hud.rematchStatus(msg.ready[this.you], msg.ready[this.opp]);
        break;
      case 'oppLeft':
        this.over = true;
        this.hud.oppLeft();
        break;
      default:
        break;
    }
  }

  onSnapshot(s) {
    this.phase = s.ph;
    this.score = s.sc;
    this.rallyInfo = s.b;
    const pm = s.pl[this.you];
    if (pm[3] !== this.me.rs) {
      this.me.rs = pm[3];
      this.me.x = pm[0];
      this.me.z = pm[1];
      this.me.vx = this.me.vz = 0;
    }
    const po = s.pl[this.opp];
    if (po[3] !== this.remote.rs) {
      this.remote.rs = po[3];
      this.remoteBuf.length = 0;
      this.remote.x = po[0];
      this.remote.z = po[1];
    }
    this.remoteBuf.push({ k: s.k, x: po[0], z: po[1], ry: po[2] });
    if (this.remoteBuf.length > 40) this.remoteBuf.shift();

    // 相手のスイング (構え)
    if (this.lastSwingSeq[this.opp] >= 0 && po[4] > this.lastSwingSeq[this.opp] && this.phase === 'rally') {
      this.chars[this.opp].ready(swingKind(this.opp, s.b.p, this.remote.x));
    }
    this.lastSwingSeq[this.opp] = po[4];
    // エモート
    for (const i of [0, 1]) {
      const pl = s.pl[i];
      if (this.lastEmoteSeq[i] >= 0 && pl[7] !== this.lastEmoteSeq[i] && i !== this.you) {
        this.chars[i].showEmote(pl[6]);
      }
      this.lastEmoteSeq[i] = pl[7];
    }

    // ボール
    if (this.pendingHit) {
      if (s.b.seq < this.pendingHit.seq && performance.now() < this.pendingHit.until) return;
      this.pendingHit = null;
    }
    this.setBase(s.k, s.b);
    this.hud.setScore(this.score[this.you], this.score[this.opp], this.phase === 'serve' || this.phase === 'rally' ? s.b.server === this.you : null);
  }

  setBase(tick, rally) {
    const hadBall = this.sim && this.sim.rally.active;
    const old = this.tmpV.copy(this.ballDisp);
    this.sim = { tick, rally: cloneRally(rally) };
    this.advanceSim(Math.floor(this.estTick()));
    if (hadBall && rally.active) {
      // 表示位置の飛びをなめらかに吸収する
      const np = this.ballRenderPos(new THREE.Vector3());
      const diff = old.sub(np);
      if (diff.length() < 4) this.visOff.copy(diff);
      else this.visOff.set(0, 0, 0);
    } else {
      this.visOff.set(0, 0, 0);
    }
  }

  advanceSim(target) {
    const sim = this.sim;
    if (!sim) return;
    if (target - sim.tick > 600) sim.tick = target - 600;
    while (sim.tick < target) {
      this.events.length = 0;
      stepRally(sim.rally, this.events);
      sim.tick++;
      if (sim.tick > this.lastSoundTick) {
        this.lastSoundTick = sim.tick;
        for (const e of this.events) {
          if (e.type === 'bounce') sfx.bounce();
          else if (e.type === 'net') sfx.net();
        }
      }
      if (sim.tick > this.lastCheckTick) {
        this.lastCheckTick = sim.tick;
        this.checkHit();
      }
    }
  }

  onEvent(e) {
    const hud = this.hud;
    switch (e.type) {
      case 'hit':
        if (e.by === this.opp) {
          const ball = this.sim ? this.sim.rally.p : [0, 1, 0];
          const kind = e.kind === 'serve' ? 'serve' : swingKind(this.opp, ball, this.remote.x);
          if (e.kind === 'dive') {
            const [wx, wz] = diveVec(ball, this.remote.x, this.remote.z);
            this.chars[this.opp].dive(wx, wz, kind);
          } else {
            this.chars[this.opp].strike(kind);
          }
          sfx.hit(e.kind, e.q);
        } else if (e.kind === 'serve') {
          sfx.hit('serve', 1);
        }
        break;
      case 'point': {
        const win = e.winner === this.you;
        const loser = 1 - e.winner;
        const who = loser === this.you ? 'あなた' : '相手';
        const reasonText = e.reason === '2バウンド' ? `${who}が返せなかった` : `${who}の${e.reason}`;
        let sub = reasonText;
        if (e.sideOut) sub += ' ・ サイドアウト';
        hud.message(win ? 'ポイント!' : '失点…', sub, win ? 'good' : 'bad');
        this.chars[e.winner].setMood('win');
        this.chars[loser].setMood('lose');
        if (win) sfx.win();
        else sfx.lose();
        hud.setScore(e.score[this.you], e.score[this.opp], null);
        break;
      }
      case 'serveReady': {
        const p = e.pos[this.you];
        this.me.x = p.x;
        this.me.z = p.z;
        this.me.rs = p.rs;
        this.me.vx = this.me.vz = 0;
        this.remoteBuf.length = 0;
        const po = e.pos[this.opp];
        this.remote.x = po.x;
        this.remote.z = po.z;
        this.remote.rs = po.rs;
        this.serveSentAt = -1e9;
        this.swingWin = null;
        this.me.recoverUntil = 0;
        const ss = this.score[e.server];
        const rs = this.score[1 - e.server];
        const call = `${ss} - ${rs}`;
        if (e.server === this.you) hud.message(call, 'あなたのサーブ', 'info', 1.4);
        else hud.message(call, '相手のサーブ', 'info', 1.4);
        break;
      }
      case 'gameOver': {
        this.over = true;
        const win = e.winner === this.you;
        this.chars[e.winner].setMood('win');
        music.stop(); // ファンファーレを目立たせる
        if (win) sfx.fanfare();
        else sfx.lose();
        setTimeout(() => hud.showResult(win, e.score[this.you], e.score[this.opp], this.conn.online), 900);
        break;
      }
      default:
        break;
    }
  }

  // ---------- 打球 ----------
  onPress(shot) {
    const now = performance.now();
    if (this.over) return;
    if (this.phase === 'serve' && this.rallyInfo && this.rallyInfo.server === this.you) {
      if (now - this.serveSentAt < 700) return;
      this.serveSentAt = now;
      const aim = this.input.getMove();
      this.conn.send({ t: 'srv', s: shot, ax: aim.x, ay: aim.y });
      this.chars[this.you].strike('serve');
      return;
    }
    if (this.phase !== 'rally') return;
    this.startSwing(shot, now);
  }

  /** 構える (この間にボールが打点に来たら打つ) */
  startSwing(shot, now, auto = false) {
    this.swingWin = { shot, until: now + SWING_WINDOW * 1000, maxUntil: now + HOLD_MAX_MS, auto };
    this.conn.send({ t: 'sw', s: shot });
    const ball = this.sim ? this.sim.rally.p : [this.me.x, 1, this.me.z];
    this.chars[this.you].ready(swingKind(this.you, ball, this.me.x));
  }

  /** 毎 tick: 構え中ならベストな打点で打つ */
  checkHit() {
    // オート打ち返し: 構えていなくても、打てる位置にボールが来たら最後に押したショットで構える
    if (!this.swingWin && this.input.autoHit && !this.over && this.phase === 'rally' && this.sim
      && performance.now() >= this.me.recoverUntil) {
      const r = this.sim.rally;
      const { x, z } = this.me;
      if (!hitBlockReason(r, this.you, x, z) || (this.diveNow(r) && !this.goingOut(r))) {
        this.startSwing(this.input.autoShot || SHOT.DRIVE, performance.now(), true);
      }
    }
    const sw = this.swingWin;
    if (!sw || this.phase !== 'rally' || !this.sim) return;
    if (performance.now() < this.me.recoverUntil) return;
    const r = this.sim.rally;
    const me = this.me;
    let reason = hitBlockReason(r, this.you, me.x, me.z);
    let dive = false;
    if (reason === 'reach' && !hitBlockReason(r, this.you, me.x, me.z, true)) {
      // 普通には届かない球: 飛びつけば届く範囲から出ていく直前まで待ってから飛びつく
      if (!this.diveNow(r)) return;
      if (sw.auto && this.goingOut(r)) return;
      dive = true;
      reason = null;
    }
    if ((reason === 'twobounce' || reason === 'kitchen') && this.hintSeq !== r.seq) {
      this.hintSeq = r.seq;
      this.hud.feedback(reason === 'twobounce' ? 'ツーバウンドルール! 1回バウンドさせよう' : 'キッチンではボレーできない!', 'warn');
    }
    if (reason) return;
    const q = contactQuality(r, me.x, me.z);
    if (!dive && q < 0.97) {
      // 次の tick の方が良い打点なら待つ
      const nxt = cloneRally(r);
      stepRally(nxt);
      if (!hitBlockReason(nxt, this.you, me.x, me.z) && contactQuality(nxt, me.x, me.z) > q + 1e-4) return;
    }
    const aim = this.input.getMove();
    const kind = swingKind(this.you, r.p, me.x);
    const [wx, wz] = diveVec(r.p, me.x, me.z);
    const res = applyHit(r, this.you, sw.shot, aim.x, aim.y, me.x, me.z, dive);
    this.conn.send({
      t: 'hit', k: this.sim.tick, s: sw.shot, ax: aim.x, ay: aim.y, x: me.x, z: me.z, q: r.seq, dv: dive ? 1 : 0,
    });
    this.pendingHit = { seq: r.seq, until: performance.now() + 700 };
    this.swingWin = null;
    sfx.hit(res.kind, res.quality);
    if (dive) {
      this.chars[this.you].dive(wx, wz, kind);
      me.recoverUntil = performance.now() + DIVE_RECOVER * 1000;
      me.vx = me.vz = 0;
      this.hud.feedback('ダイビング!', 'good');
      return;
    }
    this.chars[this.you].strike(kind);
    if (res.kind === 'smash') this.hud.feedback('スマッシュ!', 'good');
    else if (res.quality >= 0.97) this.hud.feedback('ナイスショット!', 'good');
    else if (res.quality < 0.6) this.hud.feedback('打点が悪い…', 'warn');
  }

  // ---------- 毎フレーム ----------
  update(dt) {
    this.time += dt;
    const now = performance.now();
    const est = this.estTick();
    const input = this.input;
    const me = this.me;

    // 移動
    const mv = input.getMove();
    const canMove = !this.over && this.phase !== 'gameOver' && now >= me.recoverUntil;
    const tvx = canMove ? mv.x * rightSign(this.you) * MOVE_SPEED : 0;
    const tvz = canMove ? mv.y * forwardSign(this.you) * MOVE_SPEED : 0;
    const a = MOVE_ACCEL * dt;
    me.vx += Math.max(-a, Math.min(a, tvx - me.vx));
    me.vz += Math.max(-a, Math.min(a, tvz - me.vz));
    const c = clampPlayer(this.you, me.x + me.vx * dt, me.z + me.vz * dt, this.phase, this.rallyInfo);
    me.x = c[0];
    me.z = c[1];
    me.ry += (-mv.x * 0.45 - me.ry) * Math.min(1, dt * 10);

    let press;
    while ((press = input.takePress())) this.onPress(press);
    const emo = input.takeEmote();
    if (emo >= 0) this.sendEmote(emo);

    // ボールを現在のサーバー時刻まで進める
    if (this.sim) this.advanceSim(Math.floor(est));

    // 構えの時間切れ (ボタンを押しっぱなしなら延長)
    const sw = this.swingWin;
    if (sw && now > sw.until && !(input.held.has(sw.shot) && now < sw.maxUntil)) {
      this.swingWin = null;
      const ball = this.sim ? this.sim.rally.p : [me.x, 1, me.z];
      this.chars[this.you].strike(swingKind(this.you, ball, me.x));
      sfx.swing();
    }

    // 位置送信
    if (now - this.lastSend > SEND_INTERVAL) {
      this.lastSend = now;
      this.conn.send({
        t: 'in', x: +me.x.toFixed(3), z: +me.z.toFixed(3), ry: +me.ry.toFixed(2), rs: me.rs,
      });
    }

    this.updateRemote(est, dt);
    this.render(dt, est);
    this.hud.ping(this.conn.online ? this.conn.rtt() : -1);
  }

  sendEmote(id) {
    this.conn.send({ t: 'emo', id });
    this.chars[this.you].showEmote(id);
  }

  updateRemote(est, dt) {
    const buf = this.remoteBuf;
    const rt = est - INTERP_TICKS;
    const r = this.remote;
    const px = r.x;
    const pz = r.z;
    if (buf.length) {
      let a = buf[0];
      let b = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].k <= rt && buf[i + 1].k >= rt) {
          a = buf[i];
          b = buf[i + 1];
          break;
        }
      }
      if (rt >= b.k) {
        r.x = b.x;
        r.z = b.z;
        r.ry = b.ry;
      } else if (rt <= a.k) {
        r.x = a.x;
        r.z = a.z;
        r.ry = a.ry;
      } else {
        const t = (rt - a.k) / (b.k - a.k);
        r.x = a.x + (b.x - a.x) * t;
        r.z = a.z + (b.z - a.z) * t;
        r.ry = a.ry + (b.ry - a.ry) * t;
      }
    }
    const sp = dt > 0 ? Math.hypot(r.x - px, r.z - pz) / dt : 0;
    r.speed += (Math.min(sp, MOVE_SPEED * 1.2) - r.speed) * Math.min(1, dt * 12);
  }

  /** 相手の打球の着地予想 (打球ごとに 1 回だけ計算) */
  landingOf(r) {
    const key = `${r.seq}`;
    if (key !== this.landingKey) {
      this.landingKey = key;
      this.landingPos = predictBounce(r);
    }
    return this.landingPos;
  }

  /** 飛びつけば届き、次の tick にはもう届かない (飛びつくなら今) */
  diveNow(r) {
    const me = this.me;
    if (hitBlockReason(r, this.you, me.x, me.z, true)) return false;
    const nxt = cloneRally(r);
    stepRally(nxt);
    return !!hitBlockReason(nxt, this.you, me.x + me.vx * DT, me.z + me.vz * DT, true);
  }

  /** 相手の打球がノーバウンドのままアウトになりそうか */
  goingOut(r) {
    if (r.bounces !== 0 || r.lastHitter !== this.opp) return false;
    const p = this.landingOf(r);
    return !!p && !inCourt(p.x, p.z);
  }

  ballRenderPos(out) {
    const r = this.sim.rally;
    const frac = Math.max(0, Math.min(1, this.estTick() - this.sim.tick));
    const t = frac * DT;
    return out.set(r.p[0] + r.v[0] * t, r.p[1] + r.v[1] * t, r.p[2] + r.v[2] * t);
  }

  render(dt) {
    const me = this.me;
    const rem = this.remote;
    const pos = [];
    pos[this.you] = [me.x, me.z, me.ry, Math.hypot(me.vx, me.vz)];
    pos[this.opp] = [rem.x, rem.z, rem.ry, rem.speed];
    this.chars.forEach((ch, i) => {
      const [x, z, ry, speed] = pos[i];
      ch.root.position.set(x, 0, z);
      ch.root.rotation.y = baseRot(i) + ry;
      ch.update(dt, speed);
      ch.shadow.position.set(x, 0.006, z);
      ch.ring.position.set(x, 0.009, z);
    });

    // ボール
    const sc = this.scene;
    const r = this.sim && this.sim.rally;
    if (this.phase === 'serve' && this.rallyInfo) {
      const hand = this.chars[this.rallyInfo.server].leftHandWorld(this.ballDisp);
      sc.setBall(hand.x, hand.y - 0.05, hand.z, true, 0);
      this.visOff.set(0, 0, 0);
    } else if (r && r.active && this.phase !== 'gameOver') {
      this.ballRenderPos(this.ballDisp);
      this.visOff.multiplyScalar(Math.exp(-dt * 12));
      this.ballDisp.add(this.visOff);
      const speed = Math.hypot(r.v[0], r.v[1], r.v[2]);
      sc.setBall(this.ballDisp.x, Math.max(this.ballDisp.y, 0.037), this.ballDisp.z, true, speed);
    } else {
      sc.setBall(0, 0, 0, false, 0);
    }

    // 着地予測マーカー (自分に向かってくるボールのみ)
    let showLanding = false;
    if (r && r.active && !r.fault && r.lastHitter === this.opp && r.bounces === 0 && this.phase === 'rally') {
      if (this.landingOf(r)) {
        showLanding = true;
        sc.landing.position.set(this.landingPos.x, 0.012, this.landingPos.z);
        const pulse = 1 + Math.sin(this.time * 10) * 0.08;
        sc.landing.scale.setScalar(pulse);
      }
    }
    sc.landing.visible = showLanding;

    // 狙いマーカー: 相手の打球が自分のほうに来ている間、今の入力で返したときの着地点を出す
    const mark = this.aimMark;
    const incoming = r && r.active && !r.fault && r.lastHitter === this.opp && this.phase === 'rally'
      && (sideOf(r.p[2]) === this.you || r.bounces === 0);
    if (incoming && !this.over) {
      const mv = this.input.getMove();
      const shot = this.swingWin ? this.swingWin.shot : this.input.autoHit ? this.input.autoShot : SHOT.DRIVE;
      const [ax, az] = aimPoint(this.you, shot, mv.x, mv.y, r.p[1]);
      mark.position.set(ax, 0.014, az);
      mark.material.opacity = this.swingWin ? 0.95 : 0.5;
      mark.scale.setScalar(this.swingWin ? 1 + Math.sin(this.time * 14) * 0.06 : 0.9);
      mark.visible = true;
    } else {
      mark.visible = false;
    }

    // キッチン警告: キッチン内にいて、ノーバウンドのボールが来ているとき
    let glow = 0;
    if (r && r.active && !r.fault && r.lastHitter === this.opp && r.bounces === 0 && Math.abs(me.z) < KITCHEN) {
      glow = 0.22 + Math.sin(this.time * 12) * 0.08;
    }
    sc.kitchenGlow.material.opacity = glow;

    sc.updateGameCamera(dt, me.x);
  }

  dispose() {
    for (const o of this.objects) this.scene.scene.remove(o);
    this.scene.setBall(0, 0, 0, false, 0);
    this.scene.landing.visible = false;
    this.scene.kitchenGlow.material.opacity = 0;
  }
}
