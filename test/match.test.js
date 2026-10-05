import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../shared/match.js';
import { Bot } from '../shared/ai.js';
import {
  createRally, stepRally, hitBlockReason, applyServe, applyHit, inServiceCourt,
} from '../shared/rally.js';
import { SHOT, REACH, REACH_MAX_Y, KITCHEN, DIVE_REACH, DIVE_QUALITY } from '../shared/constants.js';

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
    const { m, reasons, hits, rallies } = playBots(lv, { pointsToWin: 11 });
    assert.equal(m.phase, 'gameOver', `終了しない ${lv} score=${m.score}`);
    assert.ok(hits / rallies > 2.2, `ラリーが短すぎる ${lv}: ${(hits / rallies).toFixed(2)} ${JSON.stringify(reasons)}`);
    console.log(`level ${lv}: score ${m.score} avgHits ${(hits / rallies).toFixed(2)} ${JSON.stringify(reasons)}`);
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

test('ショットごとに性格がはっきり違う (強打は速い・ソフトは弾まない・ロブはネット際の相手を越える)', () => {
  for (const p of [[0, 0.6, 6.5], [0, 0.6, 2.3], [0, 0.3, 2.3]]) {
    const res = {};
    for (const shot of Object.values(SHOT)) {
      const r = createRally(1, true);
      r.active = true;
      r.p = [...p];
      r.hitCount = 3;
      r.lastHitter = 1;
      r.bounces = 1;
      applyHit(r, 0, shot, 0, 0, p[0] + 0.7, p[2]);
      const ev = [];
      let t = 0;
      let overKitchen = null;
      let bounceTop = 0;
      while (t < 400 && ev.length < 2) {
        const pz = r.p[2];
        stepRally(r, ev);
        t++;
        if (pz > -KITCHEN && r.p[2] <= -KITCHEN) overKitchen = r.p[1];
        if (ev.length === 1) bounceTop = Math.max(bounceTop, r.p[1]);
        if (ev.length === 1 && !res[shot]) res[shot] = { t };
      }
      assert.equal(ev[0].type, 'bounce');
      Object.assign(res[shot], { overKitchen, bounceTop });
    }
    const at = p.join(',');
    assert.ok(res.drive.t < 0.85 * 60, `強打は速い ${at}: ${res.drive.t}`);
    assert.ok(res.soft.t > res.drive.t * 1.35, `ソフトは強打より遅い ${at}`);
    assert.ok(res.soft.bounceTop < 0.45, `ソフトは低く弾む ${at}: ${res.soft.bounceTop.toFixed(2)}`);
    assert.ok(res.lob.overKitchen > REACH_MAX_Y, `ロブはキッチンの相手の頭を越える ${at}: ${res.lob.overKitchen.toFixed(2)}`);
    assert.ok(res.lob.bounceTop < 1.5, `ロブは弾んでもスマッシュされる高さにならない ${at}: ${res.lob.bounceTop.toFixed(2)}`);
  }
});
