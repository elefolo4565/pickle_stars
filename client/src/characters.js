// ブロスタくらいの頭身 (約2.5頭身) のキャラクターをプリミティブで組み立て、手続き的にアニメーションさせる
import * as THREE from 'three';
import { toonMesh, GEO, capsule, roundedPlate } from './toon.js';
import { loadModel, GlbBody } from './glbModel.js';

const HR = 0.36; // 頭の半径
const HIP_Y = 0.42;
const SKIN = 0xffd2b0;

/**
 * @typedef {Object} CharDef
 * @property {string} name
 * @property {string} title
 * @property {string} desc
 * @property {number} color テーマ色 (UI用)
 * @property {object} c 各パーツの色
 * @property {number} [width] 体の横幅倍率
 * @property {(ctx: BuildCtx) => void} deco
 * @property {(p: {body: THREE.Group, arms: THREE.Group[], legs: THREE.Group[]}) => void} [dress] 胴体・手足の飾り
 * @property {string} [model] glb モデルのパス。読み込めたらプリミティブの体と差し替える
 * @property {boolean} [calmMenu] キャラ選択画面でバンザイや素振りをせず、立ったままにする
 */

/** @type {CharDef[]} */
export const CHARACTERS = [
  {
    name: 'ピコ',
    title: 'オールラウンダー',
    desc: '元気いっぱいのキャップ少年。どんなボールにも飛びつく。',
    color: 0xe8443a,
    c: { skin: SKIN, shirt: 0xffcc33, pants: 0x3a6bd9, shoe: 0xe8443a, paddle: 0xe8443a, hand: SKIN },
    deco(b) {
      b.eyes();
      b.brows(0x6b3a1e, 0.25);
      b.mouth('grin');
      // サイドの髪
      b.head(GEO.sphere, 0x8a4b22, [0.12, 0.14, 0.12], [-0.3, HR + 0.02, -0.04]);
      b.head(GEO.sphere, 0x8a4b22, [0.12, 0.14, 0.12], [0.3, HR + 0.02, -0.04]);
      // キャップ
      const cap = b.head(GEO.hemi, 0xe8443a, [HR * 1.06, HR * 0.8, HR * 1.06], [0, HR + 0.07, -0.01]);
      cap.rotation.x = -0.12;
      b.head(GEO.cyl, 0xe8443a, [0.24, 0.025, 0.2], [0, HR + 0.1, HR * 0.78], { rx: 0.15 });
      b.head(GEO.sphere, 0xffffff, [0.08, 0.08, 0.03], [0, HR + 0.26, HR * 0.85], { outline: false, rx: -0.6 });
    },
  },
  {
    name: 'モモ',
    title: 'テクニシャン',
    desc: 'おだんごヘアのムードメーカー。ふんわりドロップが得意。',
    color: 0xff6fb5,
    c: { skin: SKIN, shirt: 0x9b5de5, pants: 0xffffff, shoe: 0xff6fb5, paddle: 0xff6fb5, hand: SKIN, skirt: true },
    deco(b) {
      b.eyes('cute');
      b.brows(0x8a2e5c, -0.1);
      b.mouth('smile');
      b.blush();
      b.head(GEO.sphere, 0xff6fb5, [HR * 1.07, HR * 1.02, HR * 1.0], [0, HR + 0.05, -0.09]);
      // 前髪
      b.head(GEO.sphere, 0xff6fb5, [HR * 0.95, HR * 0.34, HR * 0.6], [0, HR + 0.27, 0.12]);
      // おだんご
      b.head(GEO.sphere, 0xff6fb5, [0.14, 0.14, 0.14], [-0.28, HR * 1.75, -0.04]);
      b.head(GEO.sphere, 0xff6fb5, [0.14, 0.14, 0.14], [0.28, HR * 1.75, -0.04]);
      b.head(GEO.sphere, 0xffe066, [0.05, 0.05, 0.05], [-0.2, HR * 1.62, 0.07], { outline: 0.012 });
      b.head(GEO.sphere, 0xffe066, [0.05, 0.05, 0.05], [0.2, HR * 1.62, 0.07], { outline: 0.012 });
    },
  },
  {
    name: 'ガンテツ',
    title: 'パワーヒッター',
    desc: '鍛え抜いた腕っぷしの大男。強打は誰にも止められない。',
    color: 0x3f9d4b,
    width: 1.3,
    c: { skin: 0xe0a070, shirt: 0x3f9d4b, pants: 0x4a3b2e, shoe: 0x333333, paddle: 0x3f9d4b, hand: 0xe0a070 },
    deco(b) {
      b.eyes('small');
      b.brows(0x2b1a10, 0.45, 1.5);
      // あごひげ・口ひげ
      b.head(GEO.sphere, 0x2b1a10, [0.27, 0.2, 0.2], [0, HR - 0.2, 0.17]);
      b.head(GEO.sphere, 0x2b1a10, [0.16, 0.05, 0.06], [0, HR - 0.1, HR * 0.9], { outline: false });
      // はちまき
      const band = b.head(GEO.torus, 0xffffff, [HR * 0.99, HR * 0.99, HR * 0.6], [0, HR + 0.13, 0], { outline: false });
      band.rotation.x = Math.PI / 2;
      b.head(GEO.sphere, 0xe8443a, [0.06, 0.06, 0.03], [0, HR + 0.13, HR * 0.97], { outline: false });
    },
  },
  {
    name: 'ルナ',
    title: 'スピードスター',
    desc: 'ポニーテールをなびかせる俊足ランナー。ネット際の攻防が得意。',
    color: 0x2ec4b6,
    c: { skin: SKIN, shirt: 0x2ec4b6, pants: 0x22306b, shoe: 0xffffff, paddle: 0x2ec4b6, hand: SKIN },
    deco(b) {
      b.eyes('cute');
      b.brows(0x1d2250, 0.1);
      b.mouth('smile');
      b.head(GEO.sphere, 0x2a2f6b, [HR * 1.06, HR * 1.02, HR * 1.08], [0, HR + 0.04, -0.06]);
      b.head(GEO.sphere, 0x2a2f6b, [HR * 0.98, HR * 0.34, HR * 0.55], [0.05, HR + 0.22, 0.13], { rz: -0.25 });
      // ポニーテール
      const tail = b.head(capsule(0.1, 0.32), 0x2a2f6b, [1, 1, 1], [0, HR + 0.05, -HR - 0.12]);
      tail.rotation.x = 0.7;
      b.head(GEO.torus, 0xffd23f, [0.07, 0.07, 0.07], [0, HR + 0.2, -HR - 0.02], { outline: false, rx: 0.9 });
      // 星のヘアピン
      b.head(new THREE.OctahedronGeometry(1, 0), 0xffd23f, [0.07, 0.07, 0.03], [-0.25, HR + 0.2, 0.22], { outline: 0.01 });
    },
  },
  {
    name: 'ボルト',
    title: 'メカ・アナリスト',
    desc: '試合データを分析するお手伝いロボ。正確なコントロールが自慢。',
    color: 0xff8c2a,
    c: { skin: 0x9aa4b8, shirt: 0xff8c2a, pants: 0x5a6378, shoe: 0x3b4252, paddle: 0xff8c2a, hand: 0x9aa4b8 },
    deco(b) {
      b.headMesh.scale.set(HR * 1.02, HR * 0.9, HR * 1.0);
      // バイザー
      b.head(GEO.sphere, 0x1b2a3a, [0.27, 0.13, 0.12], [0, HR + 0.02, HR * 0.78], { outline: false });
      b.head(GEO.sphere, 0x5ff6ff, [0.2, 0.045, 0.04], [0, HR + 0.03, HR * 0.78 + 0.1], { outline: false, emissive: 0x2fd6ff });
      // アンテナ
      b.head(GEO.cyl, 0x5a6378, [0.02, 0.2, 0.02], [0, HR * 2 + 0.05, 0], { outline: false });
      b.head(GEO.sphere, 0xff4040, [0.06, 0.06, 0.06], [0, HR * 2 + 0.17, 0], { emissive: 0xff2020, outline: 0.012 });
      // 耳のボルト
      b.head(GEO.cyl, 0xff8c2a, [0.08, 0.06, 0.08], [-HR * 0.98, HR, 0], { rz: Math.PI / 2 });
      b.head(GEO.cyl, 0xff8c2a, [0.08, 0.06, 0.08], [HR * 0.98, HR, 0], { rz: Math.PI / 2 });
    },
  },
  {
    name: 'ココ',
    title: 'ディフェンダー',
    desc: 'クマのフードがトレードマーク。どんな強打もふんわり返す。',
    color: 0xa86b3c,
    c: { skin: SKIN, shirt: 0xa86b3c, pants: 0x7a4a26, shoe: 0xffd23f, paddle: 0xffd23f, hand: 0xa86b3c },
    deco(b) {
      b.eyes('cute');
      b.brows(0x5a3a1a, -0.15);
      b.mouth('smile');
      b.blush();
      // クマのフード
      const hood = b.head(GEO.sphere, 0xa86b3c, [HR * 1.15, HR * 1.12, HR * 1.12], [0, HR + 0.04, -0.07]);
      hood.scale.z *= 1;
      b.head(GEO.torus, 0xa86b3c, [HR * 0.9, HR * 0.95, HR * 0.9], [0, HR - 0.01, 0.17], { outline: 0.016 });
      b.head(GEO.sphere, 0xa86b3c, [0.12, 0.12, 0.08], [-0.27, HR * 1.85, -0.02]);
      b.head(GEO.sphere, 0xa86b3c, [0.12, 0.12, 0.08], [0.27, HR * 1.85, -0.02]);
      b.head(GEO.sphere, 0xffb3c1, [0.065, 0.065, 0.03], [-0.27, HR * 1.85, 0.05], { outline: false });
      b.head(GEO.sphere, 0xffb3c1, [0.065, 0.065, 0.03], [0.27, HR * 1.85, 0.05], { outline: false });
    },
  },
  {
    name: 'ちょるこ',
    title: 'マジカルスター',
    desc: 'リボンとフリルの魔法少女。きらきらの瞳でボールを見逃さない。',
    color: 0xe8609a,
    model: 'models/choruko.glb',
    calmMenu: true,
    c: {
      skin: SKIN, shirt: 0xf27aaa, pants: 0xe8609a, shoe: 0xd02a7a, paddle: 0xd02a7a, hand: SKIN,
      arm: SKIN, leg: SKIN, skirt: { r: 0.4, h: 0.34 },
    },
    deco(b) {
      const HAIR = 0xf7a1b8;
      const RIB = 0xc8247a;
      b.eyes('star');
      b.mouth('smile');
      b.blush();
      // 後ろ髪・ボブ
      b.head(GEO.sphere, HAIR, [HR * 1.08, HR * 1.04, HR * 1.04], [0, HR + 0.05, -0.08]);
      b.head(GEO.sphere, HAIR, [HR * 1.04, HR * 0.62, HR * 0.92], [0, HR - 0.12, -0.12]);
      // 流した前髪と顔まわりの髪
      b.head(GEO.sphere, HAIR, [HR * 0.98, HR * 0.38, HR * 0.6], [0.03, HR + 0.24, 0.12], { rz: -0.2 });
      for (const s of [-1, 1]) b.head(GEO.sphere, HAIR, [0.08, 0.19, 0.08], [s * 0.29, HR - 0.07, 0.1], { rz: s * 0.1 });
      // くるくるのツインテール
      for (const s of [-1, 1]) {
        b.head(GEO.sphere, HAIR, [0.14, 0.14, 0.13], [s * 0.42, HR + 0.07, -0.06]);
        b.head(GEO.sphere, HAIR, [0.13, 0.13, 0.12], [s * 0.49, HR - 0.07, -0.03]);
        b.head(GEO.sphere, HAIR, [0.12, 0.12, 0.11], [s * 0.43, HR - 0.17, -0.1]);
        // 羽のようなリボン
        const knot = [s * 0.36, HR + 0.26, -0.02];
        b.head(GEO.sphere, RIB, [0.15, 0.065, 0.035], [knot[0] + s * 0.07, knot[1] + 0.1, knot[2]], { rz: s * 0.95, outline: 0.014 });
        b.head(GEO.sphere, RIB, [0.14, 0.06, 0.035], [knot[0] + s * 0.13, knot[1] + 0.03, knot[2]], { rz: s * 0.3, outline: 0.014 });
        b.head(GEO.sphere, RIB, [0.045, 0.045, 0.04], knot, { outline: 0.012 });
      }
      // アホ毛
      b.head(new THREE.TorusGeometry(0.07, 0.016, 6, 12, Math.PI * 0.9), HAIR, [1, 1, 1], [-0.05, HR * 2 - 0.01, 0.02], { outline: 0.01, rz: 0.5 });
    },
    dress({ body, arms, legs }) {
      const LIGHT = 0xffc6dc;
      const RIB = 0xc8247a;
      const PURPLE = 0x9b4fb0;
      // スカートのすそ (紫のライン + 白いフリル)
      part(body, RING_GEO, PURPLE, [0.38, 0.38, 0.5], [0, -0.085, 0], [Math.PI / 2, 0, 0], { outline: false });
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        part(body, GEO.sphereLow, 0xffffff, [0.06, 0.045, 0.06], [Math.sin(a) * 0.38, -0.115, Math.cos(a) * 0.33], [0, 0, 0], { outline: 0.012 });
      }
      // 胸の大きなリボン
      ribbon(body, RIB, [0, 0.37, 0.2], 0.095, { tilt: 0.3 });
      // えりのフリル
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        part(body, GEO.sphereLow, LIGHT, [0.05, 0.035, 0.05], [Math.sin(a) * 0.1, 0.5, Math.cos(a) * 0.09], [0, 0, 0], { outline: 0.01 });
      }
      // 腰の後ろの紫リボンと長いリボンのすそ
      ribbon(body, PURPLE, [0, 0.14, -0.22], 0.12, { tilt: -0.35 });
      for (const s of [-1, 1]) {
        part(body, GEO.cone, PURPLE, [0.09, 0.4, 0.03], [s * 0.3, -0.12, -0.2], [-0.35, s * 0.4, -s * 2.3], { outline: 0.014 });
      }
      // ふくらんだ袖と手首のフリル
      for (const arm of arms) {
        part(arm, GEO.sphere, LIGHT, [0.13, 0.12, 0.13], [0, -0.06, 0]);
        part(arm, RING_GEO, LIGHT, [0.08, 0.08, 0.8], [0, -0.2, 0], [Math.PI / 2, 0, 0], { outline: 0.01 });
      }
      // くつしたのフリル
      for (const leg of legs) {
        part(leg, RING_GEO, LIGHT, [0.1, 0.1, 0.9], [0, -0.28, 0.01], [Math.PI / 2, 0, 0], { outline: 0.01 });
      }
    },
  },
];

