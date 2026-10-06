// ラリー状態 (ボール物理 + バウンド数などのルール判定)。
// サーバーは権威として、クライアントは予測表示のために同じ関数を毎 tick 実行する。
import {
  DT, BALL_R, GRAVITY, BOUNCE_RESTITUTION, BOUNCE_FRICTION,
  COURT_HALF_W, COURT_HALF_L, KITCHEN, NET_HALF_W,
  REACH, REACH_MIN_Y, REACH_MAX_Y, DIVE_REACH, DIVE_QUALITY,
  forwardSign, sideOf, netHeightAt,
} from './constants.js';
import { computeShot, computeServe, servePosition, rightSign } from './shot.js';
import { BASE_STATS } from './stats.js';

/**
 * @typedef {Object} Rally
 * @property {boolean} active ボールがインプレーか
 * @property {number[]} p
 * @property {number[]} v
 * @property {number} hitCount サーブを含む打球数
 * @property {number} lastHitter
 * @property {number} bounces 直近の打球からのバウンド数
 * @property {boolean} netTouched
 * @property {boolean} rolling
 * @property {number} server
 * @property {boolean} serveRight
 * @property {{loser: number, reason: string}|null} fault
 * @property {number} seq サーブ・打球ごとに増える通し番号
 * @property {string} kind 直近の打球の種類 ('serve' / SHOT.* / 'smash')
 * @property {number} gm 重力の倍率 (強打のトップスピンで大きくなる)
 * @property {number} rest バウンドの反発係数 (ソフトは弾まない)
 */

/** @returns {Rally} */
export function createRally(server = 0, serveRight = true) {
  return {
    active: false,
    p: [0, 0.5, 0],
    v: [0, 0, 0],
    hitCount: 0,
    lastHitter: -1,
    bounces: 0,
    netTouched: false,
    rolling: false,
    server,
    serveRight,
    fault: null,
    seq: 0,
    kind: 'serve',
    gm: 1,
    rest: BOUNCE_RESTITUTION,
  };
}

/** @param {Rally} r @returns {Rally} */
export function cloneRally(r) {
  return {
    active: r.active,
    p: [r.p[0], r.p[1], r.p[2]],
    v: [r.v[0], r.v[1], r.v[2]],
    hitCount: r.hitCount,
    lastHitter: r.lastHitter,
    bounces: r.bounces,
    netTouched: r.netTouched,
    rolling: r.rolling,
    server: r.server,
    serveRight: r.serveRight,
    fault: r.fault ? { loser: r.fault.loser, reason: r.fault.reason } : null,
    seq: r.seq,
    kind: r.kind,
    gm: r.gm,
    rest: r.rest,
  };
}

export function inCourt(x, z) {
  return Math.abs(x) <= COURT_HALF_W + BALL_R && Math.abs(z) <= COURT_HALF_L + BALL_R;
}

/** サーブが対角のサービスコートに入っているか (キッチンラインはフォルト) */
export function inServiceCourt(r, x, z) {
  const receiver = 1 - r.server;
  if (sideOf(z) !== receiver) return false;
  if (Math.abs(z) <= KITCHEN + BALL_R) return false;
  if (!inCourt(x, z)) return false;
  const sign = r.serveRight ? rightSign(receiver) : -rightSign(receiver);
  return x * sign >= -BALL_R;
}

function setFault(r, loser, reason) {
  if (!r.fault) r.fault = { loser, reason };
}

function onBounce(r, x, z, events) {
  if (events) events.push({ type: 'bounce', x, z });
  if (!r.active || r.fault || r.lastHitter < 0) return;
  const s = sideOf(z);
  if (r.bounces === 0) {
    if (s === r.lastHitter) {
      setFault(r, r.lastHitter, r.netTouched ? 'ネット' : 'ミス');
    } else if (r.hitCount === 1) {
      if (!inServiceCourt(r, x, z)) {
        const kitchen = sideOf(z) !== r.server && Math.abs(z) <= KITCHEN + BALL_R;
        setFault(r, r.lastHitter, kitchen ? 'サーブがキッチン' : 'サーブアウト');
      }
    } else if (!inCourt(x, z)) {
      setFault(r, r.lastHitter, 'アウト');
    }
    r.bounces = 1;
  } else {
    r.bounces++;
    setFault(r, s, '2バウンド');
  }
}

/**
 * 1 tick 進める。
 * @param {Rally} r
 * @param {Array|null} events バウンド等のイベントを積む配列
 */
export function stepRally(r, events = null) {
  if (!r.active) return;
  const p = r.p;
  const v = r.v;
  const pz = p[2];
  const g = GRAVITY * r.gm;

  p[0] += v[0] * DT;
  p[1] += v[1] * DT - 0.5 * g * DT * DT;
  p[2] += v[2] * DT;
  v[1] -= g * DT;

  // ネット判定
  if (pz !== 0 && (pz > 0) !== (p[2] > 0)) {
    const f = pz / (pz - p[2]);
    const xc = p[0] - v[0] * DT * (1 - f);
    const yc = p[1] - (v[1] + 0.5 * g * DT) * DT * (1 - f);
    if (Math.abs(xc) <= NET_HALF_W && yc < netHeightAt(xc) + BALL_R && yc > -0.1) {
      p[0] = xc;
      p[1] = Math.max(yc, BALL_R);
      p[2] = (pz > 0 ? 1 : -1) * (BALL_R + 0.02);
      v[0] *= 0.35;
      v[1] = Math.min(v[1], 0) * 0.3;
      v[2] = -v[2] * 0.12;
      r.netTouched = true;
      if (events) events.push({ type: 'net', x: p[0], y: p[1] });
    }
  }

  // 地面
  if (p[1] < BALL_R) {
    p[1] = BALL_R;
    if (v[1] < -0.9) {
      v[1] = -v[1] * r.rest;
      v[0] *= BOUNCE_FRICTION;
      v[2] *= BOUNCE_FRICTION;
      onBounce(r, p[0], p[2], events);
    } else {
      // 転がり (接地した瞬間だけバウンドとして数える)
      if (!r.rolling) {
        r.rolling = true;
        onBounce(r, p[0], p[2], events);
      }
      v[1] = 0;
      v[0] *= 0.96;
      v[2] *= 0.96;
    }
  }

  // 場外で止める
  if (Math.abs(p[0]) > 14 || Math.abs(p[2]) > 17) {
    p[0] = Math.max(-14, Math.min(14, p[0]));
    p[2] = Math.max(-17, Math.min(17, p[2]));
    v[0] = 0;
    v[2] = 0;
  }
}

