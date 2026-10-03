// BGM も WebAudio で合成する (音声ファイル不要・著作権の心配なし)
// 曲は「メロディ + コード進行」で書き、ベース・伴奏・ドラムはパターンから自動生成する。
import { audioContext } from './audio.js';

let enabled = true;
try {
  enabled = localStorage.getItem('ps_bgm') !== 'off';
} catch {
  // localStorage が使えない環境
}

/*
 * メロディの書き方: 空白区切りで 1 トークン = 8 分音符 1 つ。
 * "E5:2" のように :n を付けると n 個分伸ばす。"." は休符。1 小節 = 8 分音符 8 個。
 */
const SONGS = {
  // タイトル画面: のんびり明るく
  menu: {
    bpm: 112,
    vol: 0.2,
    style: 'easy',
    chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G'],
    melody: [
      'E5 G5 . G5 A5 G5 E5 C5',
      'D5:2 E5 C5:3 .:2',
      'F5 A5 . A5 C6 A5 F5 E5',
      'D5:2 B4 G4:3 .:2',
      'E5 G5 . G5 A5 G5 E5 G5',
      'C6:2 B5 A5:2 E5 .:2',
      'F5 E5 D5 F5 A5:2 G5 F5',
      'E5:2 D5:2 B4:2 G4 .',
    ],
  },
  // 試合中: テンポよく元気に (効果音が聞こえるよう少し控えめの音量)
  match: {
    bpm: 144,
    vol: 0.15,
    style: 'drive',
    chords: ['G', 'Em', 'C', 'D', 'G', 'Em', 'C', 'D', 'C', 'D', 'Bm', 'Em', 'C', 'D', 'G', 'D'],
    melody: [
      'D5 G5 . G5 B5 . A5 G5',
      'E5:2 G5 E5 B4:2 .:2',
      'C5 E5 . G5 C6 . B5 A5',
      'A5:2 F#5 D5 A4:2 D5 F#5',
      'G5 B5 . D6 B5 . G5 B5',
      'A5:2 G5 E5 G5:2 .:2',
      'E5 G5 C6 B5 A5:2 G5 E5',
      'F#5:3 E5 D5:2 .:2',
      'E5:2 E5 G5 . E5 D5 C5',
      'D5:2 F#5 A5 . A5 B5 A5',
      'F#5:2 D5 F#5 B5:2 A5 F#5',
      'G5:3 E5 B4:2 .:2',
      'C5 E5 G5 C6 . C6 B5 C6',
      'D6:2 C6 B5 A5:2 F#5 A5',
      'G5:2 B5 D6 G6:2 . D6',
      'B5 A5 G5 F#5 A5:2 .:2',
    ],
  },
};

