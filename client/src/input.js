// 入力: キーボード / タッチ (バーチャルスティック + ショットボタン) / ゲームパッド
import { SHOT } from '@shared/constants.js';

const KEY_SHOT = {
  Space: SHOT.DRIVE,
  KeyJ: SHOT.DRIVE,
  KeyK: SHOT.SOFT,
  KeyL: SHOT.LOB,
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.presses = [];
    this.held = new Set();
    this.joy = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    this.padPrev = [];
    this.emotePress = -1;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      const s = KEY_SHOT[e.code];
      if (s) this.press(s);
      if (/^Digit[1-8]$/.test(e.code)) this.emotePress = Number(e.code.slice(5)) - 1;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const s = KEY_SHOT[e.code];
      if (s) this.release(s);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.held.clear();
    });
  }

  press(shot) {
    if (!this.enabled) return;
    this.presses.push(shot);
    this.held.add(shot);
  }

  release(shot) {
    this.held.delete(shot);
  }

  /** バーチャルスティックを要素に取り付ける */
  attachJoystick(zone, base, knob) {
    const R = 56;
    const j = this.joy;
    const show = () => {
      base.style.transform = `translate(${j.ox - 64}px, ${j.oy - 64}px)`;
      base.style.opacity = '1';
    };
    zone.addEventListener('pointerdown', (e) => {
      if (j.active) return;
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      j.active = true;
      j.id = e.pointerId;
      j.ox = e.clientX;
      j.oy = e.clientY;
      j.x = j.y = 0;
      knob.style.transform = 'translate(0px, 0px)';
      show();
    });
    zone.addEventListener('pointermove', (e) => {
      if (!j.active || e.pointerId !== j.id) return;
      let dx = e.clientX - j.ox;
      let dy = e.clientY - j.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        // 指が大きく離れたら原点ごと引っ張る (操作が途切れないように)
        const over = d - R;
        j.ox += (dx / d) * over;
        j.oy += (dy / d) * over;
        dx = (dx / d) * R;
        dy = (dy / d) * R;
        show();
      }
      j.x = dx / R;
      j.y = -dy / R;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const end = (e) => {
      if (e.pointerId !== j.id) return;
      j.active = false;
      j.id = -1;
      j.x = j.y = 0;
      knob.style.transform = 'translate(0px, 0px)';
      base.style.opacity = '0.35';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  /** ショットボタンを取り付ける */
  attachButton(el, shot) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('down');
      this.press(shot);
    });
    const up = () => {
      el.classList.remove('down');
      this.release(shot);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && [...pads].find((p) => p && p.connected);
    if (!pad) return null;
    const map = [SHOT.DRIVE, SHOT.SOFT, SHOT.LOB, SHOT.LOB];
    for (let i = 0; i < 4; i++) {
      const down = !!pad.buttons[i]?.pressed;
      if (down && !this.padPrev[i]) this.press(map[i]);
      if (!down && this.padPrev[i]) this.release(map[i]);
      this.padPrev[i] = down;
    }
    let x = pad.axes[0] || 0;
    let y = -(pad.axes[1] || 0);
    if (pad.buttons[12]?.pressed) y = 1;
    if (pad.buttons[13]?.pressed) y = -1;
    if (pad.buttons[14]?.pressed) x = -1;
    if (pad.buttons[15]?.pressed) x = 1;
    if (Math.hypot(x, y) < 0.18) return null;
    return { x, y };
  }

  /** 移動入力 (x: 右が正, y: 前=ネット方向が正)、長さ最大1 */
  getMove() {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (this.joy.active) {
      x += this.joy.x;
      y += this.joy.y;
    }
    const pad = this.pollGamepad();
    if (pad) {
      x += pad.x;
      y += pad.y;
    }
    const d = Math.hypot(x, y);
    if (d > 1) {
      x /= d;
      y /= d;
    }
    if (!this.enabled) return { x: 0, y: 0 };
    return { x, y };
  }

  takePress() {
    return this.presses.shift() || null;
  }

  takeEmote() {
    const e = this.emotePress;
    this.emotePress = -1;
    return e;
  }

  clear() {
    this.presses.length = 0;
  }
}
