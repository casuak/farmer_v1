import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  BOSS_BODY_RADIUS,
  BOSS_MAX_HEIGHT,
  BOSS_DEFEATED_FADE_SECONDS,
  BOSS_TELEGRAPH_Y,
  BOSS_HEAD_PIVOT,
  BOSS_LEG_PIVOTS,
  beachBossBoxes,
  telegraphLayout,
  telegraphCapsule,
  createBeachBossView,
  type BossVisualState,
} from "../components/game/beachBossView";
import type { BossTelegraph } from "../components/game/beachBoss";
import { SOUND_IDS, synthesizeSound } from "../components/game/audio";

const BOSS_SOUNDS = ["bossAlert", "bossWindup", "bossCharge", "bossImpact", "bossHurt", "bossDefeat", "playerHurt"] as const;

/** Same audio-safety envelope the existing verify-audio uses, applied to the new ids. */
function audioBounded(id: (typeof BOSS_SOUNDS)[number], rate: number, variant: number) {
  const samples = synthesizeSound(id, variant, rate);
  let peak = 0;
  let power = 0;
  for (const v of samples) {
    assert(Number.isFinite(v), `${id}: sample finite`);
    peak = Math.max(peak, Math.abs(v));
    power += v * v;
  }
  const rms = Math.sqrt(power / samples.length);
  assert(samples.length > rate * 0.04 && samples.length < rate, `${id}: short and bounded`);
  assert(peak < 0.24, `${id}: quiet, no harsh peak (peak=${peak.toFixed(3)})`);
  assert(rms > 0.003 && rms < 0.045, `${id}: audible but controlled (rms=${rms.toFixed(4)})`);
  assert(samples[0] === 0, `${id}: no click on attack`);
  assert(Math.abs(samples.at(-1)!) < 0.002, `${id}: fade avoids a click at the end`);
  return samples;
}

