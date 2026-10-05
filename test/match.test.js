import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../shared/match.js';
import { Bot } from '../shared/ai.js';
import {
  createRally, stepRally, hitBlockReason, applyServe, applyHit, inServiceCourt, inCourt,
} from '../shared/rally.js';
import { SHOT, REACH, REACH_MAX_Y, KITCHEN, DIVE_REACH, DIVE_QUALITY } from '../shared/constants.js';
import { SPECIAL, SPECIAL_KINDS, SP_MAX, specialOf } from '../shared/special.js';

function playBots(levels, opts, maxTicks = 60 * 60 * 30) {
  const m = new Match(opts);
  const bots = [new Bot(0, levels[0]), new Bot(1, levels[1])];
  const reasons = {};
  let hits = 0;
  let rallies = 0;
  while (m.phase !== 'gameOver' && m.tick < maxTicks) {
    bots[0].update(m);
    bots[1].update(m);
    m.step();
    for (const e of m.events) {
      if (e.type === 'point') {
        reasons[e.reason] = (reasons[e.reason] || 0) + 1;
        rallies++;
      }
      if (e.type === 'hit') hits++;
    }
    m.events.length = 0;
  }
  return { m, reasons, hits, rallies };
}

test('サーブは全種類・全エイムで対角のサービスコートに入る', () => {
  for (const server of [0, 1]) {
    for (const serveRight of [true, false]) {
      for (const shot of Object.values(SHOT)) {
        for (const ax of [-1, 0, 1]) {
          for (const ay of [-1, 0, 1]) {
            const r = createRally(server, serveRight);
            const px = (server === 0 ? 1 : -1) * (serveRight ? 1.4 : -1.4);
            const pz = server === 0 ? 7.2 : -7.2;
            applyServe(r, shot, ax, ay, px, pz);
            const ev = [];
            for (let i = 0; i < 300 && !ev.some((e) => e.type === 'bounce'); i++) stepRally(r, ev);
            const b = ev.find((e) => e.type === 'bounce');
            assert.ok(b, 'バウンドする');
            assert.ok(inServiceCourt(r, b.x, b.z), `in: s${server} ${serveRight} ${shot} ${ax},${ay} -> ${b.x.toFixed(2)},${b.z.toFixed(2)}`);
            assert.equal(r.fault, null);
          }
        }
      }
    }
  }
});

test('リターンはツーバウンドルールでノーバウンドでは打てない', () => {
  const r = createRally(0, true);
  applyServe(r, SHOT.DRIVE, 0, 0, 1.4, 7.2);
  // ボールが相手コートに入った直後、バウンド前
  for (let i = 0; i < 200 && !(r.p[2] < -3 && r.bounces === 0); i++) stepRally(r);
  assert.equal(hitBlockReason(r, 1, r.p[0] + 0.5, r.p[2]), 'twobounce');
});

test('CPU 同士で試合が最後まで進む', () => {
  for (const lv of [[0, 0], [1, 1], [2, 2], [2, 0]]) {
    // CPU の動きは乱数で揺れるので、ラリーの長さは 3 試合の合計で見る (1 試合だと 15 ラリー程度でぶれが大きい)
    let hits = 0;
    let rallies = 0;
    for (let g = 0; g < 3; g++) {
      const chars = [g * 2, g * 2 + 1];
      const res = playBots(lv, { pointsToWin: 11, chars });
      assert.equal(res.m.phase, 'gameOver', `終了しない ${lv} score=${res.m.score}`);
      hits += res.hits;
      rallies += res.rallies;
      console.log(`level ${lv} chars ${chars}: score ${res.m.score} avgHits ${(res.hits / res.rallies).toFixed(2)} ${JSON.stringify(res.reasons)}`);
    }
    assert.ok(hits / rallies > 2.2, `ラリーが短すぎる ${lv}: ${(hits / rallies).toFixed(2)}`);
  }
});

test('サイドアウト方式でも試合が終わる', () => {
  const { m } = playBots([1, 1], { pointsToWin: 7, scoring: 'sideout' });
  assert.equal(m.phase, 'gameOver');
});

