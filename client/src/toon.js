// トゥーン調マテリアルと輪郭線 (背面法線押し出し) の共通処理
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const gradientMap = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

const matCache = new Map();

/** @param {number|string} color */
export function toonMat(color, opts = {}) {
  const key = `${color}|${opts.emissive ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap });
    if (opts.emissive !== undefined) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = 0.9;
    }
    matCache.set(key, m);
  }
  return m;
}

const outlineCache = new Map();

/** 法線方向に押し出した裏面を黒で描くマテリアル */
export function outlineMat(width = 0.022, color = 0x1b1424) {
  const key = `${width}|${color}`;
  let m = outlineCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace(
        '#include <begin_vertex>',
        `vec3 transformed = position + normalize(normal) * ${width.toFixed(4)};`,
      );
    };
    m.customProgramCacheKey = () => `outline${width}`;
    outlineCache.set(key, m);
  }
  return m;
}

/**
 * 輪郭線つきのメッシュを作る
 * @param {THREE.BufferGeometry} geo
 * @param {number|string} color
 * @param {{outline?: number|false, emissive?: number}} [opts]
 */
export function toonMesh(geo, color, opts = {}) {
  const mesh = new THREE.Mesh(geo, toonMat(color, opts));
  if (opts.outline !== false) {
    const ol = new THREE.Mesh(geo, outlineMat(opts.outline ?? 0.022));
    ol.raycast = () => {};
    mesh.add(ol);
  }
  return mesh;
}

// よく使う形状 (共有して使い回す)
export const GEO = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  sphereLow: new THREE.SphereGeometry(1, 12, 8),
  hemi: new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  cone: new THREE.ConeGeometry(1, 1, 12),
  torus: new THREE.TorusGeometry(1, 0.25, 8, 20),
};

export function capsule(r, len) {
  return new THREE.CapsuleGeometry(r, len, 6, 12);
}

/** 角丸の板 (パドル等) */
export function roundedPlate(w, h, depth, radius) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + radius, y);
  s.lineTo(x + w - radius, y);
  s.quadraticCurveTo(x + w, y, x + w, y + radius);
  s.lineTo(x + w, y + h - radius);
  s.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  s.lineTo(x + radius, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - radius);
  s.lineTo(x, y + radius);
  s.quadraticCurveTo(x, y, x + radius, y);
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.4,
    bevelSize: depth * 0.4,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.translate(0, 0, -depth / 2);
  // 輪郭線が途切れないよう頂点を結合して法線を滑らかにする
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const merged = mergeVertices(g, 1e-4);
  merged.computeVertexNormals();
  return merged;
}
