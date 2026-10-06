// CPU プレイヤー。Match を直接操作する (権威側でのみ動く)。
import {
  DT, MOVE_SPEED, KITCHEN, COURT_HALF_L, SHOT, DIVE_RECOVER, forwardSign, sideOf,
} from './constants.js';
import { cloneRally, stepRally, hitBlockReason, inReach } from './rally.js';
import { rightSign, shotKind } from './shot.js';
import { clampPlayer } from './match.js';

// 強さの設定。speed: 移動速度の倍率 / reaction: 反応までの tick 数 / aimNoise: 狙いのブレ
// posNoise: 立ち位置のブレ / whiff: 空振りの確率 / netRush: ネットに詰める確率 / dive: 飛びつくか
// lowDrive: 低い球でも強打してしまう割合
// drive: 強打を選ぶ割合の倍率 (弱い CPU は速い球をあまり打たない)
const LEVELS = [
  { speed: 0.62, reaction: 20, aimNoise: 0.6, aimMax: 1.0, posNoise: 0.6, whiff: 0.12, netRush: 0.25, dive: false, lowDrive: 1, drive: 0.45 },
  { speed: 0.78, reaction: 14, aimNoise: 0.45, aimMax: 0.95, posNoise: 0.46, whiff: 0.06, netRush: 0.5, dive: true, lowDrive: 0.5, drive: 0.8 },
  { speed: 0.9, reaction: 9, aimNoise: 0.32, aimMax: 0.9, posNoise: 0.38, whiff: 0.03, netRush: 0.8, dive: true, lowDrive: 0.15, drive: 1 },
];

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function pick(weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let x = Math.random() * total;
  for (const k in weights) {
    x -= weights[k];
    if (x <= 0) return k;
  }
  return SHOT.DRIVE;
}

export class Bot {
  /**
   * @param {number} idx
   * @param {number} level 0:かんたん 1:ふつう 2:むずかしい
   */
  constructor(idx, level = 1) {
    this.idx = idx;
    this.level = level;
    this.cfg = LEVELS[Math.max(0, Math.min(2, level))];
    this.planSeq = -1;
    this.plan = null;
    this.seqSeenTick = 0;
    this.serveDelay = rand(1.0, 1.8);
    this.rushNet = false;
    this.recoverUntil = -1;
  }

  /** @param {import('./match.js').Match} m */
  update(m) {
    const pl = m.players[this.idx];
    const r = m.rally;
    let tx = pl.x;
    let tz = pl.z;
    const f = forwardSign(this.idx);
    // 飛びついたあとは起き上がるまで動けない
    if (m.phase === 'rally' && m.tick < this.recoverUntil) return;

    if (m.phase === 'serve') {
      this.plan = null;
      this.rushNet = false;
      if (r.server === this.idx) {
        if (m.phaseTime > this.serveDelay) {
          const shot = pick({ [SHOT.DRIVE]: 5, [SHOT.SOFT]: 3, [SHOT.LOB]: 1 });
          m.serve(this.idx, shot, rand(-0.8, 0.8), rand(-0.6, 0.6));
          this.serveDelay = rand(1.0, 1.8);
        }
        return;
      }
      tx = pl.x;
      tz = pl.z;
    } else if (m.phase === 'rally' && !r.fault && r.lastHitter !== this.idx && r.active) {
      if (this.planSeq !== r.seq) {
        this.planSeq = r.seq;
        this.seqSeenTick = m.tick;
        this.plan = this.makePlan(m);
        this.whiff = Math.random() < this.cfg.whiff;
      }
      if (m.tick - this.seqSeenTick < this.cfg.reaction) return;
      if (this.plan) {
        tx = this.plan.x;
        tz = this.plan.z;
      }
      // 打てるなら打つ
      const st = m.stats[this.idx];
      if (!this.whiff && hitBlockReason(r, this.idx, pl.x, pl.z, false, st) === null) {
        const due = !this.plan || m.tick >= this.plan.tick - 1 || !this.willStayInReach(r, pl, false, st);
        if (due) this.doHit(m, pl);
      } else if (!this.whiff && this.cfg.dive && hitBlockReason(r, this.idx, pl.x, pl.z, true, st) === null
        && !this.willStayInReach(r, pl, true, st)) {
        // 間に合わない: 届く範囲から出ていく直前に飛びつく
        this.doHit(m, pl, true);
        this.recoverUntil = m.tick + Math.round((DIVE_RECOVER * st.recover) / DT);
        return;
      }
    } else if (m.phase === 'rally') {
      // 自分が打った後はホームポジションへ
      const myHits = r.lastHitter === this.idx;
      const receiverSide = r.server !== this.idx;
      if (myHits && (r.hitCount >= 3 || (receiverSide && r.hitCount >= 2))) {
        if (this.planSeq !== -2 - r.seq) {
          this.planSeq = -2 - r.seq;
          if (!this.rushNet) this.rushNet = Math.random() < this.cfg.netRush;
        }
      }
      const depth = this.rushNet ? KITCHEN + 0.45 : COURT_HALF_L - 0.1;
      tx = r.p[0] * 0.35;
      tz = -f * depth;
    } else {
      tx = 0;
      tz = -f * (COURT_HALF_L - 0.5);
    }

    this.moveToward(m, pl, tx, tz);
  }

