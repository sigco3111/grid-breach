import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack
} from 'three';

/**
 * Cross-rig retargeting: Quaternius Universal Animation Library (rigify
 * `DEF-*` skeleton) onto the CC0 sci-fi soldier (Blender `metarig` skeleton,
 * renamed to `mixamorig*` at load — see `CharacterController`).
 *
 * Neither `SkeletonUtils.retargetClip` nor name-copying works here:
 *
 *  - The two rigs bind in different poses. The mannequin binds in a T-pose,
 *    the soldier in an A-pose, so a raw world-delta transfer folds the arms
 *    down and in — the offset between the two rests is applied to every frame.
 *  - Bone local axes disagree (the soldier's hips live under a -90°X armature,
 *    so its local "up" is +Z), and joint rolls differ throughout.
 *
 * The transfer below works in world space against *aligned* rest references:
 * each target bone's rest orientation is pre-rotated so its bone direction
 * (toward its mapped child) matches the source's rest direction, and the
 * per-frame delta `world(t) · rest⁻¹` then rides on top of that. Leaf bones
 * with no mapped child inherit the nearest adjusted ancestor's alignment so a
 * hand stays rigid against its forearm.
 *
 * Verified in the standalone prototype (/downloads/rigproto) on 2026-11-21:
 * idle/walk/pistol-aim render with a connected arm chain and grounded feet.
 */

/** Renamed soldier joint → UAL joint (names as sanitised by GLTFLoader). */
export const UAL_BONES = {
  'mixamorigHips': 'DEF-hips',
  'mixamorigSpine': 'DEF-spine001',
  'mixamorigSpine2': 'DEF-spine002',
  'mixamorigNeck': 'DEF-neck',
  'mixamorigHead': 'DEF-head',
  'mixamorigLeftShoulder': 'DEF-shoulderL',
  'mixamorigLeftArm': 'DEF-upper_armL',
  'mixamorigLeftForeArm': 'DEF-forearmL',
  'mixamorigLeftHand': 'DEF-handL',
  'mixamorigRightShoulder': 'DEF-shoulderR',
  'mixamorigRightArm': 'DEF-upper_armR',
  'mixamorigRightForeArm': 'DEF-forearmR',
  'mixamorigRightHand': 'DEF-handR',
  'mixamorigLeftUpLeg': 'DEF-thighL',
  'mixamorigLeftLeg': 'DEF-shinL',
  'mixamorigLeftFoot': 'DEF-footL',
  'mixamorigLeftToeBase': 'DEF-toeL',
  'mixamorigRightUpLeg': 'DEF-thighR',
  'mixamorigRightLeg': 'DEF-shinR',
  'mixamorigRightFoot': 'DEF-footR',
  'mixamorigRightToeBase': 'DEF-toeR'
};
for (const [f, mx] of [['index', 'Index'], ['middle', 'Middle'], ['ring', 'Ring'], ['pinky', 'Pinky']]) {
  for (const side of ['L', 'R']) {
    for (const n of ['01', '02', '03']) {
      UAL_BONES[`mixamorig${side === 'L' ? 'Left' : 'Right'}Hand${mx}${Number(n)}`] = `DEF-f_${f}${n}${side}`;
    }
  }
}
for (const side of ['L', 'R']) {
  for (const n of ['01', '02', '03']) {
    UAL_BONES[`mixamorig${side === 'L' ? 'Left' : 'Right'}HandThumb${Number(n)}`] = `DEF-thumb${n}${side}`;
  }
}

// The official Standard pack (UAL1_Standard.glb) names its bones Unreal-style.
const UE_NAME = {
  'DEF-hips': 'pelvis', 'DEF-spine001': 'spine_01', 'DEF-spine002': 'spine_02',
  'DEF-neck': 'neck_01', 'DEF-head': 'Head',
  'DEF-shoulderL': 'clavicle_l', 'DEF-upper_armL': 'upperarm_l', 'DEF-forearmL': 'lowerarm_l', 'DEF-handL': 'hand_l',
  'DEF-shoulderR': 'clavicle_r', 'DEF-upper_armR': 'upperarm_r', 'DEF-forearmR': 'lowerarm_r', 'DEF-handR': 'hand_r',
  'DEF-thighL': 'thigh_l', 'DEF-shinL': 'calf_l', 'DEF-footL': 'foot_l', 'DEF-toeL': 'ball_l',
  'DEF-thighR': 'thigh_r', 'DEF-shinR': 'calf_r', 'DEF-footR': 'foot_r', 'DEF-toeR': 'ball_r'
};
for (const [k, v] of Object.entries(UAL_BONES)) {
  let m;
  if (UE_NAME[v]) UAL_BONES[k] = UE_NAME[v];
  else if ((m = /^DEF-f_(index|middle|ring|pinky)(\d\d)([LR])$/.exec(v))) UAL_BONES[k] = `${m[1]}_${m[2]}_${m[3].toLowerCase()}`;
  else if ((m = /^DEF-thumb(\d\d)([LR])$/.exec(v))) UAL_BONES[k] = `thumb_${m[1]}_${m[2].toLowerCase()}`;
  else throw new Error('UAL bone map: no official name for ' + v);
}