function sceneTest() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const light = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
  const shadow = new ShadowGenerator(1024, light, true);

  const model: BossVisualState = {
    position: { x: 22, z: -16 },
    yaw: 0,
    hp: 40,
    phase: "idle",
    phaseTime: 0,
    flash: 0,
    gait: 0,
    telegraph: null,
    alive: true,
  };
  const view = createBeachBossView(scene, shadow, model);

  // Node graph is present and pickable boss meshes carry the marker for the engine's mouse aim.
  assert.ok(view.root instanceof Object && view.body instanceof Object && view.head instanceof Object);
  assert.equal(view.legs.length, 4);
  assert.equal(view.flashMeshes.length, 1 + 1 + 4, "body + head + 4 legs are the flash target set");
  for (const mesh of view.flashMeshes) {
    assert.equal(mesh.isPickable, true);
    assert.equal((mesh.metadata as { boss?: boolean }).boss, true);
  }
  assert.ok(view.telegraphMesh instanceof Object);

  // Every phase runs without throwing and the telegraph toggles with the model.
  const telegraph: BossTelegraph = { start: { x: 22, z: -16 }, end: { x: 13, z: -16 }, width: 2.5, progress: 0.6 };
  const phases = ["idle", "alert", "chase", "windup", "charge", "recover", "stompWindup", "stomp", "return", "defeated"] as const;
  for (const phase of phases) {
    model.phase = phase;
    model.phaseTime = phase === "defeated" ? 0.4 : 0.5;
    model.gait = Math.sin(model.phaseTime * 3);
    model.telegraph = phase === "windup" || phase === "charge" ? telegraph : null;
    model.flash = phase === "charge" ? 0.12 : 0;
    view.update(model.phaseTime, 1 / 60, true, true);
    assert(Number.isFinite(view.root.position.x) && Number.isFinite(view.root.rotation.y));
    view.update(model.phaseTime, 0, true, true); // paused frame must not throw
  }

  // Telegraph is visible when the model supplies one, hidden otherwise.
  model.phase = "windup";
  model.telegraph = telegraph;
  view.update(1, 1 / 60, true, true);
  assert.equal(view.telegraphNode.isEnabled(), true, "telegraph enabled when present");
  assert(Math.abs(view.telegraphNode.position.y - BOSS_TELEGRAPH_Y) < 1e-9, `telegraph sits at world y ${BOSS_TELEGRAPH_Y}`);
  // Capsule: round caps of radius telegraph.width/2 at both ends match the swept-circle damage.
  for (const cap of [view.startCap, view.endCap, view.fillCap]) {
    assert.equal(cap.isEnabled(), true);
    assert(Math.abs(cap.scaling.x - telegraph.width) < 1e-6, "cap radius is telegraph.width/2 (diameter = width)");
    assert(Math.abs(cap.scaling.z - telegraph.width) < 1e-6, "cap is radially symmetric");
  }
  // The rounded caps must be the warm low-alpha fill (not a bright 0.9 border disc).
  assert.equal(view.startCap.material, view.endCap.material, "end caps share the fill material");
  assert.equal(view.fillCap.material, view.startCap.material, "fill cap shares the same material");
  assert((view.fillCap.material as { alpha: number }).alpha < 0.5, "caps are warm, low-alpha (not glaring)");
  // The base lane must already cover the WHOLE swept capsule from the start of the wind-up.
  assert(Math.abs(view.baseMesh.scaling.z - 9) < 1e-6, "base lane spans the full locked range");
  assert(Math.abs(view.baseMesh.position.z) < 1e-6, "base lane is centred on the capsule");
  assert((view.baseMesh.material as { alpha: number }).alpha < (view.fillMesh.material as { alpha: number }).alpha,
    "base lane is a lighter tint than the concentrated charge-up fill");
  // Side rails are inset by half their thickness so their outer edge stays within width/2.
  assert(Math.abs(view.rails[0].position.x) < telegraph.width / 2, "rails are inset inside the damage width");
  assert(Math.abs(view.rails[0].position.x + view.rails[1].position.x) < 1e-6, "rails symmetric around the lane");
  assert(Math.abs(view.startCap.position.z - (-9 / 2)) < 1e-6, "start cap sits on the boss centre");
  assert(Math.abs(view.endCap.position.z - (9 / 2)) < 1e-6, "end cap sits on the charge target");
  // Clamped fill: over-100% progress never overflows the lane (fill stays at the end).
  model.telegraph = { ...telegraph, progress: 2 };
  view.update(1.1, 1 / 60, true, true);
  assert(Math.abs(view.fillMesh.position.z) < 1e-6, "over-clamped progress keeps the fill centred/full");
  assert(Math.abs(view.fillCap.position.z - 9 / 2) < 1e-6, "fill front stops at the end cap");
  model.telegraph = null;
  view.update(2, 1 / 60, true, true);
  assert.equal(view.telegraphNode.isEnabled(), false, "telegraph hidden when absent");

  // Sign conventions: +X raises the forward (-Z) face, -X lowers it.
  model.phase = "alert";
  model.gait = 0;
  view.update(3, 1 / 60, true, true);
  assert(view.head.rotation.x > 0, "alert raises the head");
  model.phase = "windup";
  view.update(3, 1 / 60, true, true);
  assert(view.head.rotation.x < 0, "windup lowers the head (pawing)");
  model.phase = "charge";
  model.gait = 1.7;
  view.update(3, 1 / 60, true, true);
  assert(view.body.rotation.x < 0, "charge leans the front down, not up");
  assert(view.head.rotation.x <= 0, "charge keeps the head down");

  // Stop-blend: with a frozen gait (the boss stopped) the legs relax from mid-stride to neutral.
  model.phase = "idle";
  model.gait = 50; // frozen at a phase where sin(50)!=0 -> a leg would look stuck raised
  model.flash = 0;
  for (let f = 0; f < 200; f++) view.update(6 + f / 60, 1 / 60, true, true);
  assert(Math.abs(view.legs[0].rotation.x) < 0.05, "stopping relaxes the legs to neutral");

  // The model accumulates gait as a phase (radians); the view must oscillate it, not spin the legs.
  model.phase = "chase";
  model.gait = 97.3;
  for (let f = 0; f < 120; f++) {
    model.gait += 0.01; // keep the boss "moving" so the stride weight ramps to full
    view.update(3 + f / 60, 1 / 60, true, true);
  }
  for (const leg of view.legs) assert(Math.abs(leg.rotation.x) < 0.55, `leg swing stays bounded (${leg.rotation.x.toFixed(3)})`);
  model.gait = 0;

  // Reduced motion still runs the essential charge + telegraph without throwing.
  model.phase = "charge";
  model.telegraph = telegraph;
  model.gait = 0.9;
  view.update(3, 1 / 60, false, true);
  assert.equal(view.telegraphNode.isEnabled(), true, "telegraph survives reduced motion");

  model.phase="stompWindup";model.telegraph=null;model.stomp={center:{x:22,z:-16},radius:3.25,progress:.7};model.enraged=true;
  view.update(4,.016,true);assert(view.stompNode.isEnabled());assert.equal(view.stompFill.scaling.x,3.25);assert.equal(view.stompFill.scaling.z,3.25);assert(view.body.rotation.x>0);
  view.update(4,0,false);assert(view.stompNode.isEnabled(),"Stomp warning survives reduced motion");
  model.phase="stomp";model.phaseTime=.1;view.update(4,.016,true);assert(view.body.rotation.x<0);model.stomp=null;

  // The defeated boss fades over 1.5 s and is hidden shortly after, not instantly.
  model.phase = "defeated";
  model.phaseTime = 0;
  model.telegraph = null;
  model.flash = 0.24; // a killing hit leaves flash set; the corpse must not stay red
  view.update(4, 1 / 60, true, true);
  assert.equal(view.root.isEnabled(), true, "corpse still visible as it goes down");
  model.phaseTime = 0.3; // mid-fade
  view.update(4.5, 1 / 60, true, true);
  for (const mesh of view.flashMeshes) {
    assert.equal((mesh.material as { name: string }).name, "beach-boss-skin", "defeated corpse drops the hurt-red material");
    assert.equal(mesh.useVertexColors, true, "defeated corpse restores vertex colours");
    assert(mesh.visibility > 0 && mesh.visibility < 1, "corpse is mid-fade");
  }
  model.phaseTime = BOSS_DEFEATED_FADE_SECONDS + 0.2;
  view.update(5, 1 / 60, true, true);
  assert.equal(view.root.isEnabled(), false, "corpse fully gone after the fade window");

  // contact shadow follows the shadows toggle via the update() call (validated above);
  // confirm the boss graph is non-trivial.
  const children = view.root.getChildTransformNodes();
  assert.ok(children.length > 0, "boss has child transforms");

  scene.dispose();
  engine.dispose();
}

