import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../shared/match.js';
import { Bot } from '../shared/ai.js';
import { createRally, stepRally, hitBlockReason, applyServe, inServiceCourt } from '../shared/rally.js';
import { SHOT } from '../shared/constants.js';

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
