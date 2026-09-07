import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  MINING_SWING_DURATION,
  MINING_IMPACT_TIME,
  MINING_IMPACT_PROGRESS,
  MINING_HOLD_POSE,
  PICKAXE_ID,
  PICKAXE_TIP_LOCAL,
  miningPose,
} from "../components/game/miningMotion";
import { createFarmer } from "../components/game/character";
import { createHeldTools } from "../components/game/farmView";
import { SOUND_IDS, synthesizeSound } from "../components/game/audio";

const MINING_IDS = ["mineSwing", "mineHit", "mineBreak", "crystalHit"] as const;
const SAMPLE_POINTS = 501;

/** Replicate the global audio-safety envelope used by verify-audio for the new sounds. */
function audioBounded(id: (typeof MINING_IDS)[number], rate: number, variant: number) {
  const samples = synthesizeSound(id, variant, rate);
  let peak = 0;
  let power = 0;
  for (const v of samples) {
    assert(Number.isFinite(v), `${id}: sample is finite`);
    peak = Math.max(peak, Math.abs(v));
    power += v * v;
  }
  const rms = Math.sqrt(power / samples.length);
  assert(samples.length > rate * 0.04 && samples.length < rate, `${id}: duration stays short and bounded`);
  assert(peak < 0.24, `${id}: quiet, no harsh peak (peak=${peak.toFixed(3)})`);
  assert(rms > 0.003 && rms < 0.045, `${id}: audible but controlled (rms=${rms.toFixed(4)})`);
  assert(samples[0] === 0, `${id}: no click on attack`);
  assert(Math.abs(samples.at(-1)!) < 0.002, `${id}: fade avoids a click at the end`);
  return samples;
}

