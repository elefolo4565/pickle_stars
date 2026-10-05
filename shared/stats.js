// キャラごとの能力差。1 が標準で、長所の分だけどこかを少し下げて合計が釣り合うようにしている。
// サーバーとブラウザの両方で同じ値を使う (オンラインでは試合の判定もこの値で行う)。
// 並びは CHARACTERS (client/src/characters.js) と同じ。

/**
 * @typedef {Object} Stats
 * @property {number} speed 走る速さ
 * @property {number} reach ラケットが届く範囲 (当たりの良い距離も同じ割合で広がる)
 * @property {number} dive 飛びついて届く範囲
 * @property {number} power 強打 (ドライブ・スマッシュ・速い必殺ショット) の球速
 * @property {number} control 強打の当たりが悪いときのぶれ (小さいほど正確)
 * @property {number} touch ソフト・ロブの当たりが悪いときのぶれ (小さいほど正確)
 * @property {number} recover 飛びついたあと動けない時間
 */

/** @type {Readonly<Stats>} */
export const BASE_STATS = Object.freeze({
  speed: 1, reach: 1, dive: 1, power: 1, control: 1, touch: 1, recover: 1,
});

function stats(s) {
  return Object.freeze({ ...BASE_STATS, ...s });
}

/** キャラごとの能力と、キャラ選択で見せる得意・苦手 */
export const CHAR_STATS = [
  // ピコ: オールラウンダー。飛びついたあとすぐ起き上がる
  { stats: stats({ recover: 0.7 }), good: '立ち直り', weak: '' },
  // モモ: テクニシャン。ふんわり球が正確、強打は少し遅い
  { stats: stats({ touch: 0.8, power: 0.9 }), good: 'ソフト・ロブ', weak: '強打' },
  // ガンテツ: パワーヒッター。強打がかなり速い、足は遅め
  { stats: stats({ power: 1.15, speed: 0.9 }), good: '強打', weak: '足の速さ' },
  // ルナ: スピードスター。足がいちばん速い、届く範囲は少し狭い
  { stats: stats({ speed: 1.12, reach: 0.9 }), good: '足の速さ', weak: '届く範囲' },
  // ボルト: メカ・アナリスト。コントロールが最も正確、足は少し遅い
  { stats: stats({ control: 0.8, touch: 0.9, speed: 0.94 }), good: 'コントロール', weak: '足の速さ' },
  // ココ: ディフェンダー。届く範囲が広い、強打は遅め
  { stats: stats({ reach: 1.12, dive: 1.05, power: 0.9 }), good: '届く範囲', weak: '強打' },
  // ちょるこ: マジカルスター。届く範囲と飛びつきが少し広い、コントロールは少しぶれやすい
  { stats: stats({ reach: 1.06, dive: 1.1, control: 1.15, touch: 1.15 }), good: '飛びつき', weak: 'コントロール' },
];

/** @param {number} char @returns {Readonly<Stats>} */
export function statsOf(char) {
  return (CHAR_STATS[char] || CHAR_STATS[0]).stats;
}
