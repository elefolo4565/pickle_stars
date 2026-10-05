// three.js のレンダラー・コート・背景・カメラ
import * as THREE from 'three';
import {
  COURT_HALF_W, COURT_HALF_L, KITCHEN, NET_HALF_W, NET_H_CENTER, NET_H_POST, BALL_R,
} from '@shared/constants.js';
import { toonMat, toonMesh, GEO } from './toon.js';

export const MENU_CHAR_Z = 5.4;
const TRAIL_N = 26; // 軌跡の長さ (フレーム数)
// ショットの種類ごとの軌跡の色と太さ (色はショットボタンに合わせる)
const TRAIL_STYLE = {
  serve: { color: 0xffffa0, w: 1 },
  drive: { color: 0xff4d5e, w: 1.3 },
  smash: { color: 0xff2a2a, w: 1.8 },
  soft: { color: 0x5fb4ff, w: 0.9 },
  lob: { color: 0xffcf2e, w: 1.1 },
  pop: { color: 0xff9aa4, w: 1 },
  sp_meteor: { color: 0xff8a1e, w: 2.4 },
  sp_drop: { color: 0xff8be0, w: 1.8 },
  sp_curve: { color: 0x6cffc8, w: 2 },
  sp_star: { color: 0xc58cff, w: 2.2 },
};
export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const COLORS = {
  sky: 0x7ec8ff,
  ground: 0x77c25a,
  apron: 0x2f8f83,
  court: 0x2c6fd6,
  kitchen: 0x3fa0ef,
  line: 0xffffff,
  wall: 0xf2a65a,
  wallTop: 0xffd27a,
};

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 影や着地マーカー用の丸いテクスチャ */
const blobTex = canvasTexture(64, 64, (g, w) => {
  const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, w);
});

const ringTex = canvasTexture(128, 128, (g, w) => {
  g.strokeStyle = '#fff';
  g.lineWidth = 12;
  g.beginPath();
  g.arc(w / 2, w / 2, w / 2 - 10, 0, Math.PI * 2);
  g.stroke();
});

export function makeBlob(size, opacity = 1) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

export function makeRing(size, color) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: ringTex, color, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