// 16 分音符 16 個ぶんの伴奏パターン
const STYLES = {
  easy: {
    kick: [0, 8, 11],
    snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    // [ステップ, 'r'=根音 / 'f'=5度 / 'o'=オクターブ上]
    bass: [[0, 'r'], [3, 'r'], [6, 'f'], [8, 'r'], [11, 'r'], [14, 'f']],
    stab: [2, 6, 10, 14],
  },
  drive: {
    kick: [0, 6, 8, 10],
    snare: [4, 12],
    hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    bass: [[0, 'r'], [2, 'o'], [4, 'r'], [6, 'o'], [8, 'r'], [10, 'o'], [12, 'f'], [14, 'o']],
    stab: [2, 6, 10, 13],
  },
};

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "F#5" → MIDI ノート番号 */
function midi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note: ${name}`);
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function freq(n) {
  return 440 * 2 ** ((n - 69) / 12);
}

/** "Am" / "F#m" → 根音 (オクターブ 2〜3 付近) と和音の構成音 */
function chordNotes(name) {
  const m = /^([A-G][#b]?)(m?)$/.exec(name);
  if (!m) throw new Error(`bad chord: ${name}`);
  const root = midi(`${m[1]}2`);
  const third = m[2] ? 3 : 4;
  // 伴奏の和音はオクターブ 4 付近に収める
  let base = root + 24;
  if (base > midi('E4')) base -= 12;
  return { root, tones: [base, base + third, base + 7] };
}

/** 曲データを「16 分音符ステップごとのイベント列」に展開する */
export function compile(song) {
  const bars = song.chords.length;
  const steps = bars * 16;
  const lead = new Array(steps).fill(null);
  song.melody.forEach((line, bar) => {
    let pos = 0;
    for (const tok of line.trim().split(/\s+/)) {
      const [n, len = '1'] = tok.split(':');
      const eighths = Number(len);
      if (n !== '.') lead[bar * 16 + pos * 2] = { n: midi(n), len: eighths * 2 };
      pos += eighths;
    }
    if (pos !== 8) throw new Error(`bar ${bar + 1} has ${pos} eighths`);
  });
  if (song.melody.length !== bars) throw new Error('melody / chords length mismatch');
  return { steps, lead, chords: song.chords.map(chordNotes) };
}

const compiled = {};
for (const k of Object.keys(SONGS)) compiled[k] = compile(SONGS[k]);

let noiseBuf = null;
let current = null; // 再生中の曲

function getNoise(ctx) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function osc(ctx, out, type, f, t, dur, vol, attack = 0.005) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noiseHit(ctx, out, t, dur, type, f, vol) {
  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

class Player {
  constructor(ctx, key) {
    this.ctx = ctx;
    this.key = key;
    this.song = SONGS[key];
    this.data = compiled[key];
    this.style = STYLES[this.song.style];
    this.stepDur = 60 / this.song.bpm / 4;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.out.gain.exponentialRampToValueAtTime(this.song.vol, ctx.currentTime + 0.6);
    this.out.connect(ctx.destination);
    // メロディと伴奏は少しこもらせて耳に痛くないようにする
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 2600;
    this.tone.connect(this.out);
    this.step = 0;
    this.next = ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.pump(), 25);
  }

  pump() {
    const ctx = this.ctx;
    // タブが裏に回るなどで大きく遅れたら、今の時刻から続ける
    if (this.next < ctx.currentTime - 0.1) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + 0.15) {
      this.play(this.step, this.next);
      this.next += this.stepDur;
      this.step = (this.step + 1) % this.data.steps;
    }
  }

  play(step, t) {
    const { ctx, out, tone, style, stepDur } = this;
    const s = step % 16;
    const chord = this.data.chords[Math.floor(step / 16)];
    const note = this.data.lead[step];
    if (note) {
      const dur = note.len * stepDur * 0.92;
      osc(ctx, tone, 'square', freq(note.n), t, dur, 0.09);
      osc(ctx, tone, 'triangle', freq(note.n), t, dur, 0.12);
    }
    for (const [bs, kind] of style.bass) {
      if (bs !== s) continue;
      const n = kind === 'f' ? chord.root + 7 : kind === 'o' ? chord.root + 12 : chord.root;
      osc(ctx, out, 'triangle', freq(n), t, stepDur * 1.8, 0.55);
    }
    if (style.stab.includes(s)) {
      for (const n of chord.tones) osc(ctx, tone, 'sawtooth', freq(n), t, stepDur * 1.3, 0.035);
    }
    if (style.kick.includes(s)) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.7, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.18);
    }
    if (style.snare.includes(s)) {
      noiseHit(ctx, out, t, 0.13, 'bandpass', 1900, 0.4);
      osc(ctx, out, 'triangle', 190, t, 0.08, 0.15);
    }
    if (style.hat.includes(s)) {
      noiseHit(ctx, out, t, s % 2 ? 0.025 : 0.04, 'highpass', 7500, s % 4 === 2 ? 0.14 : 0.08);
    }
  }

  stop(fade = 0.5) {
    clearInterval(this.timer);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), t);
    this.out.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    const out = this.out;
    setTimeout(() => out.disconnect(), (fade + 0.3) * 1000);
  }

  setHidden(hidden) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(hidden ? 0.0001 : this.song.vol, t, 0.1);
  }
}

let wanted = null; // 鳴らしたい曲 (BGM OFF や音声未解禁の間も覚えておく)

function sync() {
  const ctx = audioContext();
  const key = enabled && ctx ? wanted : null;
  if (current && current.key === key) return;
  if (current) current.stop();
  current = key ? new Player(ctx, key) : null;
}

export const music = {
  /** 'menu' / 'match' を鳴らす。同じ曲なら何もしない */
  play(key) {
    wanted = key;
    sync();
  },
  /** フェードアウトして止める */
  stop() {
    wanted = null;
    sync();
  },
  /** 音声が使えるようになったとき (最初のタップ後) に呼ぶ */
  refresh() {
    sync();
  },
  on() {
    return enabled;
  },
  set(on) {
    enabled = on;
    try {
      localStorage.setItem('ps_bgm', on ? 'on' : 'off');
    } catch {
      // 保存できなくても動作は続ける
    }
    sync();
  },
};

// 別のタブを見ている間は BGM を消す (裏では音が途切れ途切れになるため)
document.addEventListener('visibilitychange', () => current?.setHidden(document.hidden));