/** 頭の表面上の z 座標 */
function surfZ(x, y) {
  return Math.sqrt(Math.max(0, HR * HR - x * x - y * y));
}

// 4つ角の星 (瞳のハイライト用)
const STAR_GEO = (() => {
  const sh = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.28;
    const x = Math.sin(a) * r;
    const y = Math.cos(a) * r;
    if (i === 0) sh.moveTo(x, y);
    else sh.lineTo(x, y);
  }
  return new THREE.ShapeGeometry(sh);
})();

// 服の飾り用
const RING_GEO = new THREE.TorusGeometry(1, 0.08, 6, 24);

/** グループに輪郭つきの部品を追加する (胴体・手足用) */
function part(parent, geo, color, scale, pos, rot = [0, 0, 0], opts = {}) {
  const m = toonMesh(geo, color, opts);
  m.scale.set(scale[0], scale[1], scale[2]);
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

/** リボン (2つの輪 + 結び目)。tilt: 輪の傾き */
function ribbon(parent, color, pos, size, opts = {}) {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  if (opts.ry) g.rotation.y = opts.ry;
  for (const s of [-1, 1]) {
    part(g, GEO.sphere, color, [size, size * 0.6, size * 0.4], [s * size * 0.85, 0, 0], [0, 0, s * (opts.tilt ?? 0.25)], { outline: 0.014 });
  }
  part(g, GEO.sphere, color, [size * 0.35, size * 0.38, size * 0.35], [0, 0, size * 0.1], [0, 0, 0], { outline: 0.014 });
  parent.add(g);
  return g;
}

class BuildCtx {
  constructor(headGroup, headMesh) {
    this.headGroup = headGroup;
    this.headMesh = headMesh;
  }

  /** 頭グループに部品を追加 */
  head(geo, color, scale, pos, opts = {}) {
    const m = toonMesh(geo, color, opts);
    m.scale.set(scale[0], scale[1], scale[2]);
    m.position.set(pos[0], pos[1], pos[2]);
    if (opts.rx) m.rotation.x = opts.rx;
    if (opts.rz) m.rotation.z = opts.rz;
    this.headGroup.add(m);
    return m;
  }

  eyes(style = 'normal') {
    if (style === 'star') return this.starEyes();
    const big = style === 'cute' ? 1.15 : style === 'small' ? 0.8 : 1;
    for (const s of [-1, 1]) {
      const ex = s * 0.13;
      const ey = HR + 0.0;
      const z = surfZ(ex, 0.0) - 0.035;
      this.head(GEO.sphere, 0xffffff, [0.075 * big, 0.1 * big, 0.05], [ex, ey, z], { outline: 0.012 });
      this.head(GEO.sphere, 0x1b1424, [0.048 * big, 0.068 * big, 0.04], [ex + s * 0.005, ey - 0.005, z + 0.025], { outline: false });
      this.head(GEO.sphere, 0xffffff, [0.017 * big, 0.02 * big, 0.01], [ex + 0.018, ey + 0.028, z + 0.062], { outline: false });
    }
  }

  /** 茶色い瞳に星のハイライト */
  starEyes(iris = 0x8a2a1e) {
    for (const s of [-1, 1]) {
      const ex = s * 0.13;
      const ey = HR - 0.01;
      const z = surfZ(ex, -0.01) - 0.035;
      this.head(GEO.sphere, 0xffffff, [0.085, 0.11, 0.05], [ex, ey, z], { outline: 0.012 });
      this.head(GEO.sphere, iris, [0.068, 0.088, 0.045], [ex, ey - 0.005, z + 0.012], { outline: false });
      this.head(GEO.sphere, 0x3a0f12, [0.04, 0.052, 0.04], [ex, ey - 0.005, z + 0.025], { outline: false });
      const star = new THREE.Mesh(STAR_GEO, new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
      star.scale.setScalar(0.034);
      star.position.set(ex, ey + 0.004, z + 0.068);
      this.headGroup.add(star);
    }
  }

  brows(color, tilt, thick = 1) {
    for (const s of [-1, 1]) {
      const bx = s * 0.13;
      const by = HR + 0.14;
      const m = this.head(GEO.sphere, color, [0.07, 0.022 * thick, 0.025], [bx, by, surfZ(bx, 0.14) - 0.005], { outline: false });
      m.rotation.z = -s * tilt;
    }
  }

  mouth(type) {
    const y = HR - 0.14;
    const z = surfZ(0, -0.14) + 0.002;
    if (type === 'grin') {
      const m = this.head(GEO.hemi, 0x7a1f2b, [0.08, 0.06, 0.02], [0, y + 0.01, z - 0.008], { outline: false });
      m.rotation.x = Math.PI;
      this.head(GEO.sphere, 0xffffff, [0.06, 0.012, 0.012], [0, y, z + 0.004], { outline: false });
    } else {
      const g = new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x5a1f2b }));
      m.position.set(0, y + 0.03, z - 0.005);
      m.rotation.z = Math.PI;
      this.headGroup.add(m);
    }
  }

  blush() {
    for (const s of [-1, 1]) {
      const x = s * 0.22;
      this.head(GEO.sphere, 0xff9fb0, [0.055, 0.03, 0.02], [x, HR - 0.08, surfZ(x, -0.08) - 0.008], { outline: false });
    }
  }
}

