// 必殺ショット。ゲージは打つたびにたまり (ソフト・ロブほど多い)、満タンで 1 回打てる。
// 打球の種類はキャラ (CHARACTERS の並び順) ごとに決まっている。

/** 打球メッセージで「必殺ショット」を表す値 (サーバーがキャラの種類に置き換える) */
export const SPECIAL = 'special';
export const SP_MAX = 100;

/** 打球の種類ごとにたまるゲージ (必殺ショットそのものではたまらない) */
const SP_GAIN = { soft: 25, lob: 25, dive: 15, drive: 6, smash: 0 };

/**
 * 必殺ショットの種類。kind は shot.js の shotParams() で扱う。
 * - meteor: とても速く沈む強打
 * - drop: ネットすれすれに落ちてほとんど弾まない
 * - curve: 外へ逃げてからサイドラインへ曲がり込む
 * - star: 高く上がって急降下し、コートの奥に突き刺さる
 */
export const SPECIAL_KINDS = {
  meteor: 'sp_meteor',
  drop: 'sp_drop',
  curve: 'sp_curve',
  star: 'sp_star',
};

/** キャラごとの必殺ショット (CHARACTERS と同じ並び) */
export const SPECIALS = [
  { kind: SPECIAL_KINDS.meteor, name: 'ジェットスマッシュ' }, // ピコ
  { kind: SPECIAL_KINDS.drop, name: 'ふんわりストップ' }, // モモ
  { kind: SPECIAL_KINDS.meteor, name: 'メテオドライブ' }, // ガンテツ
  { kind: SPECIAL_KINDS.curve, name: 'ムーンカーブ' }, // ルナ
  { kind: SPECIAL_KINDS.curve, name: 'ジャイロカーブ' }, // ボルト
  { kind: SPECIAL_KINDS.drop, name: 'くまさんドロップ' }, // ココ
  { kind: SPECIAL_KINDS.star, name: 'きらきらスター' }, // ちょるこ
];

/** @param {number} char */
export function specialOf(char) {
  return SPECIALS[char] || SPECIALS[0];
}

/** @param {string} kind */
export function isSpecialKind(kind) {
  return typeof kind === 'string' && kind.startsWith('sp_');
}

/** 打球 (applyHit の結果の kind) でたまるゲージ */
export function spGain(kind) {
  return SP_GAIN[kind] || 0;
}
