// DOM の画面・HUD 操作
const $ = (id) => document.getElementById(id);

export class Modal {
  constructor() {
    this.el = $('modal');
    this.current = null;
    this.el.addEventListener('click', (e) => {
      if (e.target instanceof HTMLElement && e.target.hasAttribute('data-close')) this.close();
    });
  }

  open(id) {
    if (this.current) this.current.classList.remove('show');
    this.current = $(id);
    this.current.classList.add('show');
    this.el.classList.remove('hidden');
  }

  close() {
    if (this.current) this.current.classList.remove('show');
    this.current = null;
    this.el.classList.add('hidden');
  }

  isOpen(id) {
    return this.current && this.current.id === id;
  }
}

/** セグメントボタン (択一) の値 */
export function segValue(name) {
  const seg = document.querySelector(`.seg[data-name="${name}"]`);
  const on = seg && seg.querySelector('button.on');
  return on ? on.getAttribute('data-v') : null;
}

export function initSegs() {
  document.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target instanceof HTMLElement ? e.target.closest('button') : null;
      if (!b) return;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
  });
}

let toastTimer = 0;
export function toast(text, ms = 2600) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

export class Hud {
  /**
   * @param {Modal} modal
   * @param {{onRematch: () => void, onMenu: () => void}} cb
   */
  constructor(modal, cb) {
    this.modal = modal;
    this.cb = cb;
    this.el = $('hud');
    this.msgEl = $('msg');
    this.fbEl = $('feedback');
    this.msgTimer = 0;
    this.lastPing = -2;
    this.lastScore = '';
    $('btn-rematch').addEventListener('click', () => this.cb.onRematch());
    $('btn-menu').addEventListener('click', () => this.cb.onMenu());
  }

  show() {
    this.el.classList.remove('hidden');
    document.body.classList.add('ingame');
  }

  hide() {
    this.el.classList.add('hidden');
    document.body.classList.remove('ingame');
    this.msgEl.classList.remove('show');
  }

  setPlayers(me, opp, opts) {
    $('sb-me-name').textContent = me.name;
    $('sb-opp-name').textContent = opp.name;
    $('sb-rule').textContent = `${opts.pointsToWin}点${opts.scoring === 'sideout' ? '・SO' : ''}`;
  }

  /** 必殺ゲージ (0..1) */
  setGauge(me, opp) {
    const key = `${me}|${opp}`;
    if (key === this.lastGauge) return;
    this.lastGauge = key;
    $('sb-me-sp').style.width = `${me * 100}%`;
    $('sb-opp-sp').style.width = `${opp * 100}%`;
    $('sb-me-sp').parentElement.classList.toggle('ready', me >= 1);
    $('sb-opp-sp').parentElement.classList.toggle('ready', opp >= 1);
    const b = $('shot-sp');
    b.style.setProperty('--sp', String(Math.round(me * 100)));
    b.classList.toggle('ready', me >= 1);
  }

  /** @param {boolean|null} serveMe null ならサーブ表示なし */
  setScore(me, opp, serveMe) {
    const key = `${me}|${opp}|${serveMe}`;
    if (key === this.lastScore) return;
    this.lastScore = key;
    $('sb-me').textContent = String(me);
    $('sb-opp').textContent = String(opp);
    $('sb-me-serve').classList.toggle('on', serveMe === true);
    $('sb-opp-serve').classList.toggle('on', serveMe === false);
  }

  message(big, small = '', type = 'info', sec = 1.6) {
    const el = this.msgEl;
    el.querySelector('.msg-big').textContent = big;
    el.querySelector('.msg-small').textContent = small;
    el.className = `msg ${type}`;
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => el.classList.remove('show'), sec * 1000);
  }

  feedback(text, type = 'good') {
    const el = this.fbEl;
    el.textContent = text;
    el.className = `feedback ${type}`;
    void el.offsetWidth;
    el.classList.add('show');
  }

  ping(ms) {
    const v = ms < 0 ? -1 : Math.round(ms);
    if (v === this.lastPing) return;
    this.lastPing = v;
    $('ping').textContent = v < 0 ? 'OFFLINE' : `PING ${v}ms`;
  }

  showResult(win, me, opp, online) {
    const t = $('result-title');
    t.textContent = win ? '勝利！' : '敗北…';
    t.className = `result-title ${win ? 'win' : 'lose'}`;
    $('result-score').textContent = `${me} - ${opp}`;
    $('result-status').textContent = online ? '' : '';
    const b = $('btn-rematch');
    b.disabled = false;
    b.textContent = 'もう一度';
    this.modal.open('pnl-result');
  }

  rematchStatus(meReady, oppReady) {
    if (meReady && !oppReady) {
      $('result-status').textContent = '相手の返事を待っています…';
      $('btn-rematch').disabled = true;
    } else if (!meReady && oppReady) {
      $('result-status').textContent = '相手が再戦を希望しています！';
    }
  }

  oppLeft() {
    this.message('相手が退出しました', '', 'info', 3);
    $('result-title').textContent = '試合終了';
    $('result-title').className = 'result-title';
    $('result-score').textContent = '';
    $('result-status').textContent = '相手が退出しました';
    $('btn-rematch').disabled = true;
    this.modal.open('pnl-result');
  }
}