export function verifyMiningMotion() {
  // --- timing contract ---
  assert.equal(MINING_SWING_DURATION, 0.72);
  assert.equal(MINING_IMPACT_TIME, 0.38);
  assert(Math.abs(MINING_IMPACT_PROGRESS - MINING_IMPACT_TIME / MINING_SWING_DURATION) < 1e-12);
  assert(MINING_IMPACT_TIME > 0 && MINING_IMPACT_TIME < MINING_SWING_DURATION);
  assert.equal(PICKAXE_ID, "pickaxe");
  assert.deepEqual(PICKAXE_TIP_LOCAL, { x: 0, y: -0.80, z: -0.46 });

  // --- the swing starts and ends on the resting carry pose (no residue, no pop) ---
  const hold = miningPose(0);
  assert(Math.abs(hold.shoulderX - MINING_HOLD_POSE.shoulderX) < 1e-9);
  assert(Math.abs(hold.elbowX - MINING_HOLD_POSE.elbowX) < 1e-9);
  for (const done of [miningPose(1), miningPose(2), miningPose(-1)]) {
    assert(Math.abs(done.shoulderX - MINING_HOLD_POSE.shoulderX) < 1e-9, "over/under-range progress settles to the carry pose");
    assert(Math.abs(done.elbowX - MINING_HOLD_POSE.elbowX) < 1e-9);
    assert(Math.abs(done.bodyX) < 1e-9);
  }

  // --- wind-up loads the pick overhead before the impact ---
  let peak = { u: 0, v: -Infinity };
  let supportPeak = 0;
  let bodyPeak = -Infinity;
  for (let k = 0; k <= SAMPLE_POINTS; k++) {
    const u = k / SAMPLE_POINTS;
    const p = miningPose(u);
    assert(Number.isFinite(p.shoulderX + p.shoulderY + p.shoulderZ + p.elbowX + p.supportX + p.supportElbowX + p.bodyX + p.bodyZ));
    if (p.shoulderX > peak.v) peak = { u, v: p.shoulderX };
    if (p.supportX > supportPeak) supportPeak = p.supportX;
    if (p.bodyX > bodyPeak) bodyPeak = p.bodyX;
  }
  assert(peak.v > 1.8, `the pick is raised overhead for the wind-up (peak=${peak.v.toFixed(2)})`);
  assert(peak.u < MINING_IMPACT_PROGRESS, `the wind-up peaks before the impact (peak at ${peak.u.toFixed(2)})`);

  // --- at the impact the arm has snapped forward-down and the torso leans in ---
  const impact = miningPose(MINING_IMPACT_PROGRESS);
  assert(impact.shoulderX < peak.v * 0.6, `the strike drives down from the wind-up (${impact.shoulderX.toFixed(2)} < ${(peak.v * 0.6).toFixed(2)})`);
  assert(impact.shoulderX > 0.3, "the pick still points forward/down at the strike");
  assert(impact.bodyX < -0.08, "the torso leans into the strike");
  assert(impact.elbowX < 0.5, "the elbow extends through the strike");

  // --- the smash is a monotonic fall into the rock, reaching the lowest point at impact ---
  const drive = [0.30, 0.36, 0.42, 0.47, 0.51, MINING_IMPACT_PROGRESS];
  let fell = false;
  for (let i = 1; i < drive.length; i++) {
    if (miningPose(drive[i]).shoulderX < miningPose(drive[i - 1]).shoulderX - 1e-9) fell = true;
    if (i < drive.length - 1) {
      assert(miningPose(drive[i]).shoulderX <= miningPose(drive[i - 1]).shoulderX + 1e-9, "no early bounce before the strike");
    }
  }
  assert(fell, "the smash falls onto the rock");

  // --- rebound after the hit, then recover; support hand and body both participate ---
  const rebound = miningPose(0.62);
  assert(rebound.shoulderX > impact.shoulderX + 0.05, "the pick rebounds after striking");
  assert(supportPeak > 1.0, "the support hand joins the wind-up");
  assert(impact.supportX < supportPeak, "both hands drive the pick down together");
  assert(impact.bodyX < 0 && bodyPeak > 0, "the torso winds back then attacks forward");

  // --- real geometry: measure the actual pickaxeTip on the farmer chain ---
  verifyGeometry();

  // --- the four mining sounds are in the catalog and synthesize safely ---
  for (const id of MINING_IDS) assert(SOUND_IDS.includes(id), `${id} is a registered sound id`);
  assert.equal(new Set(MINING_IDS).size, 4, "the mining ids are distinct");
  const variantSignatures = new Set<string>();
  for (const id of MINING_IDS) {
    for (const rate of [44100, 48000]) {
      const v0 = audioBounded(id, rate, 0);
      audioBounded(id, rate, 1);
      audioBounded(id, rate, 2);
      if (id === "mineHit" || id === "crystalHit" || id === "mineBreak") {
        const v1 = synthesizeSound(id, 1, rate);
        assert(v0.length === v1.length);
        assert(v0.some((s, i) => s !== v1[i]), `${id}: variants differ at ${rate}Hz`);
        variantSignatures.add(id);
      }
    }
  }
  assert.equal(variantSignatures.size, 3, "the impact variants are seeded per variant");

  console.log(
    "Mining regression passed: wind-up/impact/rebound timing, monotonic smash, carry-to-carry settle, " +
    "two-handed + torso participation, real pickaxe-tip geometry (idle/walk clearance, impact and wind-up targets), " +
    "no persistent transforms, other tools untouched, and four bounded, seeded mining sounds.",
  );
}

