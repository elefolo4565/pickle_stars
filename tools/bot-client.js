// オンライン対戦の動作確認用ボットクライアント。
// 実際のブラウザと同じプロトコルでサーバーに接続し、CPU ロジックでプレイする。
//
// 使い方:
//   node tools/bot-client.js                  … クイックマッチに参加
//   node tools/bot-client.js ABCD             … ルームコード ABCD に参加
// 環境変数:
//   SERVER=ws://localhost:3000/ws  LAG=80 (片道の人工遅延 ms)  LEVEL=1 (0〜2)
import { WebSocket } from 'ws';
import { performance } from 'node:perf_hooks';
import { DT, DT_MS } from '../shared/constants.js';
import { cloneRally, stepRally, applyHit } from '../shared/rally.js';
import { Bot } from '../shared/ai.js';

const SERVER = process.env.SERVER || 'ws://localhost:3000/ws';
const LAG = Number(process.env.LAG) || 0;
const LEVEL = Number(process.env.LEVEL ?? 1);
const code = process.argv[2];

const ws = new WebSocket(SERVER);
const delay = (fn) => (LAG ? setTimeout(fn, LAG) : fn());
const send = (msg) => delay(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)));

let offset = 0;
let bestRtt = Infinity;
let game = null;
const stats = { hits: 0, rejected: {}, points: [] };

function serverNow() {
  return performance.now() + offset;
}

ws.on('open', () => {
  send({ t: 'hello', name: `BOT${LAG ? `(${LAG * 2}ms)` : ''}`, char: 4 });
  send(code ? { t: 'join', code } : { t: 'quick' });
  setInterval(() => send({ t: 'ping', c: performance.now() }), 500);
  console.log(`connected ${SERVER} lag=${LAG}ms x2`);
});

ws.on('message', (data) => delay(() => onMessage(JSON.parse(data.toString()))));
ws.on('close', () => {
  console.log('closed', JSON.stringify(stats));
  process.exit(0);
});

function onMessage(msg) {
  switch (msg.t) {
    case 'pong': {
      const now = performance.now();
      const rtt = now - msg.c;
      if (rtt < bestRtt * 1.2) {
        bestRtt = Math.min(bestRtt, rtt);
        offset = msg.s + rtt / 2 - now;
      }
      break;
    }
    case 'start':
      console.log(`start: you=${msg.you} vs ${msg.players[1 - msg.you].name}`);
      startGame(msg);
      break;
    case 's':
      if (game) onSnapshot(msg);
      break;
    case 'ev':
      if (msg.e.type === 'point') {
        stats.points.push(`${msg.e.winner === game.idx ? 'W' : 'L'}:${msg.e.reason}`);
        console.log(`point ${msg.e.score} ${msg.e.reason} (winner ${msg.e.winner})`);
      }
      if (msg.e.type === 'gameOver') {
        console.log('game over', msg.e.score, JSON.stringify(stats));
        setTimeout(() => send({ t: 'rematch' }), 2000);
      }
      break;
    case 'hitNo':
      stats.rejected[msg.reason] = (stats.rejected[msg.reason] || 0) + 1;
      console.log('hit rejected:', msg.reason);
      game.pendingSeq = -1;
      break;
    case 'oppLeft':
      console.log('opponent left', JSON.stringify(stats));
      process.exit(0);
      break;
    case 'error':
      console.log('error:', msg.msg);
      process.exit(1);
      break;
    default:
      break;
  }
}

function startGame(start) {
  const idx = start.you;
  const g = {
    idx,
    startTime: start.startTime,
    bot: new Bot(idx, LEVEL),
    rs: -1,
    pendingSeq: -1,
    pendingUntil: 0,
    sim: null,
    // Bot が操作する Match 互換のオブジェクト
    m: {
      tick: 0,
      phase: 'serve',
      phaseTime: 0,
      rally: null,
      players: [{ x: 0, z: 0, ry: 0 }, { x: 0, z: 0, ry: 0 }],
      serve(i, shot, ax, ay) {
        send({ t: 'srv', s: shot, ax, ay });
        this.phaseTime = -999; // サーバーから状態が返るまで再送しない
        return true;
      },
      hit(i, tick, shot, ax, ay, px, pz) {
        send({ t: 'hit', k: tick, s: shot, ax, ay, x: px, z: pz });
        applyHit(this.rally, i, shot, ax, ay, px, pz);
        g.pendingSeq = this.rally.seq;
        g.pendingUntil = performance.now() + 800;
        stats.hits++;
        return null;
      },
    },
  };
  game = g;
}

function onSnapshot(s) {
  const g = game;
  const m = g.m;
  if (s.ph !== m.phase) {
    m.phase = s.ph;
    m.phaseTime = 0;
  }
  const me = s.pl[g.idx];
  if (me[3] !== g.rs) {
    g.rs = me[3];
    m.players[g.idx].x = me[0];
    m.players[g.idx].z = me[1];
  }
  const op = s.pl[1 - g.idx];
  m.players[1 - g.idx].x = op[0];
  m.players[1 - g.idx].z = op[1];
  if (g.pendingSeq >= 0 && s.b.seq < g.pendingSeq && performance.now() < g.pendingUntil) return;
  g.pendingSeq = -1;
  g.sim = { tick: s.k, rally: cloneRally(s.b) };
}

// クライアントのフレームループ相当
setInterval(() => {
  const g = game;
  if (!g || !g.sim) return;
  const target = Math.floor((serverNow() - g.startTime) / DT_MS);
  const m = g.m;
  while (g.sim.tick < target) {
    stepRally(g.sim.rally);
    g.sim.tick++;
    m.tick = g.sim.tick;
    m.rally = g.sim.rally;
    m.phaseTime += DT;
    g.bot.update(m);
  }
  const p = m.players[g.idx];
  send({ t: 'in', x: p.x, z: p.z, ry: p.ry, rs: g.rs });
}, 16);