/** Soldier node name → the `mixamorig*` name the rest of the game asks for.
 * Colon-free, exactly what FBXLoader's sanitizeNodeName produced for the old
 * rig: a ':' in a node name makes `PropertyBinding` parse it as a directory
 * prefix, and every animation track silently fails to bind. */
export const SOLDIER_RENAME = {
  hips: 'mixamorigHips',
  spine: 'mixamorigSpine',
  chest: 'mixamorigSpine2',
  neck: 'mixamorigNeck',
  head: 'mixamorigHead',
  shoulder_L: 'mixamorigLeftShoulder',
  upper_arm_L: 'mixamorigLeftArm',
  forearm_L: 'mixamorigLeftForeArm',
  hand_L: 'mixamorigLeftHand',
  thigh_L: 'mixamorigLeftUpLeg',
  shin_L: 'mixamorigLeftLeg',
  foot_L: 'mixamorigLeftFoot',
  toe_L: 'mixamorigLeftToeBase',
  shoulder_R: 'mixamorigRightShoulder',
  upper_arm_R: 'mixamorigRightArm',
  forearm_R: 'mixamorigRightForeArm',
  hand_R: 'mixamorigRightHand',
  thigh_R: 'mixamorigRightUpLeg',
  shin_R: 'mixamorigRightLeg',
  foot_R: 'mixamorigRightFoot',
  toe_R: 'mixamorigRightToeBase'
};
for (const [f, mx] of [['index', 'Index'], ['middle', 'Middle'], ['ring', 'Ring'], ['pinky', 'Pinky']]) {
  for (const side of ['L', 'R']) {
    for (const n of ['01', '02', '03']) {
      SOLDIER_RENAME[`f_${f}_${n}_${side}`] = `mixamorig${side === 'L' ? 'Left' : 'Right'}Hand${mx}${Number(n)}`;
    }
  }
}
for (const side of ['L', 'R']) {
  for (const n of ['01', '02', '03']) {
    SOLDIER_RENAME[`thumb_${n}_${side}`] = `mixamorig${side === 'L' ? 'Left' : 'Right'}HandThumb${Number(n)}`;
  }
}

/** Logical clip name (as the game asks for it) → clip inside the UAL library. */
export const UAL_CLIPS = {
  idle: 'Idle_Loop',
  // No rifle clips exist in the UAL; the pistol *aim* is the two-handed
  // forward hold, while Pistol_Idle_Loop is a lowered ready pose that reads
  // as raised arms from behind.
  idleRifle: 'Pistol_Aim_Neutral',
  // walkRifle/runRifle/walkSideRifle are deliberately absent: mapping them to the
  // plain walk/jog made Locomotion#unposed read 0 while moving, which switched
  // the additive rifle-hold layer off and left the arms swinging.
  walk: 'Walk_Loop',
  run: 'Jog_Fwd_Loop',
  bigJump: 'Jump_Start',
  hop: 'Jump_Start',
  fireRifle: 'Pistol_Shoot', // recoil layer, additive — see RifleAim#_additive
  reload: 'Pistol_Reload',
  diveRoll: 'Roll',
  hitReaction: 'Hit_Chest',
  death: 'Death01'
};

const _q = new Quaternion();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _v4 = new Vector3();