/** Measure the actual pickaxeTip (body yaw = 0, player at origin) against the game targets. */
function verifyGeometry() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const light = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
  const shadow = new ShadowGenerator(1024, light, true);
  const farmer = createFarmer(scene, shadow);
  const tools = createHeldTools(scene, farmer.hand, shadow);
  tools.select(PICKAXE_ID);
  farmer.root.position.set(0, 0, 0);
  // The trajectory point is the unified head (same place the voxel head is built around).
  assert(Math.abs(tools.pickaxeTip.position.x - PICKAXE_TIP_LOCAL.x) < 1e-6);
  assert(Math.abs(tools.pickaxeTip.position.y - PICKAXE_TIP_LOCAL.y) < 1e-6);
  assert(Math.abs(tools.pickaxeTip.position.z - PICKAXE_TIP_LOCAL.z) < 1e-6);

  const tip = () => {
    tools.pickaxeTip.computeWorldMatrix(true);
    const p = tools.pickaxeTip.getAbsolutePosition();
    return { y: p.y, z: p.z };
  };

  // Idle carry: the head must stay above the ground (>= .05).
  farmer.animate(0, 1 / 60, false, false, false, 0, true, PICKAXE_ID, null);
  const idle = tip();
  assert(idle.y >= 0.05, `idle carry clears the ground (y=${idle.y.toFixed(3)})`);

  // Walking & running never drive the carried head into the tile.
  for (const [label, moving, running] of [["walk", true, false], ["run", true, true]] as const) {
    let minY = Infinity;
    for (let f = 0; f < 120; f++) {
      farmer.animate(f / 60, 1 / 60, moving, running, false, 0, true, PICKAXE_ID, null);
      minY = Math.min(minY, tip().y);
    }
    assert(minY >= 0.05, `${label} carrying the pick never stabs the ground (minY=${minY.toFixed(3)})`);
  }

  // Wind-up top picks above the head and behind the shoulder.
  farmer.animate(0, 1 / 60, false, false, false, MINING_SWING_DURATION - 0.216, true, PICKAXE_ID, null);
  const windup = tip();
  assert(windup.y > 2.0, `wind-up raises the pick above the head (y=${windup.y.toFixed(3)})`);
  assert(windup.z > 0, `wind-up cocks the pick behind the shoulder (z=${windup.z.toFixed(3)})`);

  // Impact at MINING_IMPACT_TIME lands on the rock: y ~[.45,.85], z ~[-1.1,-1.6].
  farmer.animate(0, 1 / 60, false, false, false, MINING_SWING_DURATION - MINING_IMPACT_TIME, true, PICKAXE_ID, null);
  const hit = tip();
  assert(hit.y >= 0.45 && hit.y <= 0.85, `impact tip height on the rock (y=${hit.y.toFixed(3)})`);
  assert(hit.z <= -1.1 && hit.z >= -1.6, `impact tip reaches the front of the ore body (z=${hit.z.toFixed(3)})`);
  assert(hit.y >= 0.05, "the pick never buries below the ground at impact");

  // The swing settles back to the carry pose (no persistent transform, no residue).
  let action = MINING_SWING_DURATION;
  for (let f = 0; f < 200 && action > 0; f++) {
    farmer.animate(f / 60, 1 / 60, false, false, false, action, true, PICKAXE_ID, null);
    action = Math.max(0, action - 1 / 60);
  }
  farmer.animate(0, 1 / 60, false, false, false, 0, true, PICKAXE_ID, null);
  assert(Math.abs(farmer.limbs[3].rotation.x - MINING_HOLD_POSE.shoulderX) < 1e-6, "tool arm rests on the carry pose after the swing");
  assert(Math.abs(farmer.elbows[1].rotation.x - MINING_HOLD_POSE.elbowX) < 1e-6, "tool elbow rests on the carry pose after the swing");
  assert(Math.abs(farmer.body.rotation.x) < 1e-6, "torso returns to neutral after the swing");
  // A frame later the pose is identical (no drift).
  farmer.animate(1 / 60, 1 / 60, false, false, false, 0, true, PICKAXE_ID, null);
  assert(Math.abs(farmer.limbs[3].rotation.x - MINING_HOLD_POSE.shoulderX) < 1e-6, "no residual transform drift");

  // Other tools are not polluted: holding a hoe leaves the tool arm on the normal pose,
  // not on the pickaxe carry. Settle the walk residue first, then confirm the arm is down.
  for (let f = 0; f < 200; f++) farmer.animate(f / 60, 1 / 60, false, false, false, 0, true, "hoe", null);
  assert(Math.abs(farmer.limbs[3].rotation.x) < 0.02, "holding another tool leaves the arm on the neutral/locomotion pose");
  assert(Math.abs(farmer.limbs[3].rotation.x - MINING_HOLD_POSE.shoulderX) > 0.3, "the pickaxe carry does not leak into other tools");

  scene.dispose();
  engine.dispose();
}

verifyMiningMotion();