function multiFrameCharge() {
  // Drive many charge frames to prove the pooled dust/rings never grow the scene.
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const light = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
  const shadow = new ShadowGenerator(1024, light, true);
  const model: BossVisualState = {
    position: { x: 22, z: -16 }, yaw: 0, hp: 40, phase: "charge", phaseTime: 0, flash: 0, gait: 1, telegraph: null, alive: true,
  };
  const view = createBeachBossView(scene, shadow, model);
  const before = scene.meshes.length;
  model.telegraph = { start: { x: 22, z: -16 }, end: { x: 13, z: -16 }, width: 2.5, progress: 1 };
  let gait = 0;
  for (let f = 0; f < 240; f++) {
    gait += 1 / 60 * 3.6; // match the model's charge gait accumulation
    model.gait = gait;
    view.update(f / 60, 1 / 60, true, true);
    for (const leg of view.legs) assert(Math.abs(leg.rotation.x) < 0.95, "charge gallop stays bounded");
  }
  assert.equal(scene.meshes.length, before, "pooled particles do not add meshes");
  model.flash = 0.2; // one hurt -> one ring
  view.update(4, 1 / 60, true, true);
  assert.equal(scene.meshes.length, before, "impact ring comes from the fixed pool");
  scene.dispose();
  engine.dispose();
}

