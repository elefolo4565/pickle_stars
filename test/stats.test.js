import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../shared/match.js';
import { Bot } from '../shared/ai.js';
import { createRally, stepRally, hitBlockReason, applyServe, applyHit } from '../shared/rally.js';
import { SHOT, REACH } from '../shared/constants.js';
import { CHAR_STATS, BASE_STATS, statsOf } from '../shared/stats.js';

const PICO = 0;
const MOMO = 1;
const GANTETSU = 2;
const LUNA = 3;
const BOLT = 4;
const COCO = 5;

test('能力の表は 7 キャラ分あり、知らない番号は標準になる', () => {
  assert.equal(CHAR_STATS.length, 7);
  assert.deepEqual({ ...statsOf(99) }, { ...statsOf(PICO) });
  for (const { stats } of CHAR_STATS) {
    assert.deepEqual(Object.keys(stats).sort(), Object.keys(BASE_STATS).sort());
  }
});

/** リターン側コートで 1 回バウンドしたボール */
function bouncedBall() {
  const r = createRally(0, true);
  applyServe(r, SHOT.DRIVE, 0, 0, 1.4, 7.2);
  for (let i = 0; i < 300 && !(r.bounces === 1 && r.p[1] > 0.4); i++) stepRally(r);
  return r;
}

test('届く範囲: ココは標準より遠くまで届き、ルナは届かない', () => {
  const r = bouncedBall();
  const px = r.p[0] - REACH * 1.05;
  assert.equal(hitBlockReason(r, 1, px, r.p[2], false, statsOf(PICO)), 'reach');
  assert.equal(hitBlockReason(r, 1, px, r.p[2], false, statsOf(COCO)), null);
  const near = r.p[0] - REACH * 0.95;
  assert.equal(hitBlockReason(r, 1, near, r.p[2], false, statsOf(PICO)), null);
  assert.equal(hitBlockReason(r, 1, near, r.p[2], false, statsOf(LUNA)), 'reach');
});

/** 打点 p から打った球が最初にバウンドするまでの tick 数と着地点 */
function landing(shot, quality, st) {
  const r = createRally(1, true);
  r.active = true;
  r.p = [0, 1, 5];
  r.hitCount = 3;
  r.lastHitter = 1;
  r.bounces = 1;
  // 打点から 0.85 * reach 離れて立つ → 当たりは完璧。quality を下げたいときは離れて立つ
  const d = (0.85 + (1 - quality) * 0.5) * st.reach;
  applyHit(r, 0, shot, 0.6, 0, r.p[0] - d, r.p[2], false, st);
  const ev = [];
  let t = 0;
  while (t < 400 && !ev.length) {
    stepRally(r, ev);
    t++;
  }
  return { t, x: ev[0].x, z: ev[0].z };
}

test('パワー: ガンテツの強打は標準より速く、モモの強打は遅い', () => {
  const base = landing(SHOT.DRIVE, 1, statsOf(PICO)).t;
  assert.ok(landing(SHOT.DRIVE, 1, statsOf(GANTETSU)).t < base);
  assert.ok(landing(SHOT.DRIVE, 1, statsOf(MOMO)).t > base);
  // ソフトは球速の能力に関係しない
  assert.equal(landing(SHOT.SOFT, 1, statsOf(GANTETSU)).t, landing(SHOT.SOFT, 1, statsOf(PICO)).t);
});

test('コントロール: 当たりが悪いとき、ボルトは狙いからのぶれが小さい', () => {
  const ideal = landing(SHOT.DRIVE, 1, BASE_STATS);
  const miss = (st) => Math.hypot(landing(SHOT.DRIVE, 0.5, st).x - ideal.x, landing(SHOT.DRIVE, 0.5, st).z - ideal.z);
  assert.ok(miss(statsOf(BOLT)) < miss(statsOf(PICO)));
  // ソフトはモモがいちばんぶれない
  const idealSoft = landing(SHOT.SOFT, 1, BASE_STATS);
  const missSoft = (st) => {
    const l = landing(SHOT.SOFT, 0.75, st);
    return Math.hypot(l.x - idealSoft.x, l.z - idealSoft.z);
  };
  assert.ok(missSoft(statsOf(MOMO)) < missSoft(statsOf(PICO)));
});

test('足の速さ: サーバーが認める移動量もキャラの速さに合わせて変わる', () => {
  const moved = (char) => {
    const m = new Match({ chars: [PICO, char] });
    const pl = m.players[1];
    const x0 = pl.x;
    for (let i = 0; i < 15; i++) {
      m.step();
      m.setPlayerInput(1, x0 - 5, pl.z, 0, pl.rs);
    }
    return Math.abs(pl.x - x0);
  };
  assert.ok(moved(LUNA) > moved(PICO));
  assert.ok(moved(GANTETSU) < moved(PICO));
});

test('全キャラで CPU 同士の試合が最後まで進む', () => {
  for (let a = 0; a < CHAR_STATS.length; a++) {
    const m = new Match({ pointsToWin: 5, chars: [a, (a + 3) % CHAR_STATS.length] });
    const bots = [new Bot(0, 2), new Bot(1, 1)];
    while (m.phase !== 'gameOver' && m.tick < 60 * 60 * 20) {
      bots[0].update(m);
      bots[1].update(m);
      m.step();
      m.events.length = 0;
    }
    assert.equal(m.phase, 'gameOver', `終了しない chars=${m.chars} score=${m.score}`);
  }
});
