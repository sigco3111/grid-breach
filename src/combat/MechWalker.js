import { AnimationMixer, Box3, Group, LoopOnce, MathUtils, Mesh, Object3D, SkinnedMesh } from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

import { settings } from '../config/settings.js';

/**
 * A walking mech — the Cyberpunk Game Kit's `Enemy_2Legs` (CC0) standing in
 * for the template's rigged humanoid. Two reasons for the swap: the template
 * body is one of the assets whose publishing rights are unresolved, and a
 * mech reads fine even without a humanoid rig. The kit ships walk, idle,
 * attack and death cycles per unit (`clips`), and they play through a mixer
 * on the cloned skeleton — walking legs come from the kit, not from sliding.
 *
 * The combat interface is the one the turrets already speak: fabricated
 * `bones` for the hit volumes, `health`/`wound()` for the gun, `die()`/
 * `finished`/`dispose()` for the manager's kill path. What a walker adds is
 * `update()`: it closes on the player once they are inside the aggro radius
 * and holds at arm's length. In arm's reach it winds up and strikes — the
 * manager turns the returned damage into a player hit.
 */
export class MechWalker {
  /** The hover drone: high, fast, fragile, jabs in short reach. */
  static FLYER = {
    height: 1.0, hover: 2.2, speed: 2.2, aggroRange: 18,
    standoff: 1.6, attackRange: 2.1, attackDamage: 6, attackCooldown: 1.2,
    health: 60, hitboxScale: 1.3
  };
  /** The heavy: slow, tall, and it hits like a door. */
  static HEAVY = {
    height: 2.6, speed: 0.85, aggroRange: 13,
    standoff: 2.4, attackRange: 2.9, attackDamage: 16, attackCooldown: 2.2,
    health: 320, hitboxScale: 2.0
  };