const POSE_REST = { by: 0, bx: 0.05, ax: -0.55, ay: 0, az: 0.35 };
const SWINGS = {
  fh: { back: { by: 0.75, bx: 0.1, ax: 0.2, ay: 0, az: 1.0 }, follow: { by: -0.7, bx: 0.1, ax: -1.5, ay: 0.3, az: 0.6 } },
  bh: { back: { by: -0.9, bx: 0.1, ax: -1.0, ay: 0, az: -0.9 }, follow: { by: 0.5, bx: 0.1, ax: -0.9, ay: 0, az: 1.2 } },
  oh: { back: { by: 0.4, bx: -0.15, ax: -3.3, ay: 0, az: 0.2 }, follow: { by: -0.3, bx: 0.35, ax: -0.6, ay: 0, az: 0.2 } },
  serve: { back: { by: 0.3, bx: 0.1, ax: 0.9, ay: 0, az: 0.15 }, follow: { by: -0.2, bx: 0.05, ax: -1.7, ay: 0, az: 0.2 } },
};

function lerpPose(out, a, b, t) {
  for (const k in a) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

const EMOJIS = ['👍', '😆', '😤', '😭', '🔥', '👏', '😎', '❓'];
const emojiTex = new Map();
function getEmojiTexture(i) {
  let t = emojiTex.get(i);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#1b1424';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(64, 60, 52, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.font = '64px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(EMOJIS[i] || '❓', 64, 64);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    emojiTex.set(i, t);
  }
  return t;
}
export { EMOJIS };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Chibi {
  /** @param {number} charIdx */
  constructor(charIdx) {
    const def = CHARACTERS[charIdx] || CHARACTERS[0];
    this.def = def;
    const c = def.c;
    const w = def.width || 1;

    this.root = new THREE.Group();
    this.model = new THREE.Group();
    this.model.scale.setScalar(1.12);
    this.root.add(this.model);

    // 脚
    this.legs = [-1, 1].map((s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.12 * Math.min(w, 1.15), HIP_Y, 0);
      const leg = toonMesh(capsule(0.095, 0.16), c.leg ?? (c.pants === 0xffffff ? c.skin : c.pants));
      leg.position.y = -0.17;
      pivot.add(leg);
      const shoe = toonMesh(GEO.sphere, c.shoe);
      shoe.scale.set(0.12, 0.085, 0.17);
      shoe.position.set(0, -0.35, 0.04);
      pivot.add(shoe);
      this.model.add(pivot);
      return pivot;
    });

    // 胴体
    this.body = new THREE.Group();
    this.body.position.y = HIP_Y;
    this.model.add(this.body);
    if (c.skirt) {
      const skirt = toonMesh(GEO.cone, c.pants);
      const sk = typeof c.skirt === 'object' ? c.skirt : {};
      skirt.scale.set(sk.r ?? 0.33, sk.h ?? 0.3, (sk.r ?? 0.33) * 0.85);
      skirt.position.y = 0.07;
      this.body.add(skirt);
    } else {
      const hips = toonMesh(GEO.sphere, c.pants);
      hips.scale.set(0.27 * w, 0.17, 0.22);
      hips.position.y = 0.05;
      this.body.add(hips);
    }
    const torso = toonMesh(GEO.sphere, c.shirt);
    torso.scale.set(0.28 * w, 0.3, 0.23);
    torso.position.y = 0.26;
    this.body.add(torso);

    // 頭
    this.headPivot = new THREE.Group();
    this.headPivot.position.y = 0.5;
    this.body.add(this.headPivot);
    const headMesh = toonMesh(GEO.sphere, c.skin);
    headMesh.scale.setScalar(HR);
    headMesh.position.y = HR;
    this.headPivot.add(headMesh);
    def.deco(new BuildCtx(this.headPivot, headMesh));

    // 腕
    const mkArm = (s) => {
      const pivot = new THREE.Group();
      pivot.position.set(s * (0.27 * w + 0.03), 0.4, 0);
      const upper = toonMesh(capsule(0.075, 0.16), c.arm ?? c.shirt);
      upper.position.y = -0.13;
      pivot.add(upper);
      const hand = toonMesh(GEO.sphere, c.hand);
      hand.scale.setScalar(0.09);
      hand.position.y = -0.3;
      pivot.add(hand);
      this.body.add(pivot);
      return pivot;
    };
    this.armR = mkArm(1);
    this.armL = mkArm(-1);

    // パドル (右手)
    const paddle = new THREE.Group();
    paddle.position.y = -0.3;
    const handle = toonMesh(GEO.cyl, 0x2b2b38, { outline: 0.012 });
    handle.scale.set(0.03, 0.16, 0.03);
    handle.position.y = -0.08;
    paddle.add(handle);
    const face = toonMesh(roundedPlate(0.27, 0.3, 0.03, 0.09), c.paddle, { outline: 0.016 });
    face.position.y = -0.31;
    face.rotation.y = Math.PI / 2;
    paddle.add(face);
    const stripe = toonMesh(roundedPlate(0.2, 0.06, 0.035, 0.02), 0xffffff, { outline: false });
    stripe.position.y = -0.26;
    stripe.rotation.y = Math.PI / 2;
    paddle.add(stripe);
    this.armR.add(paddle);
    this.paddle = paddle;

    // 胴体・手足の追加装飾 (服の飾りなど)
    def.dress?.({ body: this.body, arms: [this.armL, this.armR], legs: this.legs });

    // エモート
    this.emote = new THREE.Sprite(new THREE.SpriteMaterial({ map: getEmojiTexture(0), depthTest: false, transparent: true }));
    this.emote.renderOrder = 10;
    this.emote.position.y = 2.35;
    this.emote.visible = false;
    this.root.add(this.emote);
    this.emoteT = 0;

    this.pose = { ...POSE_REST };
    this.tmpPose = { ...POSE_REST };
    this.swing = null; // {kind, stage: 'ready'|'swing', t}
    this.runPhase = 0;
    this.time = Math.random() * 10;
    this.mood = null; // 'win' | 'lose'
    this.moodT = 0;
    this.diveState = null;

    this.glb = null;
    if (def.model) {
      loadModel(def.model)
        .then((gltf) => this.useGlb(gltf))
        .catch((e) => console.warn('model load failed', def.model, e));
    }
  }

  /** 読み込んだ glb を表示し、プリミティブの体はパドル以外を隠す */
  useGlb(gltf) {
    const keep = new Set();
    this.paddle.traverse((o) => keep.add(o));
    for (const part of [this.body, ...this.legs]) {
      part.traverse((o) => {
        if (o.isMesh && !keep.has(o)) o.visible = false;
      });
    }
    this.glb = new GlbBody(gltf, this.model, 1.85);
    this.glb.play(null);
  }

  /** glb の腕・アニメを Chibi の姿勢に合わせる */
  updateGlb(dt, speed) {
    const g = this.glb;
    if (this.mood === 'win') g.play('cheer');
    else if (this.mood === 'lose') g.play('defeat_03');
    else if (speed > 0.6) g.play('run', Math.min(0.6 + speed / 5, 1.4));
    else g.play(null);
    g.update(dt);

    this.root.updateMatrixWorld(true);
    for (const [arm, garm] of [[this.armL, g.armL], [this.armR, g.armR]]) {
      arm.getWorldPosition(_v1);
      arm.localToWorld(_v2.set(0, -1, 0)).sub(_v1).normalize();
      g.aimArm(garm, _v2);
    }
    // パドルを glb の手の位置へ
    this.armR.worldToLocal(g.handWorld(g.armR, this.paddle.position));
  }

  /** 構え (バックスイング) */
  ready(kind) {
    this.swing = { kind, stage: 'ready', t: 0 };
  }

  /** 振り抜き */
  strike(kind) {
    this.swing = { kind, stage: 'swing', t: 0 };
  }

  /**
   * 飛びつき。(wx, wz) はワールド座標での飛ぶ方向 (長さ = 飛ぶ距離)
   */
  dive(wx, wz, kind = 'fh') {
    this.diveState = { t: 0, wx, wz };
    this.strike(kind);
  }

  showEmote(i) {
    this.emote.material.map = getEmojiTexture(i);
    this.emote.material.needsUpdate = true;
    this.emote.visible = true;
    this.emoteT = 0;
  }

  setMood(m) {
    this.mood = m;
    this.moodT = 0;
  }

  /**
   * @param {number} dt
   * @param {number} speed 移動速度 (m/s)
   */
  update(dt, speed) {
    this.time += dt;
    const run = Math.min(speed / 5, 1);
    this.runPhase += dt * (6 + speed * 1.8);

    // 脚と胴体の上下
    const legSwing = Math.sin(this.runPhase) * 0.9 * run;
    this.legs[0].rotation.x = legSwing;
    this.legs[1].rotation.x = -legSwing;
    const bob = Math.abs(Math.sin(this.runPhase)) * 0.06 * run;
    const breathe = Math.sin(this.time * 3) * 0.012 * (1 - run);
    this.body.position.y = HIP_Y + bob + breathe;
    this.body.rotation.x = 0.18 * run;
    this.armL.rotation.x = -legSwing * 0.8 - 0.1;
    this.armL.rotation.z = -0.25;
    this.headPivot.rotation.x = 0;
    this.model.position.y = 0;

    // スイング
    let target = POSE_REST;
    if (this.swing) {
      const sw = this.swing;
      sw.t += dt;
      const S = SWINGS[sw.kind] || SWINGS.fh;
      if (sw.stage === 'ready') {
        target = S.back;
        if (sw.t > 1.2) this.swing = null;
      } else {
        const T1 = 0.1;
        const T2 = 0.24;
        const T3 = 0.5;
        if (sw.t < T1) target = lerpPose(this.tmpPose, this.pose, S.follow, sw.t / T1);
        else if (sw.t < T2) target = S.follow;
        else if (sw.t < T3) target = lerpPose(this.tmpPose, S.follow, POSE_REST, (sw.t - T2) / (T3 - T2));
        else this.swing = null;
      }
    }
    const k = this.swing && this.swing.stage === 'swing' ? 1 : 1 - Math.exp(-dt * 16);
    for (const key in this.pose) this.pose[key] += (target[key] - this.pose[key]) * k;
    const p = this.pose;
    this.body.rotation.y = p.by;
    this.body.rotation.x += p.bx;
    this.armR.rotation.set(p.ax - (this.swing ? 0 : legSwing * 0.3), p.ay, p.az);

    // 勝ち・負けのリアクション
    if (this.mood) {
      this.moodT += dt;
      if (this.mood === 'win') {
        this.model.position.y = Math.abs(Math.sin(this.moodT * 7)) * 0.3;
        this.armL.rotation.set(0, 0, -2.6);
        if (!this.swing) this.armR.rotation.set(0, 0, 2.6);
      } else {
        this.headPivot.rotation.x = 0.45;
        this.body.rotation.x += 0.25;
      }
      if (this.moodT > 1.8) this.mood = null;
    }

    this.updateDive(dt);
    if (this.glb) this.updateGlb(dt, speed);

    // エモート
    if (this.emote.visible) {
      this.emoteT += dt;
      const t = this.emoteT;
      const s = t < 0.15 ? (t / 0.15) * 0.75 : 0.75;
      this.emote.scale.set(s, s, s);
      this.emote.position.y = 2.35 + Math.sin(t * 4) * 0.04;
      if (t > 2.2) this.emote.visible = false;
    }
  }

  updateDive(dt) {
    const m = this.model;
    const d = this.diveState;
    if (!d) {
      m.position.x = m.position.z = 0;
      m.rotation.x = m.rotation.z = 0;
      return;
    }
    d.t += dt;
    const t = d.t;
    // 飛び出す → 倒れ込む → 起き上がる
    let f;
    if (t < 0.14) f = 1 - (1 - t / 0.14) ** 2;
    else if (t < 0.42) f = 1;
    else if (t < 0.7) f = 1 - (t - 0.42) / 0.28;
    else {
      this.diveState = null;
      f = 0;
    }
    // ワールドの向きをモデルの向きに直す
    const ry = this.root.rotation.y;
    const c = Math.cos(ry);
    const sn = Math.sin(ry);
    const lx = d.wx * c - d.wz * sn;
    const lz = d.wx * sn + d.wz * c;
    const len = Math.hypot(lx, lz) || 1;
    const tilt = 1.05 * f;
    m.position.x = lx * f;
    m.position.z = lz * f;
    m.position.y += -0.22 * f;
    m.rotation.x = tilt * (lz / len);
    m.rotation.z = -tilt * (lx / len);
  }

  /** 左手のワールド座標 (サーブ前にボールを持たせる) */
  leftHandWorld(out) {
    if (this.glb) return this.glb.handWorld(this.glb.armL, out);
    out.set(0, -0.32, 0.05);
    return this.armL.localToWorld(out);
  }
}