export class GameScene {
  /** @param {HTMLElement} container */
  constructor(container) {
    const dpr = window.devicePixelRatio || 1;
    this.renderer = new THREE.WebGLRenderer({
      antialias: !IS_TOUCH || dpr < 2,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(dpr, IS_TOUCH ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.Fog(COLORS.sky, 40, 75);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3(0, 10, 16);
    this.tmpA = new THREE.Vector3();
    this.tmpB = new THREE.Vector3();
    this.viewSide = 0;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x6b8fb0, 1.6);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-6, 14, 8);
    this.scene.add(sun);

    this.buildCourt();
    this.buildEnvironment();
    this.buildBall();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  buildCourt() {
    const s = this.scene;
    // 地面
    const groundTex = canvasTexture(128, 128, (g, w) => {
      g.fillStyle = '#77c25a';
      g.fillRect(0, 0, w, w);
      g.fillStyle = '#6db552';
      g.fillRect(0, 0, w / 2, w / 2);
      g.fillRect(w / 2, w / 2, w / 2, w / 2);
    });
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(40, 40);
    groundTex.magFilter = THREE.NearestFilter;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshLambertMaterial({ map: groundTex }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    s.add(ground);

    const flat = (w, l, color, y, x = 0, z = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshLambertMaterial({ color }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      s.add(m);
      return m;
    };
    flat(COURT_HALF_W * 2 + 7, COURT_HALF_L * 2 + 9, COLORS.apron, -0.01);
    flat(COURT_HALF_W * 2, COURT_HALF_L * 2, COLORS.court, 0);
    flat(COURT_HALF_W * 2, KITCHEN * 2, COLORS.kitchen, 0.001);

    // ライン (ひとまとめのジオメトリ)
    const LW = 0.05;
    const lines = [];
    const addLine = (x, z, w, l) => {
      const g = new THREE.PlaneGeometry(w, l);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0.003, z);
      lines.push(g);
    };
    addLine(0, COURT_HALF_L, COURT_HALF_W * 2 + LW, LW);
    addLine(0, -COURT_HALF_L, COURT_HALF_W * 2 + LW, LW);
    addLine(COURT_HALF_W, 0, LW, COURT_HALF_L * 2);
    addLine(-COURT_HALF_W, 0, LW, COURT_HALF_L * 2);
    addLine(0, KITCHEN, COURT_HALF_W * 2, LW);
    addLine(0, -KITCHEN, COURT_HALF_W * 2, LW);
    addLine(0, (KITCHEN + COURT_HALF_L) / 2, LW, COURT_HALF_L - KITCHEN);
    addLine(0, -(KITCHEN + COURT_HALF_L) / 2, LW, COURT_HALF_L - KITCHEN);
    const merged = mergeGeometries(lines);
    s.add(new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: COLORS.line })));

    // キッチン内の強調表示 (ノーバウンドで打てないときに光らせる)
    this.kitchenGlow = flat(COURT_HALF_W * 2, KITCHEN, 0xff5a5a, 0.002, 0, KITCHEN / 2);
    this.kitchenGlow.material = new THREE.MeshBasicMaterial({ color: 0xff4a4a, transparent: true, opacity: 0 });

    // ネット
    const netTex = canvasTexture(64, 64, (g, w) => {
      g.clearRect(0, 0, w, w);
      g.strokeStyle = 'rgba(20,20,30,0.85)';
      g.lineWidth = 3;
      for (let i = 0; i <= w; i += 16) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i, w);
        g.stroke();
        g.beginPath();
        g.moveTo(0, i);
        g.lineTo(w, i);
        g.stroke();
      }
    });
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    netTex.repeat.set(NET_HALF_W * 2 / 0.12, NET_H_CENTER / 0.12);
    const netGeo = new THREE.PlaneGeometry(NET_HALF_W * 2, 1, 24, 1);
    // 中央が低い形に変形
    const pos = netGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const top = pos.getY(i) > 0;
      const t = Math.min(Math.abs(x) / NET_HALF_W, 1);
      const h = NET_H_CENTER + (NET_H_POST - NET_H_CENTER) * t * t;
      pos.setY(i, top ? h : 0.06);
    }
    netGeo.computeVertexNormals();
    const net = new THREE.Mesh(
      netGeo,
      new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    s.add(net);
    // 白帯
    const tapePts = [];
    for (let i = 0; i <= 24; i++) {
      const x = -NET_HALF_W + (i / 24) * NET_HALF_W * 2;
      const t = Math.min(Math.abs(x) / NET_HALF_W, 1);
      tapePts.push(new THREE.Vector3(x, NET_H_CENTER + (NET_H_POST - NET_H_CENTER) * t * t, 0));
    }
    const tape = toonMesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tapePts), 24, 0.035, 6), 0xffffff, { outline: 0.012 });
    s.add(tape);
    for (const sx of [-1, 1]) {
      const post = toonMesh(GEO.cyl, 0x3b4252);
      post.scale.set(0.06, NET_H_POST + 0.06, 0.06);
      post.position.set(sx * (NET_HALF_W + 0.04), (NET_H_POST + 0.06) / 2, 0);
      s.add(post);
    }
  }

  buildEnvironment() {
    const s = this.scene;
    // 周囲の低い壁 (ブロスタ風のブロック)
    const wallGeo = new THREE.BoxGeometry(1.9, 0.9, 0.9);
    const wallMat = toonMat(COLORS.wall);
    const positions = [];
    const W = COURT_HALF_W + 4.2;
    const L = COURT_HALF_L + 5.2;
    for (let x = -W; x <= W + 0.01; x += 2) {
      positions.push([x, -L], [x, L]);
    }
    for (let z = -L + 2; z <= L - 2 + 0.01; z += 2) {
      positions.push([-W - 0.5, z], [W + 0.5, z]);
    }
    const walls = new THREE.InstancedMesh(wallGeo, wallMat, positions.length);
    const tops = new THREE.InstancedMesh(new THREE.BoxGeometry(1.95, 0.18, 0.95), toonMat(COLORS.wallTop), positions.length);
    const mtx = new THREE.Matrix4();
    positions.forEach(([x, z], i) => {
      const side = Math.abs(Math.abs(x) - (W + 0.5)) < 0.01;
      mtx.makeRotationY(side ? Math.PI / 2 : 0);
      mtx.setPosition(x, 0.45, z);
      walls.setMatrixAt(i, mtx);
      mtx.setPosition(x, 0.95, z);
      tops.setMatrixAt(i, mtx);
    });
    s.add(walls, tops);

    // 草むら (球の集まり)
    const bushPos = [];
    const rnd = mulberry32(7);
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 17 + rnd() * 16;
      const x = Math.cos(a) * r * 0.8;
      const z = Math.sin(a) * r;
      bushPos.push([x, z, 0.8 + rnd() * 0.9]);
    }
    const bushes = new THREE.InstancedMesh(GEO.sphereLow, toonMat(0x3f9a3a), bushPos.length * 3);
    let k = 0;
    for (const [x, z, sc] of bushPos) {
      for (let j = 0; j < 3; j++) {
        const ox = (j - 1) * 0.7 * sc;
        const ss = sc * (j === 1 ? 1.1 : 0.85);
        mtx.makeScale(ss, ss * 0.85, ss);
        mtx.setPosition(x + ox, ss * 0.5, z + (j === 1 ? -0.2 : 0.2));
        bushes.setMatrixAt(k++, mtx);
      }
    }
    s.add(bushes);

    // 旗
    const flagColors = [0xff5a5a, 0xffd23f, 0x5ad1ff, 0xff8cd6];
    for (let i = 0; i < 8; i++) {
      const x = (i % 2 ? 1 : -1) * (W + 2.5);
      const z = -L + 2 + Math.floor(i / 2) * ((L * 2 - 4) / 3);
      const pole = toonMesh(GEO.cyl, 0xffffff, { outline: 0.015 });
      pole.scale.set(0.05, 3.2, 0.05);
      pole.position.set(x, 1.6, z);
      s.add(pole);
      const flag = toonMesh(GEO.cone, flagColors[i % 4], { outline: 0.015 });
      flag.scale.set(0.35, 0.9, 0.08);
      flag.rotation.z = (x > 0 ? 1 : -1) * Math.PI / 2;
      flag.position.set(x + (x > 0 ? -0.45 : 0.45), 2.9, z);
      s.add(flag);
    }
  }

  buildBall() {
    const VIS_R = BALL_R * 1.8; // 見やすさのため実寸より大きく描く
    this.ball = toonMesh(new THREE.IcosahedronGeometry(VIS_R, 2), 0xe9ff3b, { outline: 0.012 });
    this.ballVisR = VIS_R;
    this.scene.add(this.ball);
    this.ballShadow = makeBlob(0.3);
    this.scene.add(this.ballShadow);
    this.landing = makeRing(0.55, 0xffef5a);
    this.scene.add(this.landing);
    this.landing.visible = false;

    // 軌跡 (カメラの方を向いた帯。新しいほど太く濃い)
    const N = TRAIL_N;
    this.trailHist = [];
    this.trailPos = new Float32Array(N * 2 * 3);
    const col = new Float32Array(N * 2 * 4);
    for (let i = 0; i < N; i++) {
      const a = Math.pow(1 - i / (N - 1), 1.4) * 0.75;
      for (let k = 0; k < 2; k++) col.set([1, 1, 1, a], (i * 2 + k) * 4);
    }
    const idx = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    this.trail = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 3;
    this.trail.visible = false;
    this.scene.add(this.trail);
    this.trailW = VIS_R * 1.1;
    this.tA = new THREE.Vector3();
    this.tB = new THREE.Vector3();
    this.tC = new THREE.Vector3();
  }

  /**
   * ボールの描画位置を更新
   * @param {string} [kind] 直近の打球の種類 (軌跡の色が変わる)
   */
  setBall(x, y, z, visible, speed, kind = 'serve') {
    this.ball.visible = visible;
    this.ballShadow.visible = visible;
    if (!visible) {
      this.trail.visible = false;
      this.trailHist.length = 0;
      return;
    }
    const vy = y + (this.ballVisR - BALL_R);
    this.ball.position.set(x, vy, z);
    this.ball.rotation.x += 0.2;
    this.ball.rotation.z += 0.13;
    const sh = Math.max(0.35, 1 - y / 5);
    this.ballShadow.position.set(x, 0.008, z);
    this.ballShadow.scale.setScalar(sh);
    this.ballShadow.material.opacity = sh;
    const st = TRAIL_STYLE[kind] || TRAIL_STYLE.serve;
    this.trail.material.color.setHex(st.color);
    this.trailW = this.ballVisR * 1.1 * st.w;
    this.updateTrail(x, vy, z, speed > 1);
  }

  updateTrail(x, y, z, moving) {
    const hist = this.trailHist;
    const last = hist[0];
    // 止まっている・瞬間移動した (サーブ直後など) ときは軌跡を消す
    if (!moving || (last && Math.hypot(last[0] - x, last[1] - y, last[2] - z) > 2.5)) hist.length = 0;
    if (!moving) {
      this.trail.visible = false;
      return;
    }
    hist.unshift([x, y, z]);
    if (hist.length > TRAIL_N) hist.length = TRAIL_N;
    if (hist.length < 2) {
      this.trail.visible = false;
      return;
    }
    const pos = this.trailPos;
    const cam = this.camera.position;
    const dir = this.tA;
    const toCam = this.tB;
    const side = this.tC;
    const n = hist.length;
    for (let i = 0; i < TRAIL_N; i++) {
      const p = hist[Math.min(i, n - 1)];
      const a = hist[Math.min(Math.max(i - 1, 0), n - 1)];
      const b = hist[Math.min(i + 1, n - 1)];
      dir.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      toCam.set(cam.x - p[0], cam.y - p[1], cam.z - p[2]);
      side.crossVectors(dir, toCam);
      const len = side.length();
      const w = i < n ? this.trailW * (1 - i / TRAIL_N) : 0;
      if (len > 1e-6) side.multiplyScalar(w / len);
      else side.set(0, 0, 0);
      pos[i * 6] = p[0] + side.x;
      pos[i * 6 + 1] = p[1] + side.y;
      pos[i * 6 + 2] = p[2] + side.z;
      pos[i * 6 + 3] = p[0] - side.x;
      pos[i * 6 + 4] = p[1] - side.y;
      pos[i * 6 + 5] = p[2] - side.z;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.visible = true;
  }

  /** カメラを自分側に配置。side=1 ならコートの反対側から見る */
  setViewSide(side) {
    this.viewSide = side;
  }

  /** 試合中のカメラ (コート全体と奥の相手が入るよう俯瞰気味に) */
  updateGameCamera(dt, followX) {
    const f = this.viewSide === 0 ? 1 : -1;
    const aspect = this.camera.aspect;
    // 縦長画面では横幅が入るように引く
    const fit = aspect < 1.3 ? Math.min(2.0, 1.3 / aspect) : 1;
    this.camera.fov = 52;
    const height = 13 * fit;
    const dist = 12.5 * fit;
    const tx = followX * 0.25;
    const k = 1 - Math.exp(-dt * 5);
    this.camPos.lerp(this.tmpA.set(tx, height, f * dist), k);
    this.camTarget.lerp(this.tmpB.set(tx * 0.5, 0, f * 1.0), k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.camera.updateProjectionMatrix();
  }

  /** タイトル画面用のカメラ (キャラクターを大きく映す) */
  updateMenuCamera(dt, time) {
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    const z = MENU_CHAR_Z;
    const target = new THREE.Vector3(portrait ? 0 : -1.0, portrait ? 0.75 : 1.0, z);
    const pos = new THREE.Vector3(portrait ? 0 : -1.0, 1.6 + Math.sin(time * 0.4) * 0.05, z + (portrait ? 5.0 : 4.4));
    const k = 1 - Math.exp(-dt * 4);
    this.camPos.lerp(pos, k);
    this.camTarget.lerp(target, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

function mergeGeometries(geos) {
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const idx = [];
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx.push(gi[i] + off);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