export class UalRetargeter {
  /**
   * @param {import('three').Object3D} targetRoot soldier scene, bones already renamed
   * @param {import('three').Object3D} sourceRoot UAL mannequin scene
   */
  constructor(targetRoot, sourceRoot) {
    this.targetRoot = targetRoot;
    this.sourceRoot = sourceRoot;

    const srcByName = {};
    sourceRoot.traverse((o) => { if (o.isBone) srcByName[o.name] = o; });
    const tgtBones = [];
    targetRoot.traverse((o) => { if (o.isBone) tgtBones.push(o); }); // parent-first

    this.pairs = [];
    for (const tb of tgtBones) {
      const sn = UAL_BONES[tb.name];
      if (sn && srcByName[sn]) this.pairs.push({ tb, sb: srcByName[sn] });
    }

    targetRoot.updateMatrixWorld(true);
    sourceRoot.updateMatrixWorld(true);

    for (const p of this.pairs) {
      p.restSrcWorldInv = p.sb.getWorldQuaternion(new Quaternion()).invert();
      p.restTgtWorld = p.tb.getWorldQuaternion(new Quaternion());
    }

    // Rest alignment: A-pose target onto the T-pose source reference.
    const pairByBone = new Map(this.pairs.map((p) => [p.tb, p]));
    for (const p of this.pairs) {
      const childPair = this.pairs.find((q) => q.tb.parent === p.tb);
      if (!childPair) continue;
      const cur = childPair.tb.getWorldPosition(_v1).sub(p.tb.getWorldPosition(_v2)).normalize();
      const src = childPair.sb.getWorldPosition(_v3).sub(p.sb.getWorldPosition(_v4)).normalize();
      if (cur.lengthSq() < 1e-8 || src.lengthSq() < 1e-8) continue;
      p.restAlign = new Quaternion().setFromUnitVectors(cur, src);
      p.restTgtWorld = p.restAlign.clone().multiply(p.restTgtWorld);
    }
    for (const p of this.pairs) {
      if (p.restAlign) continue;
      let a = p.tb.parent;
      while (a && a.isBone) {
        const ap = pairByBone.get(a);
        if (ap && ap.restAlign) {
          p.restTgtWorld = ap.restAlign.clone().multiply(p.restTgtWorld);
          break;
        }
        a = a.parent;
      }
    }

    this.srcHips = srcByName['pelvis'];
    this.tgtHips = targetRoot.getObjectByName('mixamorigHips');
    const srcHipY = this.srcHips.getWorldPosition(new Vector3()).y;
    const tgtHipY = this.tgtHips.getWorldPosition(new Vector3()).y;
    this.hipScale = srcHipY > 1e-6 ? tgtHipY / srcHipY : 1;
    /** Hips bind position in parent-local units — travel is frozen onto it. */
    this.hipsBindLocal = this.tgtHips.position.clone();
  }

  /**
   * Retarget one UAL clip onto the soldier skeleton.
   *
   * The hips keep their vertical bob but travel is frozen at the bind X/Z —
   * the controller owns the character's position, as with the old pipeline.
   *
   * @param {import('three').AnimationClip} clip
   * @param {string} name logical name the game will ask for
   * @param {import('three').AnimationMixer} sourceMixer mixer bound to the UAL scene
   * @returns {import('three').AnimationClip}
   */
  retarget(clip, name, sourceMixer) {
    const fps = 30;
    const frames = Math.max(2, Math.round(clip.duration * fps));
    const dt = clip.duration / (frames - 1);
    const times = new Float32Array(frames);
    for (const p of this.pairs) p.quatVals = new Float32Array(frames * 4);
    const hipPos = new Float32Array(frames * 3);

    const action = sourceMixer.clipAction(clip);
    action.play();

    for (let f = 0; f < frames; f++) {
      times[f] = f * dt;
      sourceMixer.setTime(f * dt);
      this.sourceRoot.updateMatrixWorld(true);

      const worldQ = new Map();
      const getWorldQ = (bone) => {
        if (worldQ.has(bone)) return worldQ.get(bone);
        let q;
        const pair = this.pairs.find((p) => p.tb === bone);
        if (pair) {
          const sw = pair.sb.getWorldQuaternion(_q);
          q = sw.clone().multiply(pair.restSrcWorldInv).multiply(pair.restTgtWorld);
        } else {
          const parentQ = bone.parent && bone.parent.isBone
            ? getWorldQ(bone.parent)
            : bone.parent.getWorldQuaternion(new Quaternion());
          q = parentQ.clone().multiply(bone.quaternion); // rest local
        }
        worldQ.set(bone, q);
        return q;
      };
      for (const p of this.pairs) {
        const wq = getWorldQ(p.tb);
        const parentQ = p.tb.parent && p.tb.parent.isBone
          ? getWorldQ(p.tb.parent)
          : p.tb.parent.getWorldQuaternion(new Quaternion());
        const local = parentQ.clone().invert().multiply(wq);
        local.toArray(p.quatVals, f * 4);
      }

      // Hips: source world position, rescaled, into hips-parent local space.
      const swp = this.srcHips.getWorldPosition(_v1);
      _v2.set(swp.x * this.hipScale, swp.y * this.hipScale, swp.z * this.hipScale);
      const parentInv = this.tgtHips.parent.matrixWorld.clone().invert();
      _v2.applyMatrix4(parentInv);
      // This rig's hips live under a -90°X armature: local x = side,
      // y = forward, z = up. Keep the whole translation frozen at bind: the
      // controller owns position, and the source bob does not survive the
      // unit jump between the two rigs — a known, small loss (no crouch
      // dips in the clips) until the armature scale is untangled.
      hipPos[f * 3] = this.hipsBindLocal.x;
      hipPos[f * 3 + 1] = this.hipsBindLocal.y;
      hipPos[f * 3 + 2] = this.hipsBindLocal.z;
    }

    action.stop();
    sourceMixer.uncacheClip(clip);

    const tracks = this.pairs.map(
      (p) => new QuaternionKeyframeTrack(p.tb.name + '.quaternion', times, p.quatVals)
    );
    tracks.push(new VectorKeyframeTrack('mixamorigHips.position', times, hipPos));
    return new AnimationClip(name, clip.duration, tracks);
  }
}