  /**
   * @param {object} options
   * @param {import('three').Object3D} options.source the loaded model
   * @param {{heightAt: (x: number, z: number) => number}|null} options.terrain
   * @param {{pushOut: (position: Vector3, radius: number) => void}|null} [options.yard]
   */
  constructor({ source, clips = null, terrain, yard = null, profile = {} }) {
    this.terrain = terrain;
    this.yard = yard;
    /** Unit tuning — the plain walker is the defaults; flyers and heavies
     *  differ only in these numbers, not in any code path. */
    this.profile = profile;

    this.root = new Group();
    // Skinned meshes do not survive a plain clone — the copy keeps pointing at
    // the original's bones and renders wherever they are. SkeletonUtils
    // rebinds the clone's own skeleton.
    const model = skeletonClone(source);
    model.traverse((child) => {
      if (child instanceof Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    // Measure the real body before trusting it: the kit model's origin is
    // neither at its feet nor between them, so scaling by an assumed height
    // left it floating and shifted. Skinned bounds come off the posed
    // vertices, not the bind box.
    model.updateMatrixWorld(true);
    const bounds = new Box3();
    const part = new Box3();
    model.traverse((child) => {
      if (child instanceof SkinnedMesh) {
        child.computeBoundingBox();
        part.copy(child.boundingBox).applyMatrix4(child.matrixWorld);
        bounds.union(part);
      } else if (child instanceof Mesh) {
        child.geometry.computeBoundingBox();
        part.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
        bounds.union(part);
      }
    });
    const rawHeight = Math.max(1e-3, bounds.max.y - bounds.min.y);
    this.scale = (profile.height ?? settings.enemies.height) / rawHeight;
    model.scale.setScalar(this.scale);
    model.position.set(
      -((bounds.min.x + bounds.max.x) / 2) * this.scale,
      -bounds.min.y * this.scale,
      -((bounds.min.z + bounds.max.z) / 2) * this.scale
    );
    this.root.add(model);

    // The analytic skeleton the gun's hit volumes read, sized to the body's
    // real metres — not the walker's, or the flyer and the heavy would wear
    // another unit's ribcage.
    const height = profile.height ?? settings.enemies.height;
    this.bones = new Map();
    const hips = new Object3D();
    hips.position.set(0, 0.45 * height, 0);
    const neck = new Object3D();
    neck.position.set(0, 0.6 * height, 0);
    const head = new Object3D();
    head.position.set(0, 0.7 * height, 0);
    this.root.add(hips, neck, head);
    this.bones.set('Hips', hips);
    this.bones.set('Neck', neck);
    this.bones.set('Head', head);

    this.health = profile.health ?? settings.gunplay.damage.health;
    this.state = 'alive';
    this.timer = 0;
    this.facing = 0;
    this._flinch = 0;

    /** Behaviour: how close it starts caring, and where it stops. */
    this.aggroRange = profile.aggroRange ?? 15;
    this.standoff = profile.standoff ?? 1.8;
    this.speed = profile.speed ?? 1.4;
    /** Metres above the ground it holds, if it flies at all. */
    this.hover = profile.hover ?? 0;
    /** Hit volumes are the humanoid's radii times this — mechs are wider. */
    this.hitboxScale = profile.hitboxScale ?? 1.6;

    /** Melee: reach, hit strength, and the pause between swings. */
    this.attackRange = profile.attackRange ?? 2.3;
    this.attackDamage = profile.attackDamage ?? settings.player.mechDamage;
    this.attackCooldown = profile.attackCooldown ?? 1.6;
    this._attackTimer = 0;
    /** Wind-up/lunge animation progress, seconds remaining. */
    this._lunge = 0;
    this._lungeTime = 0.3;
    /** A swing that has started but not landed: damage and seconds to impact. */
    this._pendingStrike = 0;
    this._strikeIn = 0;
    this._model = model;

    // The kit's own cycles, played on the cloned skeleton (SkeletonUtils
    // keeps the node names the tracks bind to). Idle is the base layer; walk
    // and the one-shots cross-fade over it. The flyer's death clip is named
    // `Dead`, the others `Death`.
    this.mixer = null;
    this._actions = {};
    this._anim = null;
    if (clips?.length) {
      this.mixer = new AnimationMixer(model);
      const find = (...names) => clips.find((c) => names.includes(c.name));
      const make = (clip, once = false) => {
        if (!clip) return null;
        const action = this.mixer.clipAction(clip);
        if (once) {
          action.setLoop(LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        return action;
      };
      this._actions = {
        idle: make(find('Idle')),
        walk: make(find('Walk', 'Run')),
        attack: make(find('Attack'), true),
        death: make(find('Death', 'Dead'), true),
      };
      this.mixer.addEventListener('finished', (event) => {
        // A spent one-shot hands the pick back to the per-frame rule.
        if (event.action === this._actions.attack) this._anim = null;
      });
      const base = this._actions.idle ?? this._actions.walk;
      if (base) {
        base.play();
        this._anim = this._actions.idle ? 'idle' : 'walk';
      }
    }
  }

  /** Cross-fade to another cycle; no-ops when it is already the current one. */
  _play(name, fade = 0.15) {
    const next = this._actions[name];
    if (!next || this._anim === name) return;
    const prev = this._actions[this._anim];
    next.enabled = true;
    next.reset();
    if (prev) next.crossFadeFrom(prev, fade, false);
    next.play();
    this._anim = name;
  }

  get alive() {
    return this.state === 'alive';
  }

  get finished() {
    return this.state === 'gone';
  }

  get position() {
    return this.root.position;
  }

  /** Drop the walker at (x, z), facing `yaw`. Mirrors `Enemy#place`. */
  place(x, z, yaw = 0) {
    this.root.position.set(x, this.terrain ? this.terrain.heightAt(x, z) + this.hover : 0, z);
    this.facing = yaw;
    this.root.rotation.y = yaw;
  }

  wound(amount) {
    if (!this.alive) return null;
    this.health -= amount;
    this._flinch = settings.gunplay.damage.flinch;
    return this.health <= 0 ? 'down' : 'hit';
  }

  die() {
    if (this.state !== 'alive') return false;
    this.state = 'dead';
    this.timer = 0;
    this._play('death', 0.08);
    return true;
  }

  retire() {
    this.state = 'gone';
  }

  update(dt, player) {
    this.timer += dt;
    this.mixer?.update(dt);

    if (this.state === 'alive') {
      let moving = false;
      this._flinch = Math.max(0, this._flinch - dt);
      const position = this.root.position;
      const dx = player.x - position.x;
      const dz = player.z - position.z;
      const distance = Math.hypot(dx, dz);

      if (distance < this.aggroRange && distance > this.standoff && this._flinch <= 0) {
        const step = Math.min(this.speed * dt, distance - this.standoff);
        if (step > 1e-4) moving = true;
        position.x += (dx / distance) * step;
        position.z += (dz / distance) * step;
        this.yard?.pushOut(position, settings.enemies.bodyRadius);
        if (this.terrain) {
          // Flyers hold their altitude with a slow bob rather than the dirt.
          position.y = this.terrain.heightAt(position.x, position.z) + this.hover
            + (this.hover > 0 ? Math.sin(this.timer * 2.1) * 0.15 : 0);
        }
      }

      if (distance < this.aggroRange) {
        const target = Math.atan2(dx, dz);
        let delta = target - this.facing;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        const turn = 4 * dt;
        this.facing += MathUtils.clamp(delta, -turn, turn);
        this.root.rotation.y = this.facing;
      }

      // The swing starts with a wind-up; the hit only lands at the end of the
      // lunge, and only if the player is still in reach — stepping back during
      // the tell is a clean dodge (0.3 s to clear 2.3 m).
      this._attackTimer = Math.max(0, this._attackTimer - dt);
      let strike = 0;
      if (distance <= this.attackRange && this._attackTimer <= 0 && this._flinch <= 0) {
        this._attackTimer = this.attackCooldown;
        this._lunge = this._lungeTime;
        this._pendingStrike = this.attackDamage;
        this._strikeIn = this._lungeTime;
      }
      if (this._pendingStrike > 0) {
        this._strikeIn -= dt;
        if (this._strikeIn <= 0) {
          if (distance <= this.attackRange) strike = this._pendingStrike;
          this._pendingStrike = 0;
        }
      }
      if (this._lunge > 0) {
        this._lunge = Math.max(0, this._lunge - dt);
        const t = 1 - this._lunge / this._lungeTime;
        this._model.position.z = Math.sin(Math.PI * Math.min(1, t * 1.6)) * 0.35;
      } else {
        this._model.position.z = 0;
      }
      this._play(this._lunge > 0 ? 'attack' : moving ? 'walk' : 'idle');
      return strike > 0 ? { strike } : null;
    }

    if (this.state === 'dead') {
      // The death clip carries the fall when there is one; the tip-over is
      // the fallback for a model without it.
      if (!this._actions.death) {
        this.root.rotation.x = Math.min(Math.PI / 2, this.root.rotation.x + dt * 2);
      }
      // A dead flyer comes down before it lies still.
      if (this.hover > 0 && this.terrain) {
        const floor = this.terrain.heightAt(this.root.position.x, this.root.position.z);
        this.root.position.y = Math.max(floor, this.root.position.y - dt * 4);
      }
      if (this.timer >= settings.enemies.corpseTime) this.state = 'gone';
    }
  }

  dispose() {
    this.root.parent?.remove(this.root);
  }
}
