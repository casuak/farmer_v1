import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Voxels, voxelMaterial } from "./voxel";
import type { Point } from "./farming";
import { BOSS,type BossPhase,type BossTelegraph,type BossStomp } from "./beachBoss";

/**
 * Beach-boss presentation. Consumes the gameplay model as a structural type
 * (position/yaw/hp/phase/phaseTime/flash/gait/telegraph/alive). State animation is
 * driven by phaseTime/gait/time; decorative oscillation is gated by `motion` while the
 * essential charge pose + telegraph always stay.
 */

/** The read-only slice of BeachBossModel this view needs. */
export type BossVisualState = {
  position: Point;
  yaw: number;
  hp: number;
  phase: BossPhase;
  phaseTime: number;
  flash: number;
  gait: number;
  telegraph: BossTelegraph | null;
  stomp?:BossStomp|null;
  enraged?:boolean;
  /** Optional; `false` only while defeated. The view keeps the corpse visible while fading. */
  alive?: boolean;
};

export const BOSS_BODY_RADIUS = 1.65;
export const BOSS_MAX_HEIGHT = 2.4;
export const BOSS_DEFEATED_FADE_SECONDS = 1.5;
export const BOSS_TELEGRAPH_Y = 0.06;

/** Pure geometry layout of the ground telegraph rectangle, testable without Babylon. */
export function telegraphLayout(t: BossTelegraph) {
  const dx = t.end.x - t.start.x;
  const dz = t.end.z - t.start.z;
  const length = Math.hypot(dx, dz) || 1;
  const angle = Math.atan2(dx / length, dz / length);
  const fillLength = Math.max(0, Math.min(length, t.progress * length));
  const center = { x: (t.start.x + t.end.x) / 2, z: (t.start.z + t.end.z) / 2 };
  return { length, angle, fillLength, center, width: t.width };
}

/**
 * Charge damage is a swept circle of radius width/2 along the start->end segment (the
 * boss centre path). The visual is a capsule: the rectangle (width x length) PLUS caps of
 * radius width/2 at both ends. Returned as pure data so the verify can assert the
 * displayed area and the hit box agree.
 */
export function telegraphCapsule(t: BossTelegraph) {
  const dx = t.end.x - t.start.x;
  const dz = t.end.z - t.start.z;
  const length = Math.hypot(dx, dz) || 1;
  const radius = t.width / 2;
  const axis = { x: dx / length, z: dz / length };
  // Capsule extends radius beyond each centre along the axis.
  return {
    length,
    radius,
    axis,
    capStart: { x: t.start.x - axis.x * radius, z: t.start.z - axis.z * radius },
    capEnd: { x: t.end.x + axis.x * radius, z: t.end.z + axis.z * radius },
    totalLength: length + radius * 2,
  };
}

// ---------------------------------------------------------------------------
// Geometry (root-local coordinates; the head/leg boxes are relative to their pivot
// so the rig can rotate them). Envelope stays inside the 1.65 body circle and the
// top stays at ~2.4 m. Forward = local -Z (driver yaw convention).
// ---------------------------------------------------------------------------
type Box = [number, number, number, number, number, number, string];

export const BOSS_HEAD_PIVOT = { x: 0, y: 1.08, z: -0.85 };

