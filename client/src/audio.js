// 効果音は WebAudio で合成する (音声ファイル不要)
let ctx = null;
let master = null;
let enabled = true;
let noiseBuf = null;

try {
  enabled = localStorage.getItem('ps_sound') !== 'off';
} catch {
  // localStorage が使えない環境
}

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

/** BGM など他のモジュールから同じ AudioContext を使うため */
export function audioContext() {
  return ctx;
}

export function setSound(on) {
  enabled = on;
  try {
    localStorage.setItem('ps_sound', on ? 'on' : 'off');
  } catch {
    // 保存できなくても動作は続ける
  }
}

export function soundOn() {
  return enabled;
}

function ready() {
  return enabled && ctx && ctx.state === 'running';
}

function tone(freq, freqEnd, dur, type, vol, delay = 0) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, freq, q, vol, delay = 0) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  /** パドルの「ポコッ」 */
  hit(kind = 'drive', quality = 1) {
    if (!ready()) return;
    const smash = kind === 'smash';
    const soft = kind === 'soft';
    const base = smash ? 700 : soft ? 1250 : 1000;
    tone(base, base * 0.45, 0.07, 'triangle', smash ? 0.9 : soft ? 0.35 : 0.6);
    noise(0.04, 2400, 1.2, smash ? 0.8 : 0.4);
    if (quality < 0.6) tone(300, 200, 0.06, 'square', 0.08);
  },
  bounce() {
    if (!ready()) return;
    tone(420, 160, 0.06, 'sine', 0.35);
    noise(0.03, 900, 1, 0.12);
  },
  net() {
    if (!ready()) return;
    noise(0.18, 500, 0.7, 0.4);
  },
  swing() {
    if (!ready()) return;
    noise(0.12, 1400, 0.6, 0.1);
  },
  win() {
    if (!ready()) return;
    tone(660, 660, 0.12, 'square', 0.12);
    tone(880, 880, 0.12, 'square', 0.12, 0.1);
    tone(1320, 1320, 0.25, 'square', 0.12, 0.2);
  },
  lose() {
    if (!ready()) return;
    tone(440, 420, 0.15, 'square', 0.1);
    tone(330, 300, 0.3, 'square', 0.1, 0.14);
  },
  click() {
    if (!ready()) return;
    tone(900, 1200, 0.05, 'sine', 0.2);
  },
  fanfare() {
    if (!ready()) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'square', 0.12, i * 0.12));
  },
};
