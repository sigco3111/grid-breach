import { Group, Mesh } from 'three';

const BASE = './models/environment/cpk/';

/**
 * The logistics yard — the district dressing built from the Quaternius
 * Cyberpunk Game Kit (CC0 1.0, `public/models/environment/cpk/LICENSE-CPK.txt`).
 *
 * The kit is modular at 1 m per unit, which matches the terrain's scale, so
 * the props drop straight in: a `Platform_4x4` is a 4×4 m loading pad whose
 * walk surface sits at local y ≈ 0. Everything here is placed on
 * `terrain.heightAt` so it follows the same ground the character walks on,
 * and the deck pads share one height so their tops meet without steps.
 *
 * The layout is data, not code. Each entry says which glTF, where, how far
 * rotated, how much scaled, and what solid footprint it has:
 *
 *   [asset, x, z, rotY, scale, collider?]
 *   collider: ['circle', r] | ['box', halfW, halfD] | omitted = walkable
 *
 * Colliders are 2-D (the character never leaves the ground) and push out the
 * same way the enemy bodies do — see `pushOut`. The design rules, learned
 * from the first pass: the centre lane from spawn to the deck stays clear,
 * sight-blockers live on the perimeter, and fences stay chest-high so the
 * camera reads over them.
 */
const LAYOUT = [
  // The deck: two 4×4 pads side by side, one shared height.
  ['Platform_4x4', -2.2, -7, 0, 1],
  ['Platform_4x4', 2.2, -7, 0, 1],

  // Cargo stacks as cover on the flanks, leaving x∈[-2,2] open.
  ['Platform_2x2_Empty', -4.2, -5.2, 0.4, 0.6, ['box', 1.0, 0.7]],
  ['Platform_2x2_Empty', -4.4, -7.6, 0.9, 0.6, ['box', 1.0, 0.7]],
  ['Platform_2x2_Empty', 4.2, -6.0, -0.3, 0.6, ['box', 1.0, 0.7]],
  ['Platform_4x1', 4.4, -8.6, 1.2, 0.8, ['box', 1.6, 0.5]],

  // Perimeter fences, chest-high, behind and beside the deck.
  ['Fence', -4.1, -12, 0, 1.3, ['box', 0.82, 0.1]],
  ['Fence', -2.0, -12, 0, 1.3, ['box', 0.82, 0.1]],
  ['Fence', 0.1, -12, 0, 1.3, ['box', 0.82, 0.1]],
  ['Fence', 2.2, -12, 0, 1.3, ['box', 0.82, 0.1]],
  ['Fence', 4.3, -12, 0, 1.3, ['box', 0.82, 0.1]],
  ['Fence', -6.8, -6, Math.PI / 2, 1.3, ['box', 0.82, 0.1]],
  ['Fence', -6.8, -8.2, Math.PI / 2, 1.3, ['box', 0.82, 0.1]],
  ['Fence', -6.8, -10.4, Math.PI / 2, 1.3, ['box', 0.82, 0.1]],
  ['Fence', 6.8, -6, Math.PI / 2, 1.3, ['box', 0.82, 0.1]],
  ['Fence', 6.8, -8.2, Math.PI / 2, 1.3, ['box', 0.82, 0.1]],
  ['Fence', 6.8, -10.4, Math.PI / 2, 1.3, ['box', 0.82, 0.1]],

  // Dock hardware.
  ['Computer_Large', 3.2, -9.8, Math.PI, 1, ['circle', 0.6]],
  ['Antenna_2', -6, -11, 0, 1.5, ['circle', 0.4]],
  ['Light_Street_1', -6, -4, Math.PI / 2, 1.4, ['circle', 0.25]],
  ['Light_Street_1', 6, -4, -Math.PI / 2, 1.4, ['circle', 0.25]],
  ['Light_Street_1', 6, -11, -Math.PI / 2, 1.4, ['circle', 0.25]],

  // Signage and ground pipes dressing the approach.
  ['Sign_2', -1.6, -3.6, 0.5, 1, ['circle', 0.2]],
  ['Sign_4', 5, -4.4, -1.2, 1, ['circle', 0.2]],
  ['Pipe_1', 5.6, -8, Math.PI / 2, 1, ['box', 0.15, 1.2]],
  ['Pipe_1', 5.6, -9.6, Math.PI / 2, 1, ['box', 0.15, 1.2]],
  ['Pipe_Corner', 5.6, -10.9, Math.PI, 1]
];

const _local = { x: 0, z: 0 };

