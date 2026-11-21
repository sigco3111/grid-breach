import { Group, MathUtils, Mesh, Object3D, Vector3 } from 'three';

const _muzzle = new Vector3();
const _dir = new Vector3();

import { settings } from '../config/settings.js';

const BASE = './models/environment/cpk/';

/**
 * The yard's defence turrets — Cyberpunk Game Kit models (CC0) stood up as
 * *shootable* props rather than dressing.
 *
 * A turret is not a rigged body, so it cannot reuse `Enemy`: what the combat
 * systems actually touch is a small interface, and that is what this class
 * implements instead —
 *
 *  - `bones`: the three analytic joints the hit volumes are read from
 *    (`combat/Hitboxes.js`). A turret has no skeleton, so the hips, neck and
 *    head are placed by hand inside the model; with no feet, the leg capsule
 *    stands on the ground under the hips, which is where a turret's base is.
 *  - `health` / `wound()`: the gun spends it, exactly as it does on a body.
 *  - `die()` / `finished` / `dispose()`: the manager's kill and cleanup path.
 *  - `update(dt, player)`: the aim — the head slews onto the player whenever
 *    they are in range. Firing back is a separate step and deliberately not
 *    claimed here.
 *
 * Turrets carry `countsTowardPopulation = false` so the ring of walking
 * enemies neither counts them nor retires them; placement is fixed by the
 * yard, not by the spawner.
 */
export class Turret {
  /**
   * @param {object} options
   * @param {import('three').Object3D} options.source the loaded model
   * @param {number} options.x @param {number} options.z placement
   * @param {number} [options.scale] metres per kit unit
   * @param {{heightAt: (x: number, z: number) => number}|null} options.terrain
   */
  constructor({ source, x, z, scale = 1.2, terrain }) {
    this.terrain = terrain;
    this.countsTowardPopulation = false;

    this.root = new Group();
    const model = source.clone(true);
    model.traverse((child) => {
      if (child instanceof Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    model.scale.setScalar(scale);
    this.root.add(model);
    this.root.position.set(x, terrain ? terrain.heightAt(x, z) : 0, z);

    // The analytic skeleton: a squat body on a base, its "head" the gun pod.
    this.bones = new Map();
    const hips = new Object3D();
    hips.position.set(0, 0.3 * scale, 0);
    const neck = new Object3D();
    neck.position.set(0, 0.45 * scale, 0);
    const head = new Object3D();
    head.position.set(0, 0.6 * scale, 0);
    this.root.add(hips, neck, head);
    this.bones.set('Hips', hips);
    this.bones.set('Neck', neck);
    this.bones.set('Head', head);

    this.health = settings.gunplay.damage.health * 2;
    this.state = 'alive';
    this.timer = 0;
    this.facing = 0;
    /** Aim and fire behaviour. */
    this.range = settings.turrets.range;
    this.turnRate = settings.turrets.turnRate;
    this.fireInterval = settings.turrets.fireInterval;
    this._cooldown = 0;
    /**
     * Where a fired round goes, set by the owner: `(turret, origin, direction)`.
     * The turret decides *that* it fires; what a round means for the player is
     * not its business.
     */
    this.onFire = null;
  }

  get alive() {
    return this.state === 'alive';
  }

  /** True once the wreck is cleared and the manager may drop the slot. */
  get finished() {
    return this.state === 'gone';
  }

  get position() {
    return this.root.position;
  }

  /** The gun spends health; only `EnemyManager#kill` puts the turret down. */
  wound(amount) {
    if (!this.alive) return null;
    this.health -= amount;
    return this.health <= 0 ? 'down' : 'hit';
  }

  /** @returns {boolean} false if it was already down */
  die() {
    if (this.state !== 'alive') return false;
    this.state = 'dead';
    this.timer = 0;
    return true;
  }

  retire() {
    this.state = 'gone';
  }

  update(dt, player) {
    this.timer += dt;

    if (this.state === 'alive') {
      // Slew the whole mount onto the player while they are in range.
      const dx = player.x - this.root.position.x;
      const dz = player.z - this.root.position.z;
      this._cooldown = Math.max(0, this._cooldown - dt);
      const dist = Math.hypot(dx, dz);
      if (dist < this.range) {
        const target = Math.atan2(dx, dz);
        let delta = target - this.facing;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        const step = this.turnRate * dt;
        this.facing += MathUtils.clamp(delta, -step, step);
        this.root.rotation.y = this.facing;
        // On the mark and loaded: fire. The muzzle is the "head" joint.
        if (Math.abs(delta) < 0.1 && this._cooldown <= 0 && this.onFire) {
          this._cooldown = this.fireInterval;
          const head = this.bones.get('Head');
          head.getWorldPosition(_muzzle);
          _dir.set(dx, 0, dz).normalize();
          this.onFire(this, _muzzle, _dir);
        }
      }
      return;
    }

    if (this.state === 'dead') {
      // Killed: keel over, then burn out on the same clock the bodies use.
      this.root.rotation.x = Math.min(Math.PI / 2, this.root.rotation.x + dt * 2);
      if (this.timer >= settings.enemies.corpseTime) this.state = 'gone';
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
  }
}

/** Where the mounts stand, and which model each takes. */
const MOUNTS = [
  ['Turret_GunDouble', -3.4, -10.6, 1.2, ['circle', 0.8]],
  ['Turret_Cannon', 3.6, -10.8, 1.2, ['circle', 0.8]]
];

export class YardTurrets {
  /**
   * @param {import('./Terrain.js').Terrain} terrain
   * @param {import('./LogisticsYard.js').LogisticsYard} yard solid footprints
   */
  constructor(terrain, yard) {
    this.terrain = terrain;
    this.yard = yard;
    this.group = new Group();
    this.group.name = 'yard-turrets';
    /** @type {Turret[]} */
    this.turrets = [];
  }

  /**
   * @param {import('../loaders/AssetLoader.js').AssetLoader} assets
   */
  async load(assets) {
    for (const [name, x, z, scale, collider] of MOUNTS) {
      const gltf = await assets.loadGLTF(`${BASE}${name}.gltf`);
      const turret = new Turret({ source: gltf.scene, x, z, scale, terrain: this.terrain });
      this.turrets.push(turret);
      this.group.add(turret.root);
      if (collider) {
        const [kind, r] = collider;
        this.yard.colliders.push({ x, z, rotY: 0, kind, a: r * scale, b: 0 });
      }
    }
  }
}