const HEAD_BOXES: Box[] = [
  // skull, snout and lower jaw form the chunky front.
  [0, 0.08, -0.18, 0.85, 0.80, 0.66, "#86a099"],
  [0, -0.08, -0.44, 0.60, 0.50, 0.40, "#7d968f"],
  [0, -0.20, -0.30, 0.50, 0.26, 0.50, "#74887f"],
  // Ivory horns: long forward tusk (tip ~z -1.59, radius 1.59) + small rear horn.
  [0, 0.04, -0.56, 0.26, 0.30, 0.22, "#e9e3d2"],
  [0, 0.22, -0.66, 0.16, 0.26, 0.16, "#e9e3d2"],
  [0, -0.02, -0.50, 0.14, 0.12, 0.12, "#ded6c0"],
  // Ears with a warm inner flap.
  [-0.30, 0.52, 0.05, 0.22, 0.26, 0.16, "#8ba0a0"],
  [0.30, 0.52, 0.05, 0.22, 0.26, 0.16, "#8ba0a0"],
  [-0.30, 0.50, -0.02, 0.12, 0.15, 0.06, "#d8a99c"],
  [0.30, 0.50, -0.02, 0.12, 0.15, 0.06, "#d8a99c"],
  // Eyes with a faint amber iris.
  [-0.44, 0.30, -0.30, 0.09, 0.11, 0.08, "#2c3430"],
  [0.44, 0.30, -0.30, 0.09, 0.11, 0.08, "#2c3430"],
  [-0.44, 0.31, -0.345, 0.05, 0.05, 0.03, "#d8a35c"],
  [0.44, 0.31, -0.345, 0.05, 0.05, 0.03, "#d8a35c"],
];

const BODY_BOXES: Box[] = [
  // Grey-cyan hide: belly, back, rump.
  [0, 0.92, 0.05, 1.45, 0.62, 2.00, "#9bb0aa"],
  [0, 1.38, -0.05, 1.50, 0.62, 1.80, "#7d948e"],
  [0, 1.06, 0.92, 1.35, 0.70, 0.62, "#88a09b"],
  // Sand-brown armored shoulder hump (the tall silhouette) and a pale top plate.
  [0, 1.92, -0.18, 1.05, 0.62, 1.05, "#b09a78"],
  [0, 2.26, -0.15, 0.72, 0.12, 0.78, "#c4b28f"],
  // Side and rear armor plates.
  [-0.80, 1.30, -0.35, 0.20, 0.90, 1.05, "#6f857c"],
  [0.80, 1.30, -0.35, 0.20, 0.90, 1.05, "#6f857c"],
  [-0.74, 1.02, 0.72, 0.18, 0.70, 0.52, "#7c948e"],
  [0.74, 1.02, 0.72, 0.18, 0.70, 0.52, "#7c948e"],
  // Chest plate, neck and a short tail.
  [0, 0.80, -0.72, 1.05, 0.45, 0.50, "#8ba29e"],
  [0, 1.14, -0.66, 0.78, 0.62, 0.44, "#8ea6a0"],
  [0, 1.20, 1.24, 0.20, 0.30, 0.30, "#6f857c"],
  // Beach shells scattered on the armor as decoration.
  [0.42, 2.18, 0.05, 0.20, 0.16, 0.18, "#f1d9c8"],
  [-0.38, 2.20, -0.22, 0.16, 0.13, 0.15, "#e6c1b0"],
  [0.62, 1.62, -0.30, 0.14, 0.12, 0.14, "#e0c0a8"],
  [-0.68, 1.44, 0.20, 0.13, 0.11, 0.13, "#e8cdbf"],
  [0.16, 1.02, 0.62, 0.14, 0.12, 0.16, "#e8cdbf"],
];

export const BOSS_LEG_PIVOTS: { x: number; y: number; z: number }[] = [
  { x: -0.5, y: 0.72, z: -0.45 },
  { x: 0.5, y: 0.72, z: -0.45 },
  { x: -0.5, y: 0.75, z: 0.62 },
  { x: 0.5, y: 0.75, z: 0.62 },
];

// Leg boxes are authored relative to each leg pivot (hangs straight down).
const LEG_BOXES: Box[] = [
  [0, -0.16, 0, 0.36, 0.42, 0.42, "#6f857c"],
  [0, -0.50, -0.02, 0.32, 0.26, 0.36, "#5f746c"],
  [0, -0.64, -0.05, 0.34, 0.16, 0.40, "#4f5f56"],
];