/**
 * 当たりの良さ (0.3..1)。体から近すぎる・遠すぎる・低すぎるボールは悪くなる。
 * 距離はキャラの届く範囲 (st.reach) に合わせて伸び縮みする。
 */
export function contactQuality(r, px, pz, st = BASE_STATS) {
  const d = Math.hypot(r.p[0] - px, r.p[2] - pz) / st.reach;
  const y = r.p[1];
  let qd = 1;
  if (d < 0.4) qd = 0.6 + (d / 0.4) * 0.4;
  else if (d > 0.85) qd = Math.max(0, 1 - (d - 0.85) / 0.5);
  let qy = 1;
  if (y < 0.25) qy = 0.45 + y * 2.2;
  return Math.max(0.3, Math.min(qd, qy));
}

/** ボールがリーチ内にあるか (dive なら飛びついて届く範囲) */
export function inReach(r, idx, px, pz, dive = false, st = BASE_STATS) {
  const dx = r.p[0] - px;
  const dz = r.p[2] - pz;
  const reach = dive ? DIVE_REACH * st.dive : REACH * st.reach;
  if (dx * dx + dz * dz > reach * reach) return false;
  if (r.p[1] < REACH_MIN_Y || r.p[1] > REACH_MAX_Y) return false;
  // 背中側に大きく回ったボールは打てない
  if (dz * forwardSign(idx) < -0.8) return false;
  return true;
}

/**
 * 打てるかどうか。打てるなら null、打てない理由があればその文字列。
 * @param {boolean} [dive] 飛びついて打つ (リーチが広がる)
 * @param {import('./stats.js').Stats} [st] 打つキャラの能力
 * @returns {string|null}
 */
export function hitBlockReason(r, idx, px, pz, dive = false, st = BASE_STATS) {
  if (!r.active || r.fault) return 'inactive';
  if (r.lastHitter === idx) return 'twice';
  if (sideOf(r.p[2]) !== idx) return 'side';
  if (r.bounces >= 2) return 'dead';
  if (!inReach(r, idx, px, pz, dive, st)) return 'reach';
  if (r.bounces === 0 && r.hitCount <= 2) return 'twobounce';
  if (r.bounces === 0 && Math.abs(pz) < KITCHEN) return 'kitchen';
  return null;
}

/** 打球を適用する。呼ぶ前に hitBlockReason で検証しておくこと。 */
export function applyHit(r, idx, shot, aimX, aimY, px, pz, dive = false, st = BASE_STATS) {
  // 飛びついた打球は当たりが一定で悪い (体勢が崩れている)
  const quality = dive ? DIVE_QUALITY : contactQuality(r, px, pz, st);
  const res = computeShot(r.p, idx, shot, aimX, aimY, quality, st);
  r.v = res.v;
  r.kind = res.kind;
  r.gm = res.gm;
  r.rest = res.rest;
  r.hitCount++;
  r.lastHitter = idx;
  r.bounces = 0;
  r.netTouched = false;
  r.rolling = false;
  r.seq++;
  return { kind: dive ? 'dive' : res.kind, quality };
}

/** サーブ準備状態にする */
export function resetForServe(r, server, serveRight) {
  r.active = false;
  r.hitCount = 0;
  r.lastHitter = -1;
  r.bounces = 0;
  r.netTouched = false;
  r.rolling = false;
  r.fault = null;
  r.server = server;
  r.serveRight = serveRight;
  r.v = [0, 0, 0];
  r.kind = 'serve';
  r.gm = 1;
  r.rest = BOUNCE_RESTITUTION;
}

export function applyServe(r, shot, aimX, aimY, px, pz) {
  const idx = r.server;
  r.p = servePosition(idx, px, pz);
  const res = computeServe(r.p, idx, r.serveRight, shot, aimX, aimY);
  r.v = res.v;
  r.kind = 'serve';
  r.gm = 1;
  r.rest = BOUNCE_RESTITUTION;
  r.active = true;
  r.hitCount = 1;
  r.lastHitter = idx;
  r.bounces = 0;
  r.netTouched = false;
  r.rolling = false;
  r.fault = null;
  r.seq++;
  return { kind: res.kind, quality: 1 };
}

/**
 * 次のバウンド地点を予測する (着地マーカー表示や CPU 用)。
 * @returns {{x: number, z: number, t: number}|null}
 */
export function predictBounce(r, maxTicks = 240) {
  if (!r.active) return null;
  const s = cloneRally(r);
  s.fault = { loser: -1, reason: '' }; // ルール判定を止める
  const ev = [];
  for (let i = 1; i <= maxTicks; i++) {
    ev.length = 0;
    stepRally(s, ev);
    for (const e of ev) if (e.type === 'bounce') return { x: e.x, z: e.z, t: i * DT };
  }
  return null;
}