test('クライアント申告の位置はワープできない', () => {
  const m = new Match();
  const pl = m.players[1];
  const x0 = pl.x;
  m.setPlayerInput(1, x0 + 5, pl.z, 0, pl.rs);
  assert.ok(Math.abs(pl.x - x0) <= 1.5 + 1e-9, `moved ${pl.x - x0}`);
  for (let i = 0; i < 60; i++) {
    m.step();
    m.setPlayerInput(1, x0 + 5, pl.z, 0, pl.rs);
  }
  assert.ok(Math.abs(pl.x - (x0 + 5)) < 1e-9, '時間をかければ到達できる');
});

test('リーチの外でも飛びつけば届く (当たりは悪くなる)', () => {
  const r = createRally(0, true);
  applyServe(r, SHOT.DRIVE, 0, 0, 1.4, 7.2);
  // リターン側のコートで 1 回バウンドしたあと
  for (let i = 0; i < 300 && !(r.bounces === 1 && r.p[1] > 0.4); i++) stepRally(r);
  assert.equal(r.bounces, 1);
  const d = (REACH + DIVE_REACH) / 2;
  const px = r.p[0] - d;
  const pz = r.p[2];
  assert.equal(hitBlockReason(r, 1, px, pz), 'reach');
  assert.equal(hitBlockReason(r, 1, px, pz, true), null);
  assert.equal(hitBlockReason(r, 1, r.p[0] - DIVE_REACH - 0.2, pz, true), 'reach');
  const res = applyHit(r, 1, SHOT.DRIVE, 0, 0, px, pz, true);
  assert.equal(res.kind, 'dive');
  assert.equal(res.quality, DIVE_QUALITY);
  assert.equal(r.lastHitter, 1);
});

test('サーバーは飛びつきの打球をラグ補償つきで受け付ける', () => {
  const m = new Match();
  for (let i = 0; i < 40; i++) m.step();
  assert.ok(m.serve(0, SHOT.DRIVE, 0, 0));
  const r = m.rally;
  while (!(r.bounces === 1 && r.p[1] > 0.4) && m.tick < 1000) m.step();
  const pl = m.players[1];
  pl.x = r.p[0] - 1.9;
  pl.z = r.p[2];
  assert.equal(m.hit(1, m.tick, SHOT.SOFT, 0, 0, pl.x, pl.z), 'reach');
  assert.equal(m.hit(1, m.tick, SHOT.SOFT, 0, 0, pl.x, pl.z, true), null);
  assert.equal(m.rally.lastHitter, 1);
});

test('自分から飛びついたことがスナップショットで相手に伝わる', () => {
  const m = new Match();
  assert.equal(m.snapshot().pl[1][8], 0);
  m.dive(1);
  assert.equal(m.snapshot().pl[1][8], 1);
  assert.equal(m.snapshot().pl[0][8], 0);
});

/** 打点 p から打った球を、2 回目のバウンドまで追いかけて特徴を返す */
function flight(p, shot, aimX = 0) {
  const r = createRally(1, true);
  r.active = true;
  r.p = [...p];
  r.hitCount = 3;
  r.lastHitter = 1;
  r.bounces = 1;
  const hit = applyHit(r, 0, shot, aimX, 0, p[0] + 0.7, p[2]);
  const ev = [];
  let t = 0;
  let land = 0;
  let overKitchen = null;
  let bounceTop = 0;
  while (t < 400 && ev.length < 2) {
    const pz = r.p[2];
    stepRally(r, ev);
    t++;
    if (pz > -KITCHEN && r.p[2] <= -KITCHEN) overKitchen = r.p[1];
    if (ev.length === 1) {
      if (!land) land = t;
      bounceTop = Math.max(bounceTop, r.p[1]);
    }
  }
  assert.equal(ev[0].type, 'bounce');
  assert.ok(inCourt(ev[0].x, ev[0].z) && ev[0].z < 0, `${shot} は相手コートに入る: ${ev[0].x.toFixed(2)},${ev[0].z.toFixed(2)}`);
  return { kind: hit.kind, t: land, overKitchen, bounceTop, x: ev[0].x, z: ev[0].z };
}

