// ゲームサーバー: 静的ファイル配信 + WebSocket (/ws) でのマッチングと試合進行。
// 本番では nginx の後ろで動かす想定 (deploy/README.md 参照)。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { Room } from '../shared/room.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 500;
const CHAR_COUNT = 7;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const now = () => performance.now();

// ---------- HTTP (静的ファイル) ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: wss.clients.size }));
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    const ext = path.extname(file);
    const immutable = p.startsWith('/assets/');
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------- マッチング ----------
/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Set<Client>} */
const quickQueue = new Set();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function sanitizeName(n) {
  const s = String(n ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
  return s || 'プレイヤー';
}

class Client {
  constructor(ws) {
    this.ws = ws;
    this.name = 'プレイヤー';
    this.char = 0;
    /** @type {Room|null} */
    this.room = null;
    this.idx = -1;
    this.alive = true;
    this.msgCount = 0;
  }

  send(msg) {
    const ws = this.ws;
    if (ws.readyState !== WebSocket.OPEN) return;
    // 回線が詰まっているときはスナップショットを間引く
    if (msg.t === 's' && ws.bufferedAmount > 128 * 1024) return;
    ws.send(JSON.stringify(msg));
  }

  member() {
    return { send: (m) => this.send(m), name: this.name, char: this.char };
  }

  leaveRoom() {
    quickQueue.delete(this);
    const room = this.room;
    if (!room) return;
    room.removeMember(this.idx);
    this.room = null;
    this.idx = -1;
    if (!room.members[0] && !room.members[1]) rooms.delete(room.code);
    else if (!room.match) {
      // 開始前に抜けた場合は部屋を閉じる
      rooms.delete(room.code);
    }
  }
}

function joinRoom(client, room) {
  client.idx = room.addMember(client.member());
  client.room = room;
}

function handleLobby(client, msg) {
  switch (msg.t) {
    case 'hello':
      client.name = sanitizeName(msg.name);
      client.char = Number.isInteger(msg.char) && msg.char >= 0 && msg.char < CHAR_COUNT ? msg.char : 0;
      break;
    case 'quick': {
      if (client.room) return;
      quickQueue.add(client);
      client.send({ t: 'queued' });
      if (quickQueue.size >= 2) {
        const [a, b] = [...quickQueue].slice(0, 2);
        quickQueue.delete(a);
        quickQueue.delete(b);
        const room = new Room({ code: newCode(), opts: {}, now });
        rooms.set(room.code, room);
        joinRoom(a, room);
        joinRoom(b, room);
        room.start();
      }
      break;
    }
    case 'create': {
      if (client.room) return;
      if (rooms.size >= MAX_ROOMS) {
        client.send({ t: 'error', msg: 'サーバーが混雑しています。しばらくしてからお試しください。' });
        return;
      }
      quickQueue.delete(client);
      const room = new Room({ code: newCode(), opts: msg.opts || {}, now });
      rooms.set(room.code, room);
      joinRoom(client, room);
      client.send({ t: 'created', code: room.code, opts: room.opts });
      break;
    }
    case 'join': {
      if (client.room) return;
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.full || room.match) {
        client.send({ t: 'error', msg: 'ルームが見つからないか、満員です。' });
        return;
      }
      quickQueue.delete(client);
      joinRoom(client, room);
      room.start();
      break;
    }
    case 'cancel':
    case 'leave':
      client.leaveRoom();
      client.send({ t: 'left' });
      break;
    default:
      break;
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

/** @type {Set<Client>} */
const clients = new Set();

wss.on('connection', (ws) => {
  const client = new Client(ws);
  clients.add(client);
  ws.on('pong', () => {
    client.alive = true;
  });
  ws.on('message', (data) => {
    if (++client.msgCount > 240) return; // 1 秒あたりの上限
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'ping') {
      client.send({ t: 'pong', c: msg.c, s: now() });
      return;
    }
    if (client.room && client.room.match && client.idx >= 0 && !['leave', 'cancel'].includes(msg.t)) {
      client.room.handle(client.idx, msg);
      return;
    }
    handleLobby(client, msg);
  });
  ws.on('close', () => {
    clients.delete(client);
    client.leaveRoom();
  });
  ws.on('error', () => {});
  client.send({ t: 'welcome', s: now() });
});

// メッセージ数カウンタのリセットと生存確認
setInterval(() => {
  for (const c of clients) c.msgCount = 0;
}, 1000);

setInterval(() => {
  for (const c of clients) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 15_000);

// ---------- 試合ループ ----------
setInterval(() => {
  for (const [code, room] of rooms) {
    room.update();
    if (room.closed && !room.members[0] && !room.members[1]) rooms.delete(code);
  }
}, 4);

server.listen(PORT, HOST, () => {
  console.log(`Pickle Stars server: http://${HOST}:${PORT}  (static: ${ROOT})`);
});