export class LogisticsYard {
  /**
   * @param {import('./Terrain.js').Terrain} terrain ground truth for placement
   */
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new Group();
    this.group.name = 'logistics-yard';
    this._prototypes = new Map();
    /** @type {Array<{x:number,z:number,rotY:number,kind:string,a:number,b:number}>} */
    this.colliders = [];
  }

  /**
   * @param {import('../loaders/AssetLoader.js').AssetLoader} assets
   */
  async load(assets) {
    const names = [...new Set(LAYOUT.map(([name]) => name))];
    await Promise.all(names.map(async (name) => {
      const gltf = await assets.loadGLTF(`${BASE}${name}.gltf`);
      // The kit's platforms ship almost pure white, which glares under the
      // moonlight; the deck and cargo slabs get pulled down to a concrete
      // grey so the yard sits in the scene instead of floating over it.
      const tint = name.startsWith('Platform_') ? 0.55 : 1;
      gltf.scene.traverse((child) => {
        if (child instanceof Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (tint !== 1) {
            child.material = child.material.clone();
            child.material.color.multiplyScalar(tint);
          }
        }
      });
      this._prototypes.set(name, gltf.scene);
    }));
    this._build();
  }

  _build() {
    // The deck pads level out at one shared height so their tops meet flush.
    const deckY = this.terrain.heightAt(0, -7);
    for (const [name, x, z, rotY, scale, collider] of LAYOUT) {
      const proto = this._prototypes.get(name);
      if (!proto) continue;
      const item = proto.clone(true);
      const isPad = name === 'Platform_4x4';
      item.position.set(x, isPad ? deckY : this.terrain.heightAt(x, z), z);
      item.rotation.y = rotY;
      item.scale.setScalar(scale);
      this.group.add(item);

      if (!collider) continue;
      const [kind, a, b] = collider;
      // The top of the solid part, for line-of-fire blocking: a knee-high
      // slab stops a walker's feet but not a beam at chest height.
      const tops = { Fence: 1.64, Computer_Large: 2.38, Turret_GunDouble: 0.7,
        Antenna_2: 3.0, Light_Street_1: 2.9, Sign_2: 1.2, Sign_4: 1.2,
        Platform_2x2_Empty: 0.2, Platform_4x1: 0.2, Pipe_1: 0.2 };
      this.colliders.push({ x, z, rotY, kind, a: a * scale, b: (b ?? 0) * scale, h: tops[name] ?? 1.2 });
    }
  }

  /**
   * Does anything solid cross the 2-D segment from (x1,z1) to (x2,z2) at
   * height `y`? Used by the turrets' line of fire. Returns the fraction
   * along the segment where the first block happens, or null.
   */
  blocksLine(x1, z1, x2, z2, y) {
    let nearest = null;
    for (const c of this.colliders) {
      if (y >= c.h) continue;
      const t = c.kind === 'circle'
        ? _segCircle(x1, z1, x2, z2, c.x, c.z, c.a)
        : _segBox(x1, z1, x2, z2, c);
      if (t !== null && (nearest === null || t < nearest)) nearest = t;
    }
    return nearest;
  }

  /**
   * Keep a walking point out of every solid prop, the same shove the enemy
   * bodies apply: the point is moved to the nearest edge of whatever it
   * ended up inside. `radius` is the walker's own body radius, so colliders
   * are inflated by it rather than the point being pushed to the surface.
   *
   * @param {import('three').Vector3} position written in place
   * @param {number} radius the walker's body radius
   */
  pushOut(position, radius) {
    for (const c of this.colliders) {
      // Into the collider's local frame (rotation about Y only).
      const dx = position.x - c.x;
      const dz = position.z - c.z;
      const cos = Math.cos(-c.rotY);
      const sin = Math.sin(-c.rotY);
      _local.x = dx * cos - dz * sin;
      _local.z = dx * sin + dz * cos;

      if (c.kind === 'circle') {
        const r = c.a + radius;
        const squared = _local.x * _local.x + _local.z * _local.z;
        if (squared >= r * r) continue;
        const distance = Math.sqrt(squared);
        const push = distance < 1e-4 ? r : (r - distance) / distance;
        const px = distance < 1e-4 ? r : _local.x * push;
        const pz = distance < 1e-4 ? 0 : _local.z * push;
        position.x += px * Math.cos(c.rotY) - pz * Math.sin(c.rotY);
        position.z += px * Math.sin(c.rotY) + pz * Math.cos(c.rotY);
      } else {
        // Box: inflated by the walker's radius, pushed out along the axis of
        // least penetration.
        const hw = c.a + radius;
        const hd = c.b + radius;
        const penX = hw - Math.abs(_local.x);
        const penZ = hd - Math.abs(_local.z);
        if (penX <= 0 || penZ <= 0) continue;
        let px = 0;
        let pz = 0;
        if (penX < penZ) px = Math.sign(_local.x || 1) * penX;
        else pz = Math.sign(_local.z || 1) * penZ;
        position.x += px * Math.cos(c.rotY) - pz * Math.sin(c.rotY);
        position.z += px * Math.sin(c.rotY) + pz * Math.cos(c.rotY);
      }
    }
  }
}

/* Segment vs circle: fraction of the first crossing, or null. */
function _segCircle(x1, z1, x2, z2, cx, cz, r) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const fx = x1 - cx;
  const fz = z1 - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return null;
  const b = 2 * (fx * dx + fz * dz);
  const cc = fx * fx + fz * fz - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/* Segment vs rotated box (slab test in the box's local frame). */
function _segBox(x1, z1, x2, z2, c) {
  const cos = Math.cos(-c.rotY);
  const sin = Math.sin(-c.rotY);
  const lx1 = (x1 - c.x) * cos - (z1 - c.z) * sin;
  const lz1 = (x1 - c.x) * sin + (z1 - c.z) * cos;
  const lx2 = (x2 - c.x) * cos - (z2 - c.z) * sin;
  const lz2 = (x2 - c.x) * sin + (z2 - c.z) * cos;
  let t0 = 0;
  let t1 = 1;
  const dx = lx2 - lx1;
  const dz = lz2 - lz1;
  for (const [p, d, h] of [[lx1, dx, c.a], [lz1, dz, c.b]]) {
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(p) > h) return null;
      continue;
    }
    let ta = (-h - p) / d;
    let tb = (h - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}
