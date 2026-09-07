/**
 * Mining pose + timing, kept free of Babylon so it is trivial to unit test.
 * All timings are seconds measured from the start of the wind-up (the moment the
 * player presses the pick). The character rig consumes `action` (remaining seconds)
 * as `progress = 1 - action / MINING_SWING_DURATION`, so the impact keyed at
 * MINING_IMPACT_TIME lines up with the frame the engine fires the hit.
 */
export const MINING_SWING_DURATION = 0.72;
export const MINING_IMPACT_TIME = 0.38;

/** The strike lands at exactly this fraction of the swing. */
export const MINING_IMPACT_PROGRESS = MINING_IMPACT_TIME / MINING_SWING_DURATION;

/** Hand-item id used by the rig and the held-tool view. */
export const PICKAXE_ID = "pickaxe";

/**
 * Where the pick head sits in the held-tool root frame. The voxel head is built around
 * this point and `createHeldTools` places `pickaxeTip` here, so the visual head and the
 * trajectory point are the same place.
 */
export const PICKAXE_TIP_LOCAL = { x: 0, y: -0.80, z: -0.46 } as const;

export type MiningPose = {
  /** Right (tool) arm: rotation.x from hanging (0) up through the forward smash. */
  shoulderX: number;
  /** Right arm yaw; drags the pick across the body during the wind-up. */
  shoulderY: number;
  /** Right arm roll; the pick leans out a touch on the raise. */
  shoulderZ: number;
  /** Right elbow flex; coiled on the wind-up, snapped open through the strike. */
  elbowX: number;
  /** Left (support) arm: raises to grip the haft during the wind-up. */
  supportX: number;
  /** Left elbow flex. */
  supportElbowX: number;
  /** Torso pitch; negative leans forward into the strike. */
  bodyX: number;
  /** Torso roll; a little weight shift either side of the swing. */
  bodyZ: number;
};

/**
 * Resting carry pose (applied when the pick is held but not swinging, and used as the
 * start/end of the swing). The right arm is bent up so the head is carried above the
 * ground - the idle/walk pose must never stab the tile surface.
 */
export const MINING_HOLD_POSE: MiningPose = {
  shoulderX: 0.40, shoulderY: 0, shoulderZ: 0, elbowX: 0.85,
  supportX: 0, supportElbowX: 0.12, bodyX: 0, bodyZ: 0,
};

type Key = {
  u: number;
  sx: number; sy: number; sz: number; ex: number;
  px: number; pe: number;
  bx: number; bz: number;
};

// Keyframes are authored in swing-progress space. From the carry pose the pick is
// coiled overhead (well clear of the head), snapped forward-down onto the rock at the
// impact key, rebounds off the hit, and settles back to the carry.
const KEYS: Key[] = [
  { u: 0,                       sx: 0.40, sy: 0,    sz: 0,    ex: 0.85, px: 0,    pe: 0.12, bx: 0,    bz: 0 },
  { u: 0.30,                    sx: 2.35, sy: -0.15, sz: 0.12, ex: 0.50, px: 1.85, pe: 0.72, bx: 0.10, bz: 0.05 },
  { u: MINING_IMPACT_PROGRESS,  sx: 0.85, sy: 0,    sz: -0.03, ex: 0.16, px: 0.58, pe: 0.30, bx: -0.17, bz: -0.05 },
  { u: 0.62,                    sx: 1.15, sy: 0.05, sz: 0,    ex: 0.35, px: 0.78, pe: 0.42, bx: -0.05, bz: 0.03 },
  { u: 1,                       sx: 0.40, sy: 0,    sz: 0,    ex: 0.85, px: 0,    pe: 0.12, bx: 0,    bz: 0 },
];

const smoothstep = (t: number) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/** Pure swing pose for `progress` in [0,1]; clamps outside that range. */
export function miningPose(progress: number): MiningPose {
  const u = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  let i = 0;
  while (i < KEYS.length - 1 && u > KEYS[i + 1].u) i++;
  const a = KEYS[i];
  const b = KEYS[Math.min(i + 1, KEYS.length - 1)];
  const span = Math.max(1e-6, b.u - a.u);
  const t = smoothstep((u - a.u) / span);
  return {
    shoulderX: a.sx + (b.sx - a.sx) * t,
    shoulderY: a.sy + (b.sy - a.sy) * t,
    shoulderZ: a.sz + (b.sz - a.sz) * t,
    elbowX: a.ex + (b.ex - a.ex) * t,
    supportX: a.px + (b.px - a.px) * t,
    supportElbowX: a.pe + (b.pe - a.pe) * t,
    bodyX: a.bx + (b.bx - a.bx) * t,
    bodyZ: a.bz + (b.bz - a.bz) * t,
  };
}