/** All boxes re-based to root-local coordinates, for envelope verification. */
export function beachBossBoxes(): Box[] {
  const out: Box[] = [];
  const push = (b: Box) => out.push(b);
  for (const b of BODY_BOXES) push(b);
  for (const [x, y, z, w, h, d, c] of HEAD_BOXES)
    push([x + BOSS_HEAD_PIVOT.x, y + BOSS_HEAD_PIVOT.y, z + BOSS_HEAD_PIVOT.z, w, h, d, c]);
  for (const pivot of BOSS_LEG_PIVOTS)
    for (const [x, y, z, w, h, d, c] of LEG_BOXES)
      push([x + pivot.x, y + pivot.y, z + pivot.z, w, h, d, c]);
  return out;
}

const easeOutCubic = (t: number) => {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - Math.pow(1 - u, 3);
};
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// View construction
// ---------------------------------------------------------------------------
export function createBeachBossView(scene: Scene, shadow: ShadowGenerator, model: BossVisualState) {
  const skin = voxelMaterial(scene, "beach-boss-skin");
  skin.specularColor = Color3.FromHexString("#9fb4ac");
  skin.specularPower = 44;

  const hitMat = new StandardMaterial("beach-boss-hit-red", scene);
  hitMat.disableLighting = true;
  hitMat.emissiveColor = Color3.FromHexString("#ff5a4a");

  const root = new TransformNode("beach-boss", scene);
  const body = new TransformNode("beach-boss-body", scene);
  body.parent = root;
  const head = new TransformNode("beach-boss-head", scene);
  head.parent = body;
  head.position.set(BOSS_HEAD_PIVOT.x, BOSS_HEAD_PIVOT.y, BOSS_HEAD_PIVOT.z);

  const buildVox = (boxes: Box[]) => {
    const v = new Voxels();
    for (const [x, y, z, w, h, d, c] of boxes) v.box(x, y, z, w, h, d, c);
    return v;
  };

  const bodyMesh = buildVox(BODY_BOXES).build("beach-boss-body-mesh", scene, skin);
  bodyMesh.parent = body;
  shadow.addShadowCaster(bodyMesh);

  const headMesh = buildVox(HEAD_BOXES).build("beach-boss-head-mesh", scene, skin);
  headMesh.parent = head;
  shadow.addShadowCaster(headMesh);

  const legs: TransformNode[] = [];
  const flashMeshes: Mesh[] = [bodyMesh, headMesh];
  for (let i = 0; i < BOSS_LEG_PIVOTS.length; i++) {
    const pivot = BOSS_LEG_PIVOTS[i];
    const leg = new TransformNode(`beach-boss-leg-${i}`, scene);
    leg.parent = body;
    leg.position.set(pivot.x, pivot.y, pivot.z);
    const mesh = buildVox(LEG_BOXES).build(`beach-boss-leg-mesh-${i}`, scene, skin);
    mesh.parent = leg;
    shadow.addShadowCaster(mesh);
    legs.push(leg);
    flashMeshes.push(mesh);
  }
  for (const m of flashMeshes) {
    m.isPickable = true;
    m.metadata = { boss: true };
  }

  // --- soft contact shadow (toggles with the `shadows` setting) ---
  const SHADOW_TEX = 64;
  const shPix = new Uint8Array(SHADOW_TEX * SHADOW_TEX * 4);
  for (let y = 0; y < SHADOW_TEX; y++)
    for (let x = 0; x < SHADOW_TEX; x++) {
      const r = Math.hypot((x + 0.5) / SHADOW_TEX * 2 - 1, (y + 0.5) / SHADOW_TEX * 2 - 1);
      const edge = Math.max(0, 1 - r * r);
      const i = (y * SHADOW_TEX + x) * 4;
      shPix[i] = shPix[i + 1] = shPix[i + 2] = 255;
      shPix[i + 3] = Math.round(edge * edge * 255);
    }
  const shTexture = RawTexture.CreateRGBATexture(shPix, SHADOW_TEX, SHADOW_TEX, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  shTexture.name = "beach-boss-soft-contact";
  shTexture.hasAlpha = true;
  shTexture.wrapU = shTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
  const shMat = new StandardMaterial("beach-boss-contact", scene);
  shMat.diffuseTexture = shTexture;
  shMat.useAlphaFromDiffuseTexture = true;
  shMat.diffuseColor = Color3.Black();
  shMat.emissiveColor = Color3.FromHexString("#3a4636");
  shMat.specularColor = Color3.Black();
  shMat.disableLighting = true;
  shMat.backFaceCulling = true;
  const contactShadow = MeshBuilder.CreateGround("beach-boss-shadow", { width: 1, height: 1 }, scene);
  contactShadow.material = shMat;
  contactShadow.isPickable = false;
  contactShadow.position.y = 0.03;
  contactShadow.scaling.set(3.2, 1, 3.6);

  // --- telegraph: ground rectangle fill + bright border + end arrow ---
  const telegraphMat = (name: string, hex: string, alpha: number) => {
    const m = new StandardMaterial(name, scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.FromHexString(hex);
    m.alpha = alpha;
    return m;
  };
  // Saturated orange/red-orange so the lane reads on pale sand (not pale-yellow/white).
  const baseMat = telegraphMat("beach-boss-telegraph-base", "#e86830", 0.15); // light full-range lane
  const fillMat = telegraphMat("beach-boss-telegraph-fill", "#e86830", 0.32); // concentrated charge-up
  const borderMat = telegraphMat("beach-boss-telegraph-border", "#d9612e", 0.9);
  const arrowMat = telegraphMat("beach-boss-telegraph-arrow", "#ff9b47", 0.95);

  const stompNode=new TransformNode("beach-boss-stomp-warning",scene);
  const stompMat=telegraphMat("beach-boss-stomp-fill","#dd7042",.19);
  const stompFill=MeshBuilder.CreateCylinder("beach-boss-stomp-disc",{diameter:2,height:.018,tessellation:64},scene);stompFill.parent=stompNode;stompFill.material=stompMat;stompFill.isPickable=false;
  const stompEdge=MeshBuilder.CreateTorus("beach-boss-stomp-edge",{diameter:2,thickness:.04,tessellation:64},scene);stompEdge.parent=stompNode;stompEdge.material=borderMat;stompEdge.isPickable=false;
  const stompCharge=stompFill.clone("beach-boss-stomp-charge")!;stompCharge.parent=stompNode;stompCharge.position.y=.018;stompCharge.material=fillMat;
  const telegraphNode = new TransformNode("beach-boss-telegraph", scene);
  // Arrow triangles are single-sided by winding; render them from above regardless.
  arrowMat.backFaceCulling = false;

  const makeCap = (name: string, material: StandardMaterial, y: number) => {
    // A flat disc whose radius is telegraph.width/2: cylinder diameter 1 scaled by width.
    const disc = MeshBuilder.CreateCylinder(name, { diameter: 1, height: 0.02, tessellation: 28 }, scene);
    disc.material = material;
    disc.isPickable = false;
    disc.parent = telegraphNode;
    disc.position.y = y;
    return disc;
  };

  // Bottom lane: the WHOLE swept capsule (rect body) is shown light from the start of the
  // wind-up, so the full damage range is tinted immediately (not only the caps + rails).
  const baseMesh = MeshBuilder.CreateGround("beach-boss-telegraph-base-mesh", { width: 1, height: 1 }, scene);
  baseMesh.material = baseMat;
  baseMesh.isPickable = false;
  baseMesh.parent = telegraphNode;

  // Concentrated charge-up fill (grows with windup progress) on top of the base lane.
  const fillMesh = MeshBuilder.CreateGround("beach-boss-telegraph-fill-mesh", { width: 1, height: 1 }, scene);
  fillMesh.material = fillMat;
  fillMesh.isPickable = false;
  fillMesh.parent = telegraphNode;
  fillMesh.position.y = 0.02;

  // Rounded leading edge of the growing fill.
  const fillCap = makeCap("beach-boss-telegraph-fill-cap", fillMat, 0.015);

  // Capsule caps (radius width/2) at the origin and target: warm orange, low alpha but visible.
  const startCap = makeCap("beach-boss-telegraph-start-cap", fillMat, 0.02);
  const endCap = makeCap("beach-boss-telegraph-end-cap", fillMat, 0.025);

  const BORDER_T = 0.16;
  const BORDER_H = 0.05;
  const rails = [-1, 1].map((side) => {
    const rail = MeshBuilder.CreateBox(`beach-boss-telegraph-rail-${side}`, { width: BORDER_T, height: BORDER_H, depth: 1 }, scene);
    rail.material = borderMat;
    rail.isPickable = false;
    rail.parent = telegraphNode;
    rail.position.y = 0.03;
    return rail;
  });

  // Flat triangle arrowhead (points +Z) appended to the telegraph group.
  const arrow = new Mesh("beach-boss-telegraph-arrow-mesh", scene);
  const arrowData = new VertexData();
  arrowData.positions = [0, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, -0.5];
  arrowData.indices = [0, 2, 1];
  arrowData.applyToMesh(arrow);
  arrow.material = arrowMat;
  arrow.isPickable = false;
  arrow.parent = telegraphNode;
  arrow.position.y = 0.05;

  // --- pooled sand dust + impact rings (created once, never per frame) ---
  const sandMat = voxelMaterial(scene, "beach-boss-sand");
  sandMat.diffuseColor = Color3.FromHexString("#d9c489");
  sandMat.alpha = 0.5;
  const sandPool = Array.from({ length: 16 }, (_, i) => {
    const mesh = MeshBuilder.CreateBox(`beach-boss-dust-${i}`, { size: 1 }, scene);
    mesh.material = sandMat;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    return { mesh, life: 0, total: 0, vx: 0, vy: 0, vz: 0 };
  });
  let nextSand = 0;

  const ringMat = new StandardMaterial("beach-boss-impact-ring", scene);
  ringMat.disableLighting = true;
  ringMat.emissiveColor = Color3.FromHexString("#ffd9a0");
  ringMat.alpha = 0.55;
  const ringPool = Array.from({ length: 6 }, (_, i) => {
    const mesh = MeshBuilder.CreateTorus(`beach-boss-ring-${i}`, { diameter: 1, thickness: 0.05, tessellation: 32 }, scene);
    mesh.material = ringMat;
    mesh.isPickable = false;
    mesh.position.y = 0.05;
    mesh.setEnabled(false);
    return { mesh, life: 0, total: 0 };
  });
  let nextRing = 0;

  let sandBallast = 0;
  let prevFlash = 0;
  let prevGait = 0;
  let legWeight = 0;

  function spawnSand(scatter: number) {
    const b = sandPool[nextSand++ % sandPool.length];
    b.total = b.life = 0.5 + Math.random() * 0.25;
    const a = Math.random() * Math.PI * 2;
    b.mesh.position.set(model.position.x + Math.cos(a) * scatter, 0.06, model.position.z + Math.sin(a) * scatter);
    b.vx = Math.cos(a) * (0.6 + Math.random() * 0.9);
    b.vz = Math.sin(a) * (0.6 + Math.random() * 0.9);
    b.vy = 0.8 + Math.random() * 1.2;
    b.mesh.scaling.setAll(0.11 + Math.random() * 0.16);
    b.mesh.visibility = 0.85;
    b.mesh.setEnabled(true);
  }

  function spawnRing() {
    const r = ringPool[nextRing++ % ringPool.length];
    r.total = r.life = 0.55;
    r.mesh.position.set(model.position.x, 0.05, model.position.z);
    r.mesh.scaling.setAll(0.6);
    r.mesh.visibility = 0.9;
    r.mesh.setEnabled(true);
  }

  function advanceParticles(dt: number) {
    for (const b of sandPool) {
      if (b.life <= 0) continue;
      b.life = Math.max(0, b.life - dt);
      b.vy -= dt * 3.2;
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.z += b.vz * dt;
      b.mesh.position.y += b.vy * dt;
      if (b.mesh.position.y < 0.06) {
        b.mesh.position.y = 0.06;
        b.vy = Math.abs(b.vy) * 0.3;
        b.vx *= 0.7;
        b.vz *= 0.7;
      }
      b.mesh.visibility = Math.min(1, b.life / b.total);
      if (b.life === 0) b.mesh.setEnabled(false);
    }
    for (const r of ringPool) {
      if (r.life <= 0) continue;
      r.life = Math.max(0, r.life - dt);
      const t = 1 - r.life / r.total;
      r.mesh.scaling.setAll(0.6 + t * 4.6);
      r.mesh.visibility = Math.max(0, 0.9 * (1 - t));
      if (r.life === 0) r.mesh.setEnabled(false);
    }
  }

  // --- pose helpers ---
  // `g` is the model's accumulating gait phase (radians) -> oscillate for a -1..1 swing.
  // `weight` fades the stride to 0 when the boss stops, so a leg never stays stuck raised.
  const applyWalk = (g: number, m: number, weight = 1) => {
    const swing = Math.sin(g) * weight;
    legs[0].rotation.x = swing * 0.5;
    legs[3].rotation.x = swing * 0.5;
    legs[1].rotation.x = -swing * 0.5;
    legs[2].rotation.x = -swing * 0.5;
    body.rotation.z = swing * 0.05 * m;
    body.rotation.x = -0.05 * m; // lean forward (front, local -Z, dips down)
  };

  function updateTelegraph() {
    const t = model.telegraph;
    if (!t) {
      telegraphNode.setEnabled(false);
      return;
    }
    const layout = telegraphLayout(t);
    telegraphNode.setEnabled(true);
    telegraphNode.position.set(layout.center.x, BOSS_TELEGRAPH_Y, layout.center.z);
    telegraphNode.rotation.y = layout.angle;
    const width = Math.max(0.05, layout.width);
    // Base lane: the full swept capsule body (width x length) is always tinted light,
    // so the entire damage range is visible from the very start of the wind-up.
    baseMesh.scaling.x = width;
    baseMesh.scaling.z = layout.length;
    baseMesh.position.z = 0;
    // Concentrated charge-up fill from the boss (start, local z = -length/2) toward the end.
    // fillLength is already clamped to [0, length], so the fill never overflows the lane.
    fillMesh.scaling.x = width;
    fillMesh.scaling.z = layout.fillLength;
    fillMesh.position.z = layout.fillLength / 2 - layout.length / 2;
    // Rounded leading edge of the fill follows the (clamped) charge front.
    fillCap.scaling.set(width, 1, width);
    fillCap.position.z = -layout.length / 2 + layout.fillLength;
    // Capsule caps of radius width/2 at both centres; the sides run the whole length.
    startCap.scaling.set(width, 1, width);
    startCap.position.z = -layout.length / 2;
    endCap.scaling.set(width, 1, width);
    endCap.position.z = layout.length / 2;
    // Side rails sit inset by half their thickness so their outer edge lands on the
    // damage boundary (width/2), never beyond it.
    const inset = BORDER_T / 2;
    rails[0].position.x = -(width / 2 - inset);
    rails[1].position.x = width / 2 - inset;
    rails[0].scaling.z = layout.length;
    rails[1].scaling.z = layout.length;
    arrow.position.z = layout.length / 2 - width * 0.5;
    arrow.scaling.set(width, 1, width);
    const charging = model.phase === "charge";
    baseMat.alpha = charging ? 0.10 : 0.15;
    fillMat.alpha = charging ? 0.18 : 0.32;
    borderMat.alpha = charging ? 0.55 : 0.9;
    arrowMat.alpha = charging ? 0.6 : 0.95;
  }

  function update(time: number, dt: number, motion: boolean, shadows = true) {
    const { position, yaw, phase, phaseTime, flash, gait } = model;
    const pt = Math.max(0, phaseTime);
    const g = gait || 0;
    const m = motion ? 1 : 0;
    const defeated = phase === "defeated";
    // Deciding "moving": the model accumulates gait only while it actually travels.
    const gaitDelta = Math.abs(g - prevGait);
    prevGait = g;

    if (dt > 0) advanceParticles(dt); // paused (dt 0) freezes every effect timer

    root.position.set(position.x, 0, position.z);
    root.rotation.y = yaw;

    // Impact ring when a fresh hurt raises the flash (a new hit, not the decay).
    if (!defeated && flash > prevFlash) spawnRing();
    prevFlash = flash;

    // Reset dynamic transforms each frame so phases never accumulate residue.
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    body.scaling.set(1, 1, 1);
    head.position.set(BOSS_HEAD_PIVOT.x, BOSS_HEAD_PIVOT.y, BOSS_HEAD_PIVOT.z);
    head.rotation.set(0, 0, 0);
    for (const l of legs) l.rotation.set(0, 0, 0);

    // Walk blend: ease the stride weight toward 1 while moving, 0 when the boss stops
    // (so the last planted pose relaxes back to neutral instead of staying mid-stride).
    if (dt > 0) legWeight += ((gaitDelta > 1e-4 ? 1 : 0) - legWeight) * (1 - Math.exp(-8 * dt));

    if (defeated) {
      // Tip over sideways, then fade the corpse away over BOSS_DEFEATED_FADE_SECONDS.
      const fall = easeOutCubic(pt / 0.6);
      body.rotation.z = fall * 1.35;
      body.position.y = -fall * 0.10;
      head.rotation.x = -0.22 * fall;
      const vis = clamp(1 - pt / BOSS_DEFEATED_FADE_SECONDS, 0, 1);
      for (const mesh of flashMeshes) {
        mesh.material = skin; // the corpse never keeps the hurt-red material
        mesh.useVertexColors = true;
        mesh.visibility = vis;
      }
      root.setEnabled(pt < BOSS_DEFEATED_FADE_SECONDS + 0.1);
    } else if (phase === "alert") {
      // Head thrown up in a bellow; chest puffs on the roar swell.
      const roar = m * Math.sin(pt * 9) * 0.06;
      head.rotation.x = 0.5 + roar;
      body.position.y = m * Math.max(0, Math.sin(pt * 3.2)) * 0.04;
      body.scaling.x = body.scaling.z = 1 + m * Math.max(0, Math.sin(pt * 3.2)) * 0.03;
      body.rotation.x = -0.06 * m;
      root.setEnabled(true);
    } else if (phase === "windup") {
      // Lower the head (negative X dips the forward -Z face down) and paw the ground.
      head.rotation.x = -0.42;
      const paw = m * Math.sin(pt * 16) * 0.28;
      legs[0].rotation.x = paw - 0.10;
      legs[1].rotation.x = -paw - 0.10;
      body.position.z = 0.08;
      body.position.y = -0.03;
      body.rotation.x = -0.10;
      root.setEnabled(true);
    } else if (phase === "charge") {
      // Four-beat gallop + a nose-down lunge (negative X dips the forward -Z face, never
      // rears it up). Magnitude kept small so the front hooves only skim the sand.
      const amp = motion ? 1 : 0.85;
      const stride = Math.sin(g) * 0.9 * Math.max(legWeight, 0.35);
      legs[0].rotation.x = stride * amp;
      legs[3].rotation.x = stride * amp;
      legs[1].rotation.x = -stride * amp;
      legs[2].rotation.x = -stride * amp;
      body.position.y = -0.02;
      body.rotation.x = -0.08 * amp;
      head.rotation.x = -0.08;
      head.position.z = BOSS_HEAD_PIVOT.z - 0.05;
      root.setEnabled(true);
    } else if(phase==="stompWindup"){
      const u=Math.min(1,pt/BOSS.stompWindup);body.rotation.x=.18*u;body.position.y=.13*u;
      legs[0].rotation.x=legs[1].rotation.x=-.6*u;head.rotation.x=.3*u;root.setEnabled(true);
    } else if(phase==="stomp"){
      const weight=Math.max(0,1-pt/.26);body.position.y=-.07*weight;body.rotation.x=-.1*weight;head.rotation.x=-.25*weight;root.setEnabled(true);
    } else if (phase === "recover") {
      // Pant and rebound after the charge.
      const puff = m * Math.abs(Math.sin(pt * 8)) * 0.05;
      body.position.y = puff;
      body.rotation.x = -0.03 + m * Math.sin(pt * 8) * 0.03;
      body.rotation.z = m * Math.sin(pt * 3) * 0.03;
      head.rotation.x = -0.15 + m * Math.sin(pt * 7) * 0.05;
      root.setEnabled(true);
    } else {
      // idle / chase / return: heavy locomotive steps; idle breathes when gait ~ 0.
      const heavy = phase === "chase" ? 0.05 : phase === "return" ? 0.04 : 0.02;
      const breathing = 0.02 * Math.sin(time * 2.0) * m;
      const swing = Math.sin(g) * legWeight;
      body.scaling.y = 1 + breathing;
      body.scaling.x = body.scaling.z = 1 - breathing * 0.4;
      body.position.y = m * Math.abs(swing) * heavy;
      applyWalk(g, m, legWeight);
      head.rotation.x = 0.08 * m;
      root.setEnabled(true);
    }

    // Hurt red flash: only while alive and actually flashing; the defeated corpse stays skin.
    if (!defeated) {
      const flashOn = flash > 0;
      for (const mesh of flashMeshes) {
        mesh.material = flashOn ? hitMat : skin;
        mesh.useVertexColors = !flashOn;
        mesh.visibility = 1;
      }
    }

    // Sand dust during charge (essential visual) and during the paw; windup dust is motion-gated.
    if (dt > 0) {
      sandBallast -= dt;
      if (phase === "charge" && sandBallast <= 0) {
        sandBallast = motion ? 0.05 : 0.11;
        spawnSand(0.4 + Math.random() * 0.5);
      } else if (phase === "windup" && motion && sandBallast <= 0) {
        sandBallast = 0.14;
        spawnSand(0.5);
      }
    }

    skin.emissiveColor.set(model.enraged?.11:0,model.enraged?.024:0,0);
    const area=model.stomp;stompNode.setEnabled(!!area&&!defeated);
    if(area){
      const radius=area.radius;stompNode.position.set(area.center.x,BOSS_TELEGRAPH_Y,area.center.z);
      stompFill.scaling.set(radius,1,radius);stompEdge.scaling.set(radius/1.02,1,radius/1.02);
      const growth=phase==="stomp"?radius:radius*Math.max(.015,area.progress);stompCharge.scaling.set(growth,1,growth);
      stompNode.getChildMeshes().forEach(mesh=>mesh.visibility=phase==="stomp"?Math.max(0,1-pt/.40):1);
    }
    updateTelegraph();
    contactShadow.setEnabled(shadows && !defeated);
    contactShadow.position.set(position.x, 0.03, position.z);
    const breathe = 1 + (motion ? Math.sin(time * 2) * 0.03 : 0);
    contactShadow.scaling.x = 3.2 * breathe;
    contactShadow.scaling.z = 3.6 * breathe;
  }

  // First frame: place the boss at its home and switch the telegraph off.
  update(0, 0, true);
  telegraphNode.setEnabled(false);

  return {
    update,
    root,
    body,
    head,
    legs,
    telegraphMesh: telegraphNode,
    telegraphNode,
    baseMesh,
    fillMesh,
    startCap,
    endCap,
    fillCap,
    rails,
    flashMeshes,stompNode,stompFill,stompEdge,stompCharge,
  };
}
