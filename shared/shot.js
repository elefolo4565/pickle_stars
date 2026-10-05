// 打球の軌道計算。サーバーとクライアントで同じ結果になるよう、
// 乱数や三角関数を使わない決定的な計算だけで構成している。
import {
  BALL_R, GRAVITY, BALL_SPEED, BOUNCE_RESTITUTION, COURT_HALF_W, COURT_HALF_L, KITCHEN, SHOT,
  forwardSign, netHeightAt,
} from './constants.js';

/** プレイヤーから見た「右」がワールド x のどちら向きか */
export function rightSign(playerIdx) {
  return playerIdx === 0 ? 1 : -1;
}

/**
 * 位置 p から (tx, tz) に着地する初速を求める。ネットを越えない場合は滞空時間を延ばして山なりにする。
 * @param {number[]} p
 * @param {number} tx
 * @param {number} tz
 * @param {number} tau 初期の滞空時間
 * @param {number} clearance ネット上の余裕
 * @param {number} [g] 重力 (スピンで変わる)
 * @returns {number[]}
 */
export function solveTrajectory(p, tx, tz, tau, clearance, g = GRAVITY) {
  let v = [0, 0, 0];
  for (let i = 0; i < 80; i++) {
    const vx = (tx - p[0]) / tau;
    const vz = (tz - p[2]) / tau;
    const vy = (BALL_R - p[1] + 0.5 * g * tau * tau) / tau;
    v = [vx, vy, vz];
    const crosses = (p[2] > 0) !== (tz > 0) && vz !== 0;
    if (!crosses) return v;
    const tn = -p[2] / vz;
    const xn = p[0] + vx * tn;
    const yn = p[1] + vy * tn - 0.5 * g * tn * tn;
    if (yn >= netHeightAt(xn) + BALL_R + clearance) return v;
    tau += 0.02;
  }
  return v;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 打球の種類ごとの性格 (当たりが完璧なとき)。
 * depth: 狙う深さ / speed: 横方向の速さ (0 なら tau の式で決める) / clearance: ネット上の余裕
 * gm: 重力の倍率 (強打はトップスピンで沈む) / rest: バウンドの弾み (ソフトは弾まない)
 * @param {string} kind SHOT.* または 'smash'
 * @param {number} ay -1..1
 * @param {number} y 打点の高さ
 */
function shotParams(kind, ay, y) {
  switch (kind) {
    case 'smash':
      return { depth: 4.2 + ay * 1.6, speed: 28, clearance: 0.05, gm: 1, rest: BOUNCE_RESTITUTION };
    case SHOT.SOFT:
      return { depth: 1.25 + ay * 0.6, speed: 0, clearance: 0.2, gm: 1, rest: 0.42 };
    case SHOT.LOB:
      return { depth: 5.9 + ay * 0.5, speed: 0, clearance: 0.9, gm: 1.4, rest: 0.56 };
    default:
      return { depth: 5.2 + ay * 1.0, speed: y < 0.45 ? 16 : 20, clearance: 0.16, gm: 1.9, rest: 0.55 };
  }
}

/**
 * 当たりが完璧なときの狙いの着地点 (表示用)。
 * @returns {number[]} [x, z]
 */
export function aimPoint(idx, shot, aimX, aimY, ballY = 1) {
  const kind = shot === SHOT.DRIVE && ballY > 1.5 ? 'smash' : shot;
  const { depth } = shotParams(kind, clamp(aimY, -1, 1), ballY);
  return [clamp(aimX, -1, 1) * rightSign(idx) * 2.6, forwardSign(idx) * depth];
}

/**
 * ラリー中の打球。
 * @param {number[]} p ボール位置
 * @param {number} idx 打ったプレイヤー
 * @param {string} shot SHOT.*
 * @param {number} aimX プレイヤー視点の左右 (-1..1)
 * @param {number} aimY プレイヤー視点の奥行き (-1..1, +1 で深く)
 * @param {number} quality 当たりの良さ (0..1)
 * @returns {{v: number[], kind: string}}
 */
export function computeShot(p, idx, shot, aimX, aimY, quality) {
  const f = forwardSign(idx);
  const ax = clamp(aimX, -1, 1) * rightSign(idx);
  const ay = clamp(aimY, -1, 1);
  let kind = shot;
  if (shot === SHOT.DRIVE && p[1] > 1.5) kind = 'smash';

  const sp = shotParams(kind, ay, p[1]);
  let { depth, clearance } = sp;

  let tx = ax * 2.6;
  // 当たりが悪いほど、狙った方向へ大きくぶれる (サイドラインを狙うほどリスクが高い)
  const err = 1 - quality;
  const side = ax !== 0 ? Math.sign(ax) : (p[0] >= 0 ? 1 : -1);
  tx += side * err * (0.4 + Math.abs(ax) * 2.2);
  if (kind === SHOT.SOFT) depth -= err * 0.9;
  else depth += err * (0.7 + Math.max(ay, 0) * 1.3);
  depth = Math.max(depth, 0.25);
  // 当たりが悪いとネットの上の余裕がなくなり、ネットにかかることがある
  clearance -= err * 0.45;
  const tz = f * depth;

  const hd = Math.sqrt((tx - p[0]) ** 2 + (tz - p[2]) ** 2);
  let tau;
  if (kind === SHOT.SOFT) tau = 0.45 + hd * 0.06;
  else if (kind === SHOT.LOB) tau = 1.25 + hd * 0.02;
  else tau = hd / sp.speed;
  tau /= BALL_SPEED;

  const v = solveTrajectory(p, tx, tz, tau, clearance, GRAVITY * sp.gm);
  return { v, kind, gm: sp.gm, rest: sp.rest };
}

/** サーブ時のボールの初期位置 */
export function servePosition(idx, px, pz) {
  return [px + rightSign(idx) * 0.28, 0.5, pz + forwardSign(idx) * 0.45];
}

/**
 * サーブ (アンダーハンド)。必ず対角のサービスコートを狙う。
 * @returns {{v: number[], kind: string}}
 */
export function computeServe(p, idx, serveRight, shot, aimX, aimY) {
  const receiver = 1 - idx;
  const sign = serveRight ? rightSign(receiver) : -rightSign(receiver);
  const ax = clamp(aimX, -1, 1) * rightSign(idx);
  const ay = clamp(aimY, -1, 1);
  const tx = sign * clamp(1.5 + ax * sign * 1.1, 0.3, COURT_HALF_W - 0.3);

  let depth;
  let tau;
  if (shot === SHOT.LOB) {
    depth = 5.8 + ay * 0.5;
    tau = 1.55;
  } else if (shot === SHOT.SOFT) {
    depth = 4.2 + ay * 0.9;
  } else {
    depth = 5.6 + ay * 0.7;
  }
  depth = clamp(depth, KITCHEN + 0.4, COURT_HALF_L - 0.3);
  const tz = forwardSign(idx) * depth;
  const hd = Math.sqrt((tx - p[0]) ** 2 + (tz - p[2]) ** 2);
  if (tau === undefined) tau = hd / (shot === SHOT.SOFT ? 8.5 : 12.5);
  tau /= BALL_SPEED;
  return { v: solveTrajectory(p, tx, tz, tau, 0.2), kind: 'serve' };
}
