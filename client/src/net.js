// サーバーとの通信。オンライン用 (WebSocket) と CPU 戦用 (ブラウザ内で Room を動かす) を同じインターフェースで扱う。
import { Room } from '@shared/room.js';

/**
 * @typedef {Object} Connection
 * @property {(msg: object) => void} send
 * @property {(fn: (msg: any) => void) => void} onMessage
 * @property {() => number} serverNow サーバー時計の推定値 (ms)
 * @property {() => number} rtt
 * @property {() => void} update 毎フレーム呼ぶ
 * @property {() => void} close
 * @property {boolean} online
 */

/** @implements {Connection} */
export class NetConnection {
  constructor() {
    this.online = true;
    this.ws = null;
    this.handler = () => {};
    this.offset = 0;
    this.samples = [];
    this._rtt = 0;
    this.pingTimer = 0;
    this.onClose = () => {};
  }

  /** @returns {Promise<void>} */
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}${location.pathname.replace(/[^/]*$/, '')}ws`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.startPing();
        resolve();
      };
      ws.onerror = () => {
        if (!opened) reject(new Error('サーバーに接続できませんでした'));
      };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (opened) this.onClose();
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === 'pong') this.onPong(msg);
        else if (msg.t !== 'welcome') this.handler(msg);
      };
    });
  }

  startPing() {
    let n = 0;
    const ping = () => this.send({ t: 'ping', c: performance.now() });
    ping();
    // 最初は短い間隔で何度か測って時計を合わせる
    const fast = setInterval(() => {
      ping();
      if (++n >= 6) clearInterval(fast);
    }, 150);
    this.pingTimer = setInterval(ping, 1000);
  }

  onPong(msg) {
    const t = performance.now();
    const rtt = t - msg.c;
    this.addSample(msg.s + rtt / 2 - t, rtt);
  }

  addSample(offset, rtt) {
    this.samples.push({ offset, rtt });
    if (this.samples.length > 12) this.samples.shift();
    // RTT が最小のサンプルが一番正確
    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    // 急なジャンプを避けて少しずつ寄せる
    if (this.samples.length <= 2) this.offset = best.offset;
    else this.offset += (best.offset - this.offset) * 0.5;
    this._rtt = this._rtt ? this._rtt * 0.7 + rtt * 0.3 : rtt;
  }

  serverNow() {
    return performance.now() + this.offset;
  }

  rtt() {
    return this._rtt;
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(fn) {
    this.handler = fn;
  }

  update() {}

  close() {
    clearInterval(this.pingTimer);
    this.onClose = () => {};
    this.ws?.close();
  }
}

/**
 * CPU 戦: サーバーと同じ Room をブラウザ内で動かす
 * @implements {Connection}
 */
export class LocalConnection {
  constructor({ name, char, level, cpuChar, opts }) {
    this.online = false;
    this.handler = () => {};
    this.queue = [];
    // 一時停止できる時計。止めている間の時間を差し引くので、再開しても試合が飛ばない
    this.pausedAt = -1;
    this.pausedTotal = 0;
    this.room = new Room({ code: 'CPU', opts, now: () => this.serverNow() });
    this.room.addMember({
      send: (m) => this.queue.push(structuredClone(m)),
      name,
      char,
    });
    const cpuNames = ['かんたんCPU', 'ふつうCPU', 'つよいCPU'];
    this.room.addBot(level, cpuNames[level] || 'CPU', cpuChar);
  }

  start() {
    this.room.start();
    this.deliver();
  }

  deliver() {
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.handler(m);
  }

  send(msg) {
    if (msg.t === 'leave' || msg.t === 'cancel') return;
    this.room.handle(0, structuredClone(msg));
  }

  onMessage(fn) {
    this.handler = fn;
  }

  serverNow() {
    const t = this.pausedAt >= 0 ? this.pausedAt : performance.now();
    return t - this.pausedTotal;
  }

  /** CPU 戦だけ一時停止できる */
  setPaused(paused) {
    if (paused && this.pausedAt < 0) this.pausedAt = performance.now();
    if (!paused && this.pausedAt >= 0) {
      this.pausedTotal += performance.now() - this.pausedAt;
      this.pausedAt = -1;
    }
  }

  get paused() {
    return this.pausedAt >= 0;
  }

  rtt() {
    return 0;
  }

  update() {
    if (this.paused) return;
    this.room.update();
    this.deliver();
  }

  close() {
    this.room.closed = true;
  }
}