test('ショットごとに性格がはっきり違う (強打は速い・ソフトは弾まない・ロブはネット際の相手を越える)', () => {
  for (const p of [[0, 0.6, 6.5], [0, 0.6, 2.3], [0, 0.3, 6.5]]) {
    const res = {};
    for (const shot of Object.values(SHOT)) res[shot] = flight(p, shot);
    const at = p.join(',');
    assert.equal(res.drive.kind, SHOT.DRIVE);
    assert.ok(res.drive.t < 0.85 * 60, `強打は速い ${at}: ${res.drive.t}`);
    assert.ok(res.soft.t > res.drive.t * 1.35, `ソフトは強打より遅い ${at}`);
    assert.ok(res.soft.bounceTop < 0.45, `ソフトは低く弾む ${at}: ${res.soft.bounceTop.toFixed(2)}`);
    assert.ok(res.lob.overKitchen > REACH_MAX_Y, `ロブはキッチンの相手の頭を越える ${at}: ${res.lob.overKitchen.toFixed(2)}`);
    assert.ok(res.lob.bounceTop < 1.5, `ロブは弾んでもスマッシュされる高さにならない ${at}: ${res.lob.bounceTop.toFixed(2)}`);
  }
});

test('ネット近くで低い球を強打すると浮いて、相手のスマッシュのチャンスになる', () => {
  for (const p of [[0, 0.3, 2.3], [0, 0.4, 3]]) {
    const res = flight(p, SHOT.DRIVE);
    assert.equal(res.kind, 'pop');
    assert.ok(res.overKitchen > 1.5, `キッチンの相手の打点が高い ${p}: ${res.overKitchen.toFixed(2)}`);
    assert.ok(res.t > 1.1 * 60, `遅い ${p}: ${res.t}`);
  }
});

test('必殺ショットはそれぞれ持ち味があり、相手コートに入る', () => {
  for (const p of [[0, 0.6, 6.5], [1, 0.3, 2.3], [-1, 1.0, 4]]) {
    const drive = flight(p, SHOT.DRIVE);
    const soft = flight(p, SHOT.SOFT);
    const meteor = flight(p, SPECIAL_KINDS.meteor);
    const drop = flight(p, SPECIAL_KINDS.drop);
    const curve = flight(p, SPECIAL_KINDS.curve, 1);
    const star = flight(p, SPECIAL_KINDS.star);
    assert.ok(meteor.t < drive.t || drive.kind === 'pop', `メテオは強打より速い ${p}: ${meteor.t} vs ${drive.t}`);
    assert.ok(meteor.t <= 0.7 * 60, `メテオは速い ${p}: ${meteor.t}`);
    assert.ok(Math.abs(drop.z) < Math.abs(soft.z) && drop.bounceTop < soft.bounceTop, `ドロップはソフトより手前で弾まない ${p}`);
    assert.ok(Math.abs(curve.x) > 2.4, `カーブはサイドラインぎりぎりに入る ${p}: ${curve.x.toFixed(2)}`);
    assert.ok(star.overKitchen > REACH_MAX_Y + 1 && star.t < 1.6 * 60, `スターは高く速く落ちる ${p}`);
    assert.ok(Math.abs(star.z) > 5.8, `スターはコートの奥に落ちる ${p}: ${star.z.toFixed(2)}`);
  }
});

test('必殺ゲージ: たまるまで打てず、満タンでキャラの必殺ショットになり、打つと空になる', () => {
  const m = new Match({ chars: [6, 2] });
  for (let i = 0; i < 40; i++) m.step();
  assert.ok(m.serve(0, SHOT.DRIVE, 0, 0));
  const pl = m.players[1];
  const ready = () => {
    // サーブが返球側コートでバウンドして上がってきたところ
    for (let i = 0; i < 300 && !(m.rally.bounces === 1 && m.rally.v[1] < 0 && m.rally.p[1] < 0.9); i++) m.step();
    pl.x = m.rally.p[0] - 0.6;
    pl.z = m.rally.p[2] - 0.4;
  };
  ready();
  assert.equal(m.hit(1, m.tick, SPECIAL, 0, 0, pl.x, pl.z), 'gauge');
  pl.sp = SP_MAX;
  assert.equal(m.hit(1, m.tick, SPECIAL, 0, 0, pl.x, pl.z), null);
  assert.equal(m.rally.kind, specialOf(2).kind);
  assert.equal(pl.sp, 0);
  const ev = m.events.find((e) => e.type === 'hit' && e.by === 1);
  assert.equal(ev.kind, SPECIAL_KINDS.meteor);
});
