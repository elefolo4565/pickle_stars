// アプリ全体の流れ: タイトル → マッチング → 試合 → 結果
import { GameScene, IS_TOUCH, MENU_CHAR_Z } from './scene.js';
import { Chibi, CHARACTERS, EMOJIS } from './characters.js';
import { Input } from './input.js';
import { NetConnection, LocalConnection } from './net.js';
import { GameSession } from './game.js';
import { Hud, Modal, initSegs, segValue, toast } from './hud.js';
import { unlockAudio, sfx, setSound, soundOn } from './audio.js';
import { music } from './music.js';
import { SHOT } from '@shared/constants.js';

const $ = (id) => document.getElementById(id);
if (IS_TOUCH) document.body.classList.add('touch');

function load(key, def) {
  try {
    return localStorage.getItem(key) ?? def;
  } catch {
    return def;
  }
}
function save(key, v) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 保存できなくても続行
  }
}

const scene = new GameScene($('gl'));
const input = new Input();
const modal = new Modal();
initSegs();

const state = {
  mode: 'menu', // 'menu' | 'game'
  charIdx: Math.max(0, Math.min(CHARACTERS.length - 1, Number(load('ps_char', '0')) || 0)),
  /** @type {NetConnection|null} */
  net: null,
  /** @type {NetConnection|LocalConnection|null} */
  conn: null,
  /** @type {GameSession|null} */
  session: null,
  menuChar: null,
  waiting: false,
};

// ---------- タイトル画面 ----------
const nameInput = /** @type {HTMLInputElement} */ ($('inp-name'));
nameInput.value = load('ps_name', '') || `プレイヤー${Math.floor(Math.random() * 900 + 100)}`;
nameInput.addEventListener('change', () => save('ps_name', nameInput.value.trim()));

function playerName() {
  const n = nameInput.value.trim().slice(0, 12) || 'プレイヤー';
  save('ps_name', n);
  return n;
}

function showMenuChar() {
  if (state.menuChar) scene.scene.remove(state.menuChar.root);
  const ch = new Chibi(state.charIdx);
  ch.root.position.set(0, 0, MENU_CHAR_Z);
  scene.scene.add(ch.root);
  state.menuChar = ch;
  ch.setMood('win');
  const def = CHARACTERS[state.charIdx];
  $('char-name').textContent = def.name;
  $('char-title').textContent = def.title;
  $('char-desc').textContent = def.desc;
  save('ps_char', String(state.charIdx));
}

$('char-prev').addEventListener('click', () => {
  state.charIdx = (state.charIdx + CHARACTERS.length - 1) % CHARACTERS.length;
  sfx.click();
  showMenuChar();
});
$('char-next').addEventListener('click', () => {
  state.charIdx = (state.charIdx + 1) % CHARACTERS.length;
  sfx.click();
  showMenuChar();
});

function updateSoundBtn() {
  $('btn-sound').textContent = `効果音: ${soundOn() ? 'ON' : 'OFF'}`;
  $('btn-bgm').textContent = `BGM: ${music.on() ? 'ON' : 'OFF'}`;
}
updateSoundBtn();
$('btn-sound').addEventListener('click', () => {
  setSound(!soundOn());
  updateSoundBtn();
});
$('btn-bgm').addEventListener('click', () => {
  music.set(!music.on());
  updateSoundBtn();
});

$('btn-full').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      await screen.orientation?.lock?.('landscape').catch(() => {});
    } else {
      await document.exitFullscreen();
    }
  } catch {
    toast('この端末では全画面にできません');
  }
});

// ブラウザは最初の操作まで音を出せないので、そのタイミングで音声を有効にして BGM を始める
function onFirstInput() {
  unlockAudio();
  music.refresh();
}
document.addEventListener('pointerdown', onFirstInput, { capture: true });
document.addEventListener('keydown', onFirstInput, { capture: true });