export function verifyBeachBossView() {
  // --- model envelope is within the gameplay circle and the height cap ---
  const boxes = beachBossBoxes();
  assert.ok(boxes.length >= 30, `the boss is built from a chunky set of voxels (${boxes.length})`);
  let maxRadius = 0;
  let maxTop = -Infinity;
  let minBottom = Infinity;
  let frontMost = Infinity;
  for (const [x, y, z, w, h, d] of boxes) {
    const corner = Math.hypot(Math.abs(x) + w / 2, Math.abs(z) + d / 2);
    maxRadius = Math.max(maxRadius, corner);
    maxTop = Math.max(maxTop, y + h / 2);
    minBottom = Math.min(minBottom, y - h / 2);
    frontMost = Math.min(frontMost, z - d / 2);
  }
  assert(maxRadius <= BOSS_BODY_RADIUS + 1e-9, `horizontal envelope stays inside the ${BOSS_BODY_RADIUS} body circle (max=${maxRadius.toFixed(3)})`);
  assert(maxTop <= BOSS_MAX_HEIGHT + 1e-9, `top stays at or below ${BOSS_MAX_HEIGHT} m (top=${maxTop.toFixed(3)})`);
  assert(minBottom >= -0.05, `hooves rest on the ground, not buried (bottom=${minBottom.toFixed(3)})`);
  assert(frontMost <= -1.3, `the horn reaches forward (front-most=${frontMost.toFixed(3)})`);
  assert.equal(BOSS_LEG_PIVOTS.length, 4, "four legs");
  assert.equal(BOSS_HEAD_PIVOT.z, -0.85, "head sits at the front");

  // --- telegraph layout math ---
  const t: BossTelegraph = { start: { x: 22, z: -16 }, end: { x: 13, z: -16 }, width: 2.5, progress: 0.6 };
  const l = telegraphLayout(t);
  assert.ok(Number.isFinite(l.angle));
  assert(Math.abs(Math.hypot(l.center.x - 17.5, l.center.z - (-16))) < 1e-9, "center is the midpoint");
  assert(Math.abs(l.length - 9) < 1e-9, "length is the locked path length");
  assert(Math.abs(l.fillLength - 0.6 * 9) < 1e-9, "fill grows with windup progress");
  assert(l.fillLength <= l.length, "fill never exceeds the locked path");
  assert(l.width === 2.5);
  const full = telegraphLayout({ ...t, progress: 2 });
  assert(full.fillLength === l.length, "progress is clamped to length");
  assert(full.width > 0);

  // Damage is a swept circle of radius width/2 along the segment -> displayed as a capsule.
  const capsule = telegraphCapsule(t);
  assert.equal(capsule.radius, 1.25, "capsule radius is telegraph.width/2");
  assert(Math.abs(capsule.length - 9) < 1e-9, "capsule axis is the locked centre path");
  assert(Math.abs(capsule.totalLength - (9 + 2 * 1.25)) < 1e-9, "capsule extends radius beyond each centre");
  assert(Math.abs(capsule.capStart.x - (22 + 1.25)) < 1e-9, "origin cap extends behind the boss centre");
  assert(Math.abs(capsule.capEnd.x - (13 - 1.25)) < 1e-9, "target cap extends past the charge target");
  assert.equal(capsule.axis.x, -1, "axis points toward the end");

  // --- the Babylon view builds and animates on a NullEngine ---
  sceneTest();
  multiFrameCharge();

  // --- the seven boss sounds are registered and synthesize safely ---
  for (const id of BOSS_SOUNDS) assert(SOUND_IDS.includes(id), `${id} is a registered sound id`);
  assert.equal(new Set(BOSS_SOUNDS).size, 7, "boss ids are distinct");
  const signatures = new Set<string>();
  for (const id of BOSS_SOUNDS) {
    for (const rate of [44100, 48000]) {
      audioBounded(id, rate, 0);
      audioBounded(id, rate, 1);
      audioBounded(id, rate, 2);
      signatures.add(`${id}:${rate}:${synthesizeSound(id, 0, rate).length}`);
    }
  }
  assert.equal(signatures.size, BOSS_SOUNDS.length * 2, "each sound synthesizes at both sample rates");

  console.log(
    "Beach-boss regression passed: original voxel silhouette inside the 1.65 body circle and under 2.4 m, forward horn, " +
    "four legs, telegraph saturated-orange capsule on a full-range base lane (caps of width/2 matching the swept-circle " +
    "damage), all phases animate on a NullEngine, fixed pooled dust/rings, defeated fades over 1.5 s, telegraph survives " +
    "reduced motion, boss aim metadata, and seven bounded procedural sounds.",
  );
}

verifyBeachBossView();