  willStayInReach(r, pl, dive, st) {
    const s = cloneRally(r);
    stepRally(s);
    stepRally(s);
    return inReach(s, this.idx, pl.x, pl.z, dive, st) && s.bounces < 2;
  }

  moveToward(m, pl, tx, tz) {
    const dx = tx - pl.x;
    const dz = tz - pl.z;
    const d = Math.hypot(dx, dz);
    const step = MOVE_SPEED * this.cfg.speed * m.stats[this.idx].speed * DT;
    let nx = tx;
    let nz = tz;
    if (d > step) {
      nx = pl.x + (dx / d) * step;
      nz = pl.z + (dz / d) * step;
    }
    const c = clampPlayer(this.idx, nx, nz, m.phase, m.rally);
    pl.x = c[0];
    pl.z = c[1];
    pl.ry = d > 0.05 ? Math.max(-0.6, Math.min(0.6, (dx / Math.max(d, 1e-6)) * 0.6)) : 0;
  }

  /** ボールの軌道を先読みして、間に合う打点を探す */
  makePlan(m) {
    const r = cloneRally(m.rally);
    const pl = m.players[this.idx];
    const st = m.stats[this.idx];
    const speed = MOVE_SPEED * this.cfg.speed * st.speed;
    const f = forwardSign(this.idx);
    const reactT = this.cfg.reaction * DT;
    let best = null;
    let bestLate = Infinity;
    // 立ち位置のブレ (打点が理想からずれると当たりが悪くなる)
    const side = 0.62 + rand(-1, 1) * this.cfg.posNoise;
    const back = 0.1 + rand(-1, 1) * this.cfg.posNoise * 0.6;
    for (let t = 1; t <= 200; t++) {
      stepRally(r);
      if (r.fault || r.bounces >= 2) break;
      if (sideOf(r.p[2]) !== this.idx) continue;
      if (r.bounces === 0 && r.hitCount <= 2) continue;
      const y = r.p[1];
      if (y < 0.2 || y > 2.2) continue;
      // ボールを利き手側 (右) に置く位置に立つ
      const sx = r.p[0] - rightSign(this.idx) * side * st.reach;
      const sz = r.p[2] - f * back * st.reach;
      if (r.bounces === 0 && Math.abs(sz) < KITCHEN + 0.05) continue;
      const need = Math.hypot(sx - pl.x, sz - pl.z) / speed + reactT;
      const late = need - t * DT;
      // 腰の高さを好む
      const pref = y > 0.45 && y < 1.4 ? 0 : 0.12;
      if (late + pref < 0) return { tick: m.tick + t, x: sx, z: sz };
      if (late < bestLate) {
        bestLate = late;
        best = { tick: m.tick + t, x: sx, z: sz };
      }
    }
    return best;
  }

  doHit(m, pl, dive = false) {
    const r = m.rally;
    const opp = m.players[1 - this.idx];
    const myDepth = Math.abs(pl.z);
    const oppDepth = Math.abs(opp.z);
    // 低い球の強打は浮いてしまうので、強い CPU ほど避ける
    const d = this.cfg.drive * (shotKind(SHOT.DRIVE, r.p) === 'pop' ? this.cfg.lowDrive : 1);
    let shot;
    if (r.p[1] > 1.5) shot = SHOT.DRIVE;
    else if (r.hitCount === 2 && myDepth > 4.5) shot = pick({ [SHOT.SOFT]: 5, [SHOT.DRIVE]: 4 * d, [SHOT.LOB]: 1 });
    else if (myDepth < 3.6 && oppDepth < 3.6) shot = pick({ [SHOT.SOFT]: 6, [SHOT.DRIVE]: 3 * d, [SHOT.LOB]: 1 });
    else if (oppDepth < 3.6) shot = pick({ [SHOT.LOB]: 2, [SHOT.SOFT]: 4, [SHOT.DRIVE]: 4 * d });
    else shot = pick({ [SHOT.DRIVE]: 6 * d, [SHOT.SOFT]: 2, [SHOT.LOB]: 1.5 });

    // 相手のいない側を狙う (自分視点の左右に変換)
    const oppViewX = opp.x * rightSign(this.idx);
    let aimX = -Math.sign(oppViewX || (Math.random() - 0.5)) * this.cfg.aimMax * rand(0.4, 1);
    aimX += rand(-1, 1) * this.cfg.aimNoise;
    const aimY = rand(-0.5, 0.5) + rand(-1, 1) * this.cfg.aimNoise * 0.5;
    m.hit(this.idx, m.tick, shot, aimX, aimY, pl.x, pl.z, dive);
  }
}