$('btn-howto').addEventListener('click', () => modal.open('pnl-howto'));
$('btn-create').addEventListener('click', () => modal.open('pnl-create'));
$('btn-join').addEventListener('click', () => {
  modal.open('pnl-join');
  setTimeout(() => $('inp-code').focus(), 50);
});
$('btn-cpu').addEventListener('click', () => modal.open('pnl-cpu'));

// ---------- オンライン ----------
async function ensureNet() {
  if (state.net && state.net.ws && state.net.ws.readyState === WebSocket.OPEN) return state.net;
  const net = new NetConnection();
  await net.connect();
  net.onMessage(onMessage);
  net.onClose = () => {
    state.net = null;
    if (state.conn === net) {
      toast('サーバーとの接続が切れました');
      backToMenu(false);
    } else if (state.waiting) {
      toast('サーバーとの接続が切れました');
      stopWaiting();
    }
  };
  state.net = net;
  return net;
}

async function online(action) {
  let net;
  try {
    net = await ensureNet();
  } catch (e) {
    toast('サーバーに接続できませんでした');
    return null;
  }
  net.send({ t: 'hello', name: playerName(), char: state.charIdx });
  action(net);
  return net;
}

function startWaiting(kind, code = '', opts = null) {
  state.waiting = true;
  $('wait-title').textContent = kind === 'quick' ? '対戦相手をさがしています' : '友だちを待っています';
  $('wait-room').classList.toggle('hidden', kind !== 'room');
  if (kind === 'room') {
    $('wait-code').textContent = code;
    $('wait-rule').textContent = opts ? `${opts.pointsToWin}点マッチ・${opts.scoring === 'sideout' ? 'サイドアウト' : 'ラリーポイント'}` : '';
  }
  modal.open('pnl-wait');
}

function stopWaiting() {
  state.waiting = false;
  if (modal.isOpen('pnl-wait')) modal.close();
}

$('btn-quick').addEventListener('click', () => {
  sfx.click();
  online((net) => {
    net.send({ t: 'quick' });
    startWaiting('quick');
  });
});

$('btn-create-go').addEventListener('click', () => {
  const opts = { pointsToWin: Number(segValue('points')), scoring: segValue('scoring') };
  online((net) => net.send({ t: 'create', opts }));
});

function joinCode(code) {
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 4) {
    toast('4文字のコードを入力してください');
    return;
  }
  online((net) => net.send({ t: 'join', code }));
}
$('btn-join-go').addEventListener('click', () => joinCode(/** @type {HTMLInputElement} */ ($('inp-code')).value));
$('inp-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinCode(/** @type {HTMLInputElement} */ ($('inp-code')).value);
});

$('btn-wait-cancel').addEventListener('click', () => {
  state.net?.send({ t: 'cancel' });
  stopWaiting();
});

