// 1 試合分の権威ロジック。サーバー (オンライン) とブラウザ内 (CPU 戦) の両方で動く。
import {
  DT, COURT_HALF_W, COURT_HALF_L, PLAYER_BOUNDS_X, PLAYER_BOUNDS_Z, PLAYER_NET_GAP,
  MAX_REWIND_TICKS, POINT_GRACE_TICKS, POINT_OVER_SEC, SERVE_TIMEOUT_SEC, SHOT, MOVE_SPEED,
  forwardSign,
} from './constants.js';
import {
  createRally, cloneRally, stepRally, hitBlockReason, applyHit, applyServe, resetForServe,
} from './rally.js';
import { rightSign } from './shot.js';

/** プレイヤー idx のベースライン上の z */
export function baselineZ(idx) {
  return -forwardSign(idx) * COURT_HALF_L;
}

/** サーブ時にサーバーが立つべき左右の符号 (ワールド x) */
export function serveSideSign(idx, serveRight) {
  return rightSign(idx) * (serveRight ? 1 : -1);
}

/**
 * プレイヤーの移動範囲を制限する。サーブ前のサーバーはベースラインの後ろ・正しいサイドに限定。
 * @returns {number[]} [x, z]
 */
export function clampPlayer(idx, x, z, phase, rally) {
  const f = forwardSign(idx);
  // 自陣側の z (正の値) に変換して制限
  let d = -z * f;
  d = Math.max(PLAYER_NET_GAP, Math.min(PLAYER_BOUNDS_Z, d));
  x = Math.max(-PLAYER_BOUNDS_X, Math.min(PLAYER_BOUNDS_X, x));
  if (phase === 'serve' && rally && rally.server === idx) {
    d = Math.max(d, COURT_HALF_L + 0.15);
    const s = serveSideSign(idx, rally.serveRight);
    const sx = Math.max(0.15, Math.min(COURT_HALF_W - 0.1, x * s));
    x = sx * s;
  }
  return [x, -d * f];
}

function makePlayer(idx) {
  return {
    x: 0,
    z: baselineZ(idx) - forwardSign(idx) * 0.5,
    ry: 0,
    rs: 0, // 位置リセット番号 (古い入力を無視するため)
    swingSeq: 0,
    swingShot: SHOT.DRIVE,
    emote: 0,
    emoteSeq: 0,
    moveBudget: MOVE_BUDGET_MAX, // クライアント申告の移動量の上限 (ワープ対策)
  };
}

const MOVE_BUDGET_MAX = 1.5;
const MOVE_BUDGET_RATE = MOVE_SPEED * 1.25;

export class Match {
  /**
   * @param {{pointsToWin?: number, scoring?: 'rally'|'sideout'}} opts
   */
  constructor(opts = {}) {
    this.pointsToWin = opts.pointsToWin ?? 11;
    this.scoring = opts.scoring === 'sideout' ? 'sideout' : 'rally';
    this.tick = 0;
    this.players = [makePlayer(0), makePlayer(1)];
    this.score = [0, 0];
    this.phase = 'serve';
    this.phaseTime = 0;
    this.winner = -1;
    this.rally = createRally(0, true);
    /** @type {{tick: number, rally: object}[]} */
    this.history = [];
    /** @type {{loser: number, reason: string, finalizeTick: number}|null} */
    this.pending = null;
    /** 送信待ちのイベント */
    this.events = [];
    this.setupServe(0);
  }

  setupServe(server) {
    const serveRight = this.score[server] % 2 === 0;
    resetForServe(this.rally, server, serveRight);
    const receiver = 1 - server;
    const sx = serveSideSign(server, serveRight);
    const rx = serveSideSign(receiver, serveRight);
    const ps = this.players[server];
    const pr = this.players[receiver];
    ps.x = sx * 1.4;
    ps.z = baselineZ(server) - forwardSign(server) * 0.5;
    pr.x = rx * 1.4;
    pr.z = baselineZ(receiver) - forwardSign(receiver) * 0.6;
    ps.rs++;
    pr.rs++;
    ps.moveBudget = pr.moveBudget = MOVE_BUDGET_MAX;
    this.rally.p = [ps.x, 0.9, ps.z];
    this.phase = 'serve';
    this.phaseTime = 0;
    this.pending = null;
    this.history.length = 0;
    this.events.push({
      type: 'serveReady',
      server,
      serveRight,
      pos: this.players.map((p) => ({ x: p.x, z: p.z, rs: p.rs })),
    });
  }

  /** クライアントから届いた位置を反映する */
  setPlayerInput(idx, x, z, ry, rs) {
    const pl = this.players[idx];
    if (rs !== pl.rs) return;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const c = clampPlayer(idx, x, z, this.phase, this.rally);
    // 移動速度の上限を超える分は切り詰める
    let dx = c[0] - pl.x;
    let dz = c[1] - pl.z;
    const d = Math.hypot(dx, dz);
    if (d > pl.moveBudget) {
      dx *= pl.moveBudget / d;
      dz *= pl.moveBudget / d;
    }
    pl.moveBudget -= Math.min(d, pl.moveBudget);
    pl.x += dx;
    pl.z += dz;
    pl.ry = Number.isFinite(ry) ? ry : 0;
  }

  swing(idx, shot) {
    const pl = this.players[idx];
    pl.swingSeq++;
    pl.swingShot = shot;
  }

