// 1 部屋 (1 試合) の進行とメッセージ処理。通信手段には依存しない。
// サーバーでは WebSocket 接続を、CPU 戦ではブラウザ内の擬似接続をメンバーとして持つ。
import { DT_MS, SNAPSHOT_EVERY, SHOT } from './constants.js';
import { Match } from './match.js';
import { Bot } from './ai.js';

const SHOTS = new Set(Object.values(SHOT));

/**
 * @typedef {Object} Member
 * @property {(msg: object) => void} send
 * @property {string} name
 * @property {number} char
 * @property {Bot} [bot]
 */

export class Room {
  /**
   * @param {{code: string, opts?: object, now: () => number}} p
   */
  constructor({ code, opts = {}, now }) {
    this.code = code;
    this.opts = {
      pointsToWin: [5, 7, 11, 15].includes(opts.pointsToWin) ? opts.pointsToWin : 11,
      scoring: opts.scoring === 'sideout' ? 'sideout' : 'rally',
    };
    this.now = now;
    /** @type {(Member|null)[]} */
    this.members = [null, null];
    this.match = null;
    this.startTime = 0;
    this.rematch = [false, false];
    this.closed = false;
  }

  get full() {
    return this.members[0] !== null && this.members[1] !== null;
  }

  /** @param {Member} m @returns {number} */
  addMember(m) {
    const idx = this.members[0] === null ? 0 : this.members[1] === null ? 1 : -1;
    if (idx >= 0) this.members[idx] = m;
    return idx;
  }

  addBot(level, name, char) {
    const idx = this.addMember({ send() {}, name, char, bot: null });
    this.members[idx].bot = new Bot(idx, level);
    return idx;
  }

  broadcast(msg) {
    for (const m of this.members) if (m) m.send(msg);
  }

  start() {
    this.match = new Match(this.opts);
    this.startTime = this.now();
    this.rematch = [false, false];
    for (const m of this.members) if (m && m.bot) m.bot = new Bot(m.bot.idx, m.bot.level);
    const players = this.members.map((m) => ({ name: m.name, char: m.char, bot: !!m.bot }));
    this.members.forEach((m, i) => {
      m.send({
        t: 'start',
        you: i,
        code: this.code,
        players,
        opts: this.opts,
        startTime: this.startTime,
      });
    });
    this.flush();
    this.broadcast(this.match.snapshot());
  }

  flush() {
    const ev = this.match.events;
    if (ev.length) {
      for (const e of ev) this.broadcast({ t: 'ev', k: this.match.tick, e });
      ev.length = 0;
    }
  }

  /** 実時間に合わせて tick を進める */
  update() {
    if (!this.match || this.closed) return;
    const m = this.match;
    let target = Math.floor((this.now() - this.startTime) / DT_MS);
    if (target - m.tick > 60) {
      // タブが裏に回った等で大きく遅れたら、時間基準をずらして追いつく
      this.startTime = this.now() - (m.tick + 1) * DT_MS;
      target = m.tick + 1;
      this.broadcast({ t: 'clock', startTime: this.startTime });
    }
    while (m.tick < target) {
      for (const mem of this.members) if (mem && mem.bot) mem.bot.update(m);
      m.step();
      this.flush();
      if (m.tick % SNAPSHOT_EVERY === 0) this.broadcast(m.snapshot());
    }
  }

  /** @param {number} idx @param {any} msg */
  handle(idx, msg) {
    const m = this.match;
    if (!m || !msg || typeof msg.t !== 'string') return;
    switch (msg.t) {
      case 'in':
        m.setPlayerInput(idx, +msg.x, +msg.z, +msg.ry, msg.rs | 0);
        break;
      case 'sw':
        if (SHOTS.has(msg.s)) m.swing(idx, msg.s);
        break;
      case 'hit': {
        if (!SHOTS.has(msg.s)) return;
        const err = m.hit(idx, +msg.k, msg.s, +msg.ax, +msg.ay, +msg.x, +msg.z);
        if (err) this.members[idx]?.send({ t: 'hitNo', q: msg.q, reason: err });
        else this.broadcast(m.snapshot());
        break;
      }
      case 'srv':
        if (!SHOTS.has(msg.s)) return;
        if (m.serve(idx, msg.s, +msg.ax || 0, +msg.ay || 0)) {
          this.flush();
          this.broadcast(m.snapshot());
        }
        break;
      case 'emo':
        if (Number.isInteger(msg.id) && msg.id >= 0 && msg.id < 8) m.emote(idx, msg.id);
        break;
      case 'rematch':
        if (m.phase !== 'gameOver') return;
        this.rematch[idx] = true;
        this.members.forEach((mem, i) => {
          if (mem && mem.bot) this.rematch[i] = true;
        });
        this.broadcast({ t: 'rematch', ready: this.rematch });
        if (this.rematch[0] && this.rematch[1]) this.start();
        break;
      default:
        break;
    }
  }

  removeMember(idx) {
    this.members[idx] = null;
    if (this.match) {
      this.closed = true;
      this.broadcast({ t: 'oppLeft' });
    }
  }
}