$('btn-share').addEventListener('click', async () => {
  const code = $('wait-code').textContent;
  const url = `${location.origin}${location.pathname}?room=${code}`;
  const text = `ピックルスターズで対戦しよう！ ルームコード: ${code}`;
  try {
    if (navigator.share && IS_TOUCH) {
      await navigator.share({ title: 'ピックルスターズ', text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('招待リンクをコピーしました');
  } catch {
    toast(url, 6000);
  }
});

// ---------- CPU 戦 ----------
$('btn-cpu-go').addEventListener('click', () => {
  const level = Number(segValue('level'));
  const pointsToWin = Number(segValue('cpupoints'));
  let cpuChar = Math.floor(Math.random() * (CHARACTERS.length - 1));
  if (cpuChar >= state.charIdx) cpuChar++;
  const conn = new LocalConnection({
    name: playerName(),
    char: state.charIdx,
    level,
    cpuChar,
    opts: { pointsToWin, scoring: 'rally' },
  });
  conn.onMessage(onMessage);
  state.conn = conn;
  modal.close();
  conn.start();
});

// ---------- 試合 ----------
const hud = new Hud(modal, {
  onRematch() {
    state.conn?.send({ t: 'rematch' });
    if (state.conn && !state.conn.online) return;
  },
  onMenu() {
    backToMenu(true);
  },
});

function onMessage(msg) {
  switch (msg.t) {
    case 'queued':
      break;
    case 'created':
      startWaiting('room', msg.code, msg.opts);
      break;
    case 'error':
      toast(msg.msg || 'エラーが発生しました');
      if (modal.isOpen('pnl-wait')) stopWaiting();
      break;
    case 'start':
      startGame(msg);
      break;
    case 'left':
      break;
    default:
      state.session?.handle(msg);
  }
}

function startGame(start) {
  stopWaiting();
  modal.close();
  if (state.session) state.session.dispose();
  // オンラインの場合はメッセージを受けた接続を使う
  if (!state.conn || state.conn.online) state.conn = state.net;
  if (state.menuChar) {
    scene.scene.remove(state.menuChar.root);
    state.menuChar = null;
  }
  $('scr-title').classList.add('hidden');
  input.clear();
  state.session = new GameSession({ scene, conn: state.conn, start, input, hud });
  state.mode = 'game';
  hud.show();
  sfx.click();
  music.play('match');
}

function backToMenu(sendLeave) {
  modal.close();
  if (state.session) {
    state.session.dispose();
    state.session = null;
  }
  if (state.conn) {
    if (state.conn.online) {
      if (sendLeave) state.conn.send({ t: 'leave' });
    } else {
      state.conn.close();
    }
  }
  state.conn = null;
  hud.hide();
  $('scr-title').classList.remove('hidden');
  state.mode = 'menu';
  $('emote-menu').classList.add('hidden');
  showMenuChar();
  music.play('menu');
}

$('btn-exit').addEventListener('click', () => {
  const msg = state.conn && state.conn.online ? '試合をやめてメニューに戻りますか？（相手の勝ちになります）' : '試合をやめてメニューに戻りますか？';
  if (state.session && !state.session.over && !confirm(msg)) return;
  backToMenu(true);
});

// エモート
const emoteMenu = $('emote-menu');
EMOJIS.forEach((e, i) => {
  const b = document.createElement('button');
  b.textContent = e;
  b.addEventListener('click', () => {
    state.session?.sendEmote(i);
    emoteMenu.classList.add('hidden');
  });
  emoteMenu.appendChild(b);
});
$('btn-emote').addEventListener('click', () => emoteMenu.classList.toggle('hidden'));

// タッチ操作
input.attachJoystick($('touch-zone'), $('joy-base'), $('joy-knob'));
input.attachButton($('shot-drive'), SHOT.DRIVE);
input.attachButton($('shot-soft'), SHOT.SOFT);
input.attachButton($('shot-lob'), SHOT.LOB);

// ---------- メインループ ----------
let last = performance.now();
let menuTime = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.mode === 'game' && state.session) {
    state.conn?.update();
    state.session?.update(dt);
  } else {
    menuTime += dt;
    if (state.menuChar) {
      state.menuChar.root.rotation.y = Math.sin(menuTime * 0.7) * 0.5;
      state.menuChar.update(dt, 0);
      if (!state.menuChar.mood && Math.random() < dt * 0.3) state.menuChar.strike(['fh', 'bh', 'oh'][Math.floor(Math.random() * 3)]);
    }
    scene.updateMenuCamera(dt, menuTime);
  }
  scene.render();
}
scene.renderer.setAnimationLoop(frame);

showMenuChar();
music.play('menu');

// 招待リンク (?room=XXXX) から来た場合
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  /** @type {HTMLInputElement} */ ($('inp-code')).value = roomParam.toUpperCase().slice(0, 4);
  modal.open('pnl-join');
  history.replaceState(null, '', location.pathname + (location.search.includes('debug') ? '?debug' : ''));
}

// バックグラウンドから戻ったときにフレーム時間が飛ばないように
document.addEventListener('visibilitychange', () => {
  last = performance.now();
});

// デバッグ用 (?debug を付けたときだけ内部状態を公開)
if (new URLSearchParams(location.search).has('debug')) window.__ps = { state, input, scene };