  emote(idx, id) {
    const pl = this.players[idx];
    pl.emote = id;
    pl.emoteSeq++;
  }

  /** サーブを打つ */
  serve(idx, shot, aimX, aimY) {
    if (this.phase !== 'serve' || this.rally.server !== idx) return false;
    if (this.phaseTime < 0.5) return false;
    const pl = this.players[idx];
    const c = clampPlayer(idx, pl.x, pl.z, this.phase, this.rally);
    pl.x = c[0];
    pl.z = c[1];
    const res = applyServe(this.rally, shot, aimX, aimY, pl.x, pl.z);
    this.phase = 'rally';
    this.phaseTime = 0;
    this.history.length = 0;
    this.history.push({ tick: this.tick, rally: cloneRally(this.rally) });
    this.swing(idx, shot);
    this.events.push({ type: 'hit', by: idx, kind: res.kind, q: 1, tick: this.tick });
    return true;
  }

  /**
   * ラグ補償つきの打球。atTick 時点のボールで判定し、現在まで再シミュレーションする。
   * @returns {string|null} 失敗理由。成功なら null
   */
  hit(idx, atTick, shot, aimX, aimY, px, pz) {
    if (this.phase !== 'rally') return 'phase';
    if (![atTick, aimX, aimY, px, pz].every(Number.isFinite)) return 'bad';
    const pl = this.players[idx];
    // クライアントが申告した位置がサーバーの把握している位置と大きくずれていたら拒否
    if (Math.hypot(px - pl.x, pz - pl.z) > 1.6) return 'pos';
    const c = clampPlayer(idx, px, pz, this.phase, this.rally);
    px = c[0];
    pz = c[1];

    atTick = Math.max(this.tick - MAX_REWIND_TICKS, Math.min(this.tick, Math.round(atTick)));
    let base = null;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].tick <= atTick) {
        base = this.history[i];
        break;
      }
    }
    if (!base) return 'history';
    const r = cloneRally(base.rally);
    const reason = hitBlockReason(r, idx, px, pz);
    if (reason) return reason;

    const res = applyHit(r, idx, shot, aimX, aimY, px, pz);
    // 履歴を巻き戻して再シミュレーション
    while (this.history.length && this.history[this.history.length - 1].tick >= base.tick) {
      this.history.pop();
    }
    this.history.push({ tick: base.tick, rally: cloneRally(r) });
    this.pending = null;
    for (let t = base.tick + 1; t <= this.tick; t++) {
      stepRally(r);
      this.history.push({ tick: t, rally: cloneRally(r) });
      if (r.fault && !this.pending) {
        this.pending = { ...r.fault, finalizeTick: t + POINT_GRACE_TICKS };
      }
    }
    this.rally = r;
    this.swing(idx, shot);
    this.events.push({ type: 'hit', by: idx, kind: res.kind, q: res.quality, tick: base.tick });
    return null;
  }

  step() {
    this.tick++;
    this.phaseTime += DT;
    for (const pl of this.players) {
      pl.moveBudget = Math.min(MOVE_BUDGET_MAX, pl.moveBudget + MOVE_BUDGET_RATE * DT);
    }
    switch (this.phase) {
      case 'serve':
        if (this.phaseTime > SERVE_TIMEOUT_SEC) {
          this.serve(this.rally.server, SHOT.DRIVE, 0, 0);
        }
        break;
      case 'rally': {
        stepRally(this.rally);
        this.history.push({ tick: this.tick, rally: cloneRally(this.rally) });
        while (this.history.length > MAX_REWIND_TICKS + 4) this.history.shift();
        if (this.rally.fault && !this.pending) {
          this.pending = { ...this.rally.fault, finalizeTick: this.tick + POINT_GRACE_TICKS };
        }
        if (this.pending && this.tick >= this.pending.finalizeTick) this.finalizePoint();
        break;
      }
      case 'pointOver':
        stepRally(this.rally);
        if (this.phaseTime >= POINT_OVER_SEC) {
          if (this.winner >= 0) {
            this.phase = 'gameOver';
            this.phaseTime = 0;
            this.events.push({ type: 'gameOver', winner: this.winner, score: [...this.score] });
          } else {
            this.setupServe(this.rally.server);
          }
        }
        break;
      default:
        break;
    }
  }

  finalizePoint() {
    const { loser, reason } = this.pending;
    this.pending = null;
    const winner = 1 - loser;
    const server = this.rally.server;
    let scored = true;
    let nextServer = server;
    if (this.scoring === 'rally') {
      this.score[winner]++;
      nextServer = winner;
    } else if (winner === server) {
      this.score[winner]++;
    } else {
      scored = false;
      nextServer = winner;
    }
    // 次のサーバーを記録 (setupServe で使う)
    this.rally.server = nextServer;
    const w = this.score[winner];
    if (w >= this.pointsToWin && w - this.score[loser] >= 2) this.winner = winner;
    this.phase = 'pointOver';
    this.phaseTime = 0;
    this.events.push({
      type: 'point',
      winner,
      reason,
      scored,
      sideOut: !scored,
      score: [...this.score],
      nextServer,
    });
  }

  snapshot() {
    return {
      t: 's',
      k: this.tick,
      ph: this.phase,
      sc: this.score,
      b: this.rally,
      pl: this.players.map((p) => [
        p.x, p.z, p.ry, p.rs, p.swingSeq, p.swingShot, p.emote, p.emoteSeq,
      ]),
    };
  }
}
