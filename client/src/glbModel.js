// 外部で作った 3D モデル (glb) を読み込んで、手続きアニメの Chibi に重ねて動かす
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { outlineMat } from './toon.js';

// テクスチャに陰影が描き込まれているので、影は他のキャラより薄くする
const softGradient = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([190, 225, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

const loader = new GLTFLoader();
const cache = new Map();

/**
 * 読み込みは 1 回だけ。マテリアルはトゥーン調に置き換える。
 * outline を指定すると輪郭線用のメッシュを足す (細かい凹凸の多いモデルだと顔に線が出るので注意)
 */
export function loadModel(url, outline = 0) {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((gltf) => {
      const skinned = [];
      gltf.scene.traverse((o) => {
        if (o.isSkinnedMesh) skinned.push(o);
      });
      for (const m of skinned) {
        const old = m.material;
        // 顔が暗く沈まないよう、テクスチャを少し自己発光させる
        m.material = new THREE.MeshToonMaterial({
          map: old.map,
          gradientMap: softGradient,
          emissive: 0x555555,
          emissiveMap: old.map,
        });
        old.dispose();
        m.frustumCulled = false;
        if (!outline) continue;
        const ol = new THREE.SkinnedMesh(m.geometry, outlineMat(outline));
        ol.position.copy(m.position);
        ol.quaternion.copy(m.quaternion);
        ol.scale.copy(m.scale);
        ol.frustumCulled = false;
        ol.bind(m.skeleton, m.bindMatrix);
        m.parent.add(ol);
      }
      // 腰の水平移動 (その場から動いてしまう分) を消し、上下の動きだけ残す
      for (const clip of gltf.animations) {
        for (const track of clip.tracks) {
          const [name, prop] = track.name.split('.');
          if (prop !== 'position') continue;
          const bone = gltf.scene.getObjectByName(name);
          if (!bone?.parent) continue;
          const up = upAxis(bone.parent);
          const v = track.values;
          for (let i = 0; i < v.length; i += 3) {
            for (let k = 0; k < 3; k++) if (k !== up) v[i + k] = bone.position.getComponent(k);
          }
        }
      }
      return gltf;
    });
    cache.set(url, p);
  }
  return p;
}

/** parent のローカル座標で、ワールドの上方向に最も近い軸 (0:x 1:y 2:z) */
function upAxis(parent) {
  parent.updateWorldMatrix(true, false);
  const e = parent.matrixWorld.elements;
  const ys = [Math.abs(e[1]), Math.abs(e[5]), Math.abs(e[9])];
  return ys.indexOf(Math.max(...ys));
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();

/** 1 体ぶんのモデル。腕は Chibi の腕の向きに合わせ、脚と体はアニメーションで動かす */
export class GlbBody {
  /**
   * @param {object} gltf
   * @param {THREE.Object3D} holder モデルを入れる親 (Chibi.model)
   * @param {number} height モデルの高さ (holder 内の単位)
   */
  constructor(gltf, holder, height) {
    this.obj = cloneSkinned(gltf.scene);
    const box = new THREE.Box3().setFromObject(this.obj);
    const s = height / (box.max.y - box.min.y);
    this.obj.scale.setScalar(s);
    this.obj.position.y = -box.min.y * s;
    holder.add(this.obj);
    holder.updateMatrixWorld(true);

    this.mixer = new THREE.AnimationMixer(this.obj);
    this.actions = {};
    for (const clip of gltf.animations) {
      const key = clip.name.split(':').pop();
      this.actions[key] = this.mixer.clipAction(clip);
    }
    this.current = null;
    this.fading = null;
    this.fadeT = 0;

    // 腕の骨。holder の +x 側にある腕を Chibi の右腕 (パドル側) に対応させる
    const arms = ['L', 'R'].map((side) => {
      const upper = this.obj.getObjectByName(`${side}_Upperarm`);
      const lower = this.obj.getObjectByName(`${side}_Forearm`);
      const hand = this.obj.getObjectByName(`${side}_Hand`);
      const x = holder.worldToLocal(upper.getWorldPosition(new THREE.Vector3())).x;
      return { upper, lower, hand, x, rest: [upper, lower, hand].map((b) => b.quaternion.clone()) };
    });
    arms.sort((p, q) => p.x - q.x);
    this.armL = arms[0];
    this.armR = arms[1];
  }

  /** name が null なら動きを止めて元の直立姿勢へ戻す */
  play(name, timeScale = 1) {
    if (name === null) {
      if (this.current) {
        this.current.fadeOut(0.2);
        this.fading = this.current;
        this.fadeT = 0.2;
        this.current = null;
      }
      return;
    }
    const next = this.actions[name];
    if (!next) return;
    next.timeScale = timeScale;
    if (this.current === next) return;
    next.reset().play();
    if (this.current) next.crossFadeFrom(this.current, 0.15, false);
    this.current = next;
  }

  update(dt) {
    this.mixer.update(dt);
    // フェードアウトし終えたら止める (止めると骨が元の姿勢に戻る)
    if (this.fading && (this.fadeT -= dt) <= 0) {
      if (this.fading !== this.current) this.fading.stop();
      this.fading = null;
    }
  }

  /** 腕の骨を伸ばした状態で、肩から dir (ワールド) の方向へ向ける */
  aimArm(arm, dir) {
    arm.upper.quaternion.copy(arm.rest[0]);
    arm.lower.quaternion.copy(arm.rest[1]);
    arm.hand.quaternion.copy(arm.rest[2]);
    arm.upper.updateMatrixWorld(true);
    arm.upper.getWorldPosition(_a);
    arm.hand.getWorldPosition(_b);
    _b.sub(_a).normalize();
    _q.setFromUnitVectors(_b, dir);
    arm.upper.getWorldQuaternion(_q2);
    arm.upper.parent.getWorldQuaternion(_q3).invert();
    arm.upper.quaternion.copy(_q3.multiply(_q.multiply(_q2)));
    arm.upper.updateMatrixWorld(true);
  }

  handWorld(arm, out) {
    return arm.hand.getWorldPosition(out);
  }
}
