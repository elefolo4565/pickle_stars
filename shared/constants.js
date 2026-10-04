// サーバー・クライアント共通の定数。単位はメートル / 秒。
// 座標系: x = 左右, y = 上, z = 前後。ネットは z = 0。
// プレイヤー0 は z > 0 側、プレイヤー1 は z < 0 側に立つ。

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const DT_MS = 1000 / TICK_RATE;
export const SNAPSHOT_EVERY = 2; // 2 tick ごと = 30Hz でスナップショット送信

// コート (公式サイズ 20ft x 44ft)
export const COURT_HALF_W = 3.048;
export const COURT_HALF_L = 6.706;
export const KITCHEN = 2.134; // ノンボレーゾーン (ネットから 7ft)
export const NET_H_CENTER = 0.864;
export const NET_H_POST = 0.914;
export const NET_HALF_W = 3.35;

// ボール
export const BALL_R = 0.037;
// ボールの速さの倍率。軌道の形を変えずに全体をゆっくりにするため、重力は倍率の 2 乗で弱める
export const BALL_SPEED = 0.8;
export const GRAVITY = 9.8 * BALL_SPEED * BALL_SPEED;
export const BOUNCE_RESTITUTION = 0.62;
export const BOUNCE_FRICTION = 0.8;

// プレイヤー
export const MOVE_SPEED = 6.0;
export const MOVE_ACCEL = 40;
export const REACH = 1.3; // 水平方向のリーチ
export const REACH_MIN_Y = 0.04;
export const REACH_MAX_Y = 2.4;
export const SWING_WINDOW = 0.4; // ボタンを押してから打てる猶予 (秒)
// 飛びつき: 普通のリーチの外でも、このくらいまでなら飛びついて返せる (当たりは悪くなる)
export const DIVE_REACH = 2.3;
export const DIVE_QUALITY = 0.62;
export const DIVE_RECOVER = 0.7; // 飛びついたあと起き上がるまで動けない時間 (秒)
export const DIVE_WINDOW = 0.25; // ダイブボタンを押してから、飛びついて打てる猶予 (秒)
export const PLAYER_BOUNDS_X = 6.5;
export const PLAYER_BOUNDS_Z = 10.5;
export const PLAYER_NET_GAP = 0.3;

// ラグ補償
export const MAX_REWIND_TICKS = 18; // 300ms までさかのぼって打球判定する
export const POINT_GRACE_TICKS = 18; // 失点確定までの猶予 (巻き戻しヒットのため)

// 進行
export const POINT_OVER_SEC = 2.2;
export const SERVE_TIMEOUT_SEC = 10;

export const SHOT = Object.freeze({ DRIVE: 'drive', SOFT: 'soft', LOB: 'lob' });

/** プレイヤーが相手コート方向に向かう z の符号 */
export function forwardSign(playerIdx) {
  return playerIdx === 0 ? -1 : 1;
}

/** z 座標がどちらのプレイヤーのサイドか */
export function sideOf(z) {
  return z >= 0 ? 0 : 1;
}

/** ネットの高さ (中央が低い) */
export function netHeightAt(x) {
  const t = Math.min(Math.abs(x) / NET_HALF_W, 1);
  return NET_H_CENTER + (NET_H_POST - NET_H_CENTER) * t * t;
}
