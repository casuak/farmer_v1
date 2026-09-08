import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import {
  MiningModel,
  ORES,
  FOREST_ORES,
  MINING_REACH,
  ORE_RESPAWN_SECONDS,
  oreRadius,
  type OreNode,
  type MiningImpact,
} from "../components/game/mining";
import { MINING_IMPACT_TIME, MINING_SWING_DURATION } from "../components/game/miningMotion";
import { createFarmCamera, SPAWN } from "../components/game/engine";
import { createSpringLighting } from "../components/game/lighting";
import { buildWorld } from "../components/game/world";
import { createMiningView } from "../components/game/miningView";
import { createHeldTools } from "../components/game/farmView";
import { InventoryModel, ITEMS, isEquipmentSlot, type Stack } from "../components/game/inventory";
import { GroundItems, createGroundItemView } from "../components/game/droppedItems";
import { inForest, nearRoad } from "../components/game/geography";
import type { Point } from "../components/game/farming";
import "./verify-mining-motion";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";

type World = ReturnType<typeof buildWorld>;

/** A player standing one metre along +X from a node: within reach, clear line of sight. */
const near = (node: OreNode): Point => ({ x: node.x + 1, z: node.z });

/** Begin a swing, fire the impact, then finish the swing so the next begin is accepted. */
function swing(model: MiningModel, id: string, player: Point): MiningImpact {
  const r = model.begin(id, player, "pickaxe");
  assert(r.ok, `begin(${id}) accepted`);
  const impact = model.update(MINING_IMPACT_TIME + 0.001, player, "pickaxe");
  assert(impact, `impact fires for ${id}`);
  model.update(MINING_SWING_DURATION + 0.001, player, "pickaxe"); // finish the swing
  return impact;
}

/** Swing until a deposit breaks, leaving its respawn clock untouched (at exactly ORE_RESPAWN_SECONDS). */
function breakNode(model: MiningModel, node: OreNode, player: Point): MiningImpact {
  let last: MiningImpact | null = null;
  while (node.health > 0) {
    assert(model.begin(node.id, player, "pickaxe").ok, `begin(${node.id}) accepted`);
    last = model.update(MINING_IMPACT_TIME + 0.001, player, "pickaxe");
    assert(last && last.ok, `impact fires for ${node.id}`);
    if (node.health > 0) model.update(MINING_SWING_DURATION + 0.001, player, "pickaxe"); // only continue a surviving swing
  }
  return last!;
}

/** Flood-fill walkable cells from the spawn with a 0.5 m lattice. */
function floodReachable(w: World, start: Point, step = 0.5) {
  const key = (cx: number, cz: number) => cx + "," + cz;
  const toCell = (x: number, z: number) => ({ cx: Math.round(x / step), cz: Math.round(z / step) });
  const seen = new Set<string>();
  const startCell = toCell(start.x, start.z);
  seen.add(key(startCell.cx, startCell.cz));
  const queue: Array<[number, number]> = [[startCell.cx, startCell.cz]];
  const reachable: Point[] = [];
  while (queue.length) {
    const [cx, cz] = queue.shift()!;
    const x = cx * step, z = cz * step;
    if (!w.canWalk(x, z, 0.2)) continue;
    reachable.push({ x, z });
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = key(cx + dx, cz + dz);
      if (!seen.has(nc)) { seen.add(nc); queue.push([cx + dx, cz + dz]); }
    }
  }
  const covers = (x: number, z: number) => {
    const c = toCell(x, z);
    return seen.has(key(c.cx, c.cz));
  };
  return { reachable, covers };
}

function verifyWorldLayout(w: World) {
  // --- 12 deposits all live in the forest ---
  assert.equal(FOREST_ORES.length, 12, "there are exactly 12 deposit seeds");
  assert.equal(w.mining.nodes.length, 12, "the world model seeded the same 12 deposits");
  for (const n of FOREST_ORES) {
    assert(inForest(n.x, n.z), `${n.id} sits inside the forest district`);
    assert(w.mining.get(n.id), `world model carries deposit ${n.id}`);
  }
  // node ids line up one-to-one with the seeds
  assert.deepEqual(
    w.mining.nodes.map(n => n.id).sort(),
    FOREST_ORES.map(n => n.id).sort(),
    "mining nodes match the seed set",
  );

  // --- deposits keep a margin off every road ---
  let minRoadClearance = Infinity;
  for (const n of FOREST_ORES) {
    let clearance = 8; // search horizon; far deposits simply stay high
    for (let m = 0; m < 8; m += 0.05) {
      if (nearRoad(n.x, n.z, m)) { clearance = m; break; }
    }
    minRoadClearance = Math.min(minRoadClearance, clearance);
  }
  assert(minRoadClearance > 0.6, `deposits stay off the roads (min clearance ${minRoadClearance.toFixed(2)} m)`);

  // --- each deposit blocks movement at its own centre ---
  for (const node of w.mining.nodes) {
    assert(w.mining.blocks(node.x, node.z), `${node.id} collider is live at its centre`);
    assert(!w.canWalk(node.x, node.z), `${node.id} blocks walking at its centre`);
    // collision footprint is at least a body-radius square, but well inside reach
    assert(oreRadius(node) < MINING_REACH - 0.2, `${node.id} collider stays smaller than the mining reach`);
  }

  // --- every deposit is reachable from the spawn on foot AND mineable from at least one side ---
  const { reachable } = floodReachable(w, SPAWN);
  assert(reachable.length > 2000, `the spawn flood reaches a large walkable area (${reachable.length} cells)`);
  for (const node of w.mining.nodes) {
    const mineable = reachable.some(p =>
      Math.hypot(p.x - node.x, p.z - node.z) <= MINING_REACH + 1e-9 &&
      w.mining.reason(node, p, "pickaxe") === null,
    );
    assert(mineable, `${node.id} is reachable from the spawn and mineable from at least one side`);
  }

  // --- depleting a deposit opens a walkable gap at that spot ---
  const dep = w.mining.nodes[0];
  const depDef = ORES[dep.kind];
  assert(!w.canWalk(dep.x, dep.z), "fresh ore blocks the gap");
  dep.health = 0;
  assert(w.canWalk(dep.x, dep.z), "a mined-out deposit no longer blocks the gap");
  dep.health = depDef.health;
  dep.respawn = 0; // restore so later world checks see a full deposit
  assert(!w.canWalk(dep.x, dep.z), "restored ore blocks again");
}

function verifyModelLogic() {
  // --- copper / iron / crystal need exactly 3 / 4 / 5 hits ---
  for (const [kind, expected] of [["copper", 3], ["iron", 4], ["crystal", 5]] as const) {
    const m = new MiningModel();
    const node = m.nodes.find(n => n.kind === kind)!;
    const player = near(node);
    assert.equal(node.health, expected, `${kind} starts at ${expected} hp`);
    let hits = 0;
    let last: MiningImpact | null = null;
    const total = new Map<string, number>();
    while (node.health > 0) {
      hits++; last = swing(m, node.id, player); assert(last.ok, `${kind} swing lands`);
      const mineral = ORES[kind].loot.find(s => s.id !== "stone")!;
      assert.deepEqual(last.loot, [{ id: mineral.id, count: 1 }, ...(last.broken ? ORES[kind].loot.filter(s => s.id === "stone") : [])], `${kind} hit ${hits} gives one mineral; stone only on break`);
      for (const s of last.loot) total.set(s.id, (total.get(s.id) ?? 0) + s.count);
    }
    assert.equal(hits, expected, `${kind} breaks after exactly ${expected} hits`);
    assert(last!.broken, `${kind} breaks on its last hit`);
    assert.deepEqual(Object.fromEntries(total), Object.fromEntries(ORES[kind].loot.map(s => [s.id, s.count])), `${kind} cumulative loot matches its total yield`);
  }

  // --- no damage before MINING_IMPACT_TIME; exactly one damage at contact ---
  {
    const m = new MiningModel();
    const node = m.get("copper-trail")!;
    const player = near(node);
    assert(m.begin(node.id, player, "pickaxe").ok);
    let t = 0;
    while (t + 0.1 < MINING_IMPACT_TIME) { assert.equal(m.update(0.1, player, "pickaxe"), null, "no impact before contact"); t += 0.1; }
    const before = node.health;
    const impact = m.update(MINING_IMPACT_TIME - t + 0.001, player, "pickaxe");
    assert(impact, "impact lands at the contact time");
    assert(impact.ok);
    assert.equal(node.health, before - 1, "one swing deals exactly one damage");
  }

  // --- repeat begin / cooldown never double-counts loot ---
  {
    const m = new MiningModel();
    const node = m.get("copper-trail")!;
    const player = near(node);
    assert(m.begin(node.id, player, "pickaxe").ok);
    assert(!m.begin(node.id, player, "pickaxe").ok, "cannot begin mid-swing");
    const impact = m.update(MINING_IMPACT_TIME + 0.001, player, "pickaxe");
    assert(impact && impact.ok);
    assert.equal(node.health, ORES.copper.health - 1, "copper takes one hit");
    assert(!m.begin(node.id, player, "pickaxe").ok, "still mid-swing after impact");
    m.update(MINING_SWING_DURATION + 0.001, player, "pickaxe");
    assert.equal(m.active, false);
    const second = swing(m, node.id, player);
    const last = swing(m, node.id, player);
    assert(last.broken, "copper breaks on the third hit");
    assert.deepEqual(impact.loot, [{ id: "copperOre", count: 1 }]);
    assert.deepEqual(second.loot, [{ id: "copperOre", count: 1 }]);
    assert.deepEqual(last.loot, [{ id: "copperOre", count: 1 }, { id: "stone", count: 2 }], "final hit gives one ore and the original stone byproduct");
    for (const s of ORES.copper.loot) assert.equal([impact, second, last].flatMap(hit => hit.loot).filter(l => l.id === s.id).reduce((count, l) => count + l.count, 0), s.count, "cumulative copper loot is exact");
    assert(!m.begin(node.id, player, "pickaxe").ok, "depleted deposit refuses re-mining");
    assert.equal(node.health, 0, "no extra damage once depleted");
  }

  // --- far / wrong-tool / obstacle / unknown rejections ---
  {
    const m = new MiningModel();
    const node = m.get("copper-trail")!;
    assert(!m.begin(node.id, { x: node.x + 5, z: node.z }, "pickaxe").ok, "too far rejected");
    assert(!m.begin(node.id, near(node), "hoe").ok, "wrong tool rejected");
    assert(!m.begin("no-such-node", near(node), "pickaxe").ok, "unknown deposit rejected");
    const blocked = new MiningModel(() => false);
    const bnode = blocked.get("copper-trail")!;
    assert(!blocked.begin(bnode.id, near(bnode), "pickaxe").ok, "an obstacle in the line rejected");
  }

  // --- cancel and hand-swap before contact never consume the deposit ---
  {
    const m = new MiningModel();
    const node = m.get("copper-trail")!;
    const player = near(node);
    const start = node.health;
    assert(m.begin(node.id, player, "pickaxe").ok);
    m.cancel();
    assert.equal(node.health, start, "cancel deals no damage");
    assert.equal(m.active, false);

    assert(m.begin(node.id, player, "pickaxe").ok);
    const swapped = m.update(0.1, player, "hoe");
    assert.equal(swapped, null, "a hand-swap before contact cancels the swing");
    assert.equal(node.health, start, "hand-swap before contact deals no damage");
    assert.equal(m.active, false, "hand-swap clears the swing");

    assert(m.begin(node.id, player, "pickaxe").ok);
    const impact = m.update(MINING_IMPACT_TIME + 0.001, player, "pickaxe");
    assert(impact && impact.ok);
    assert.equal(node.health, start - 1, "a fresh swing still damages once");
  }

  // --- depleted re-mine yields nothing, even after repeated attempts ---
  {
    const m = new MiningModel();
    const node = m.get("copper-trail")!;
    const player = near(node);
    while (node.health > 0) swing(m, node.id, player);
    assert.equal(node.health, 0);
    const before = node.health;
    for (let i = 0; i < 40; i++) {
      assert(!m.begin(node.id, player, "pickaxe").ok, "depleted deposit rejects begin");
      assert(m.update(0.1, player, "pickaxe") === null, "no impact from a depleted deposit");
    }
    assert.equal(node.health, before, "depleted deposit never yields another hit");
  }

  // --- 120 s respawn never re-covers the player; steps clear and it returns ---
  {
    const m = new MiningModel();
    const node = m.get("copper-trail")!;
    const player = near(node);
    const broke = breakNode(m, node, player);
    assert(broke.broken, "the deposit breaks");
    assert.equal(node.health, 0);
    assert.equal(node.respawn, ORE_RESPAWN_SECONDS, "a broken deposit starts the 120 s respawn clock");
    // player stands on top of the node: no respawn regardless of elapsed time
    const onNode: Point = { x: node.x + 0.7, z: node.z };
    for (let t = 0; t < ORE_RESPAWN_SECONDS + 5; t += 1) m.update(1, onNode, "pickaxe");
    assert.equal(node.health, 0, "no respawn while the player overlaps the deposit");
    assert.equal(node.respawn, 0, "the respawn clock fully expired");
    // step clear -> the deposit ticks back to full health
    m.update(1, { x: node.x + 5, z: node.z }, "pickaxe");
    assert.equal(node.health, ORES.copper.health, "deposit respawns once the player steps clear");
    assert.equal(node.respawn, 0);
  }
}

function verifyInventoryRegression(scene: Scene) {
  // --- a full mining loot stack fits the backpack ---
  const bag = new InventoryModel();
  const loot = ORES.copper.loot.map(s => ({ ...s } as Stack));
  assert(bag.add(loot), "copper loot fits the pack");
  for (const s of loot) assert.equal(bag.count(s.id), s.count, `${s.id} stored`);

  // --- a full pack rejects the loot (caller must drop it to the ground) ---
  const full = new InventoryModel();
  full.buyBackpack();
  for (let i = 0; i < full.slots.length; i++) if (!isEquipmentSlot(i)) full.slots[i] = { id: "wood", count: 30 };
  assert(!full.canAdd(loot), "a full pack cannot take a fresh mining drop");
  assert(!full.add(loot), "a full pack refuses the mining drop atomically");

  // --- dropped ore stays on the ground, is pickable back into a pack, and sells ---
  const drops = new GroundItems();
  const dropView = createGroundItemView(scene, drops);
  const dropped = drops.add({ id: "ironOre", count: 3 }, new Vector3(-20,0,8));
  assert.deepEqual(dropped.position,{x:-20,z:8},"Babylon Vector3 accessors are copied as coordinates, not internal _x/_z fields");
  assert.equal(drops.nearest({x:-20,z:8})?.id,dropped.id,"real avatar-position drops remain reachable");
  dropView.update(0, true);
  const pickBag = new InventoryModel();
  assert(drops.pickup(dropped.id, pickBag).ok, "dropped ore is picked up");
  assert.equal(pickBag.count("ironOre"), 3);
  assert.equal(drops.items.length, 0, "the ground clears after pickup");

  const sellBag = new InventoryModel();
  sellBag.slots[0] = { id: "crystal", count: 2 };
  const goldBefore = sellBag.gold;
  const r = sellBag.sell(0, true);
  assert(r.ok, "an ore sells");
  assert.equal(sellBag.gold, goldBefore + ITEMS.crystal.sell * 2);
  assert.equal(sellBag.count("crystal"), 0);
}

function verifyMiningView(scene: Scene, shadow: ShadowGenerator, w: World) {
  const hand = new TransformNode("test-hand", scene);
  const heldTools = createHeldTools(scene, hand, shadow);
  const tip = heldTools.pickaxeTip;
  assert(tip, "held tools expose a pickaxe tip");
  const view = createMiningView(scene, shadow, w.mining);

  // --- a deposit has exactly health-1 cracks ---
  for (const node of w.mining.nodes) {
    const v = view.views.get(node.id)!;
    assert.equal(v.cracks.length, ORES[node.kind].health - 1, `${node.id} shows ${ORES[node.kind].health - 1} cracks`);
  }

  // --- init: full-health deposits show no cracks and stay visible ---
  view.update(0, 0, true, null, tip);
  for (const node of w.mining.nodes) {
    const v = view.views.get(node.id)!;
    assert(v.root.isEnabled(), `${node.id} visible at full health`);
    for (const c of v.cracks) assert(!c.isEnabled(), `${node.id} shows no cracks at full health`);
  }

  // --- cracks appear as the deposit loses health ---
  const node = w.mining.get("copper-gate")!;
  const v = view.views.get(node.id)!;
  const original = node.health;
  node.health = 1;
  view.update(0, 0, true, w.mining.inspect(node, near(node), "pickaxe"), tip);
  assert(v.cracks[0].isEnabled() && v.cracks[1].isEnabled(), "low-health copper shows every crack");
  node.health = 2;
  view.update(0, 0, true, null, tip);
  assert(v.cracks[0].isEnabled() && !v.cracks[1].isEnabled(), "mid-health copper shows one crack");
  node.health = 3;
  view.update(0, 0, true, null, tip);
  assert(!v.cracks[0].isEnabled() && !v.cracks[1].isEnabled(), "full-health copper hides all cracks");

  // --- a depleted deposit is hidden entirely ---
  node.health = 0;
  view.update(0, 0, true, null, tip);
  assert(!v.root.isEnabled(), "a depleted deposit is hidden");
  assert(!view.ring.isEnabled(), "no target ring for an empty spot");
  node.health = original;
  view.update(0, 0, true, null, tip);
  assert(v.root.isEnabled(), "the restored deposit shows again");

  // --- mesh pool is bounded: mining forever never creates new meshes ---
  const meshesBefore = scene.meshes.length;
  const probe = w.mining.get("crystal-east")!;
  for (let i = 0; i < 300; i++) {
    const impact: MiningImpact = { ok: true, message: "x", node: probe, broken: i % 7 === 0, loot: [], point: { x: probe.x - 1, z: probe.z } };
    view.hit(impact, i % 2 === 0);
    view.update(i / 60, 0.016, i % 2 === 0, null, tip);
  }
  assert.equal(scene.meshes.length, meshesBefore, "repeated mining spawns no new meshes (fixed debris + trail pool)");
  view.update(2, 4, false, null, tip); // flush all debris lives

  // --- reduced motion: smaller burst and no swing trail ---
  assert.equal(view.bits.length, 64, "the debris pool is a fixed 64");
  view.hit({ ok: true, message: "x", node: probe, broken: false, loot: [], point: { x: probe.x, z: probe.z } }, false);
  assert.equal(view.bits.filter(b => b.mesh.isEnabled()).length, 6, "reduced motion spawns a smaller burst");
  view.update(2, 4, false, null, tip);
  view.hit({ ok: true, message: "x", node: probe, broken: false, loot: [], point: { x: probe.x, z: probe.z } }, true);
  assert.equal(view.bits.filter(b => b.mesh.isEnabled()).length, 19, "full motion spawns the spark burst");
  view.update(1, 0, false, null, tip);
  assert(!view.trail.isEnabled(), "the swing trail stays hidden with motion off");

  // --- every material colour is finite after all the updates ---
  for (const m of scene.materials) {
    const s = m as unknown as {
      diffuseColor?: { r: number; g: number; b: number };
      emissiveColor?: { r: number; g: number; b: number };
      specularColor?: { r: number; g: number; b: number };
    };
    for (const c of [s.diffuseColor, s.emissiveColor, s.specularColor]) {
      if (c) assert(Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b), `material ${m.name} has a finite colour`);
    }
    assert(Number.isFinite(m.alpha), `material ${m.name} has a finite alpha`);
  }
  for (const m of scene.meshes) {
    const p = m.getVerticesData("position");
    if (p) assert(Array.from(p).every(Number.isFinite), `mesh ${m.name} has finite vertex positions`);
  }
}

function verifyMining() {
  const engine = new NullEngine();
  engine.getCaps().maxTextureSize = 4096;
  engine.getCaps().maxRenderTextureSize = 4096;
  const scene = new Scene(engine);
  const camera = createFarmCamera(scene);
  const lighting = createSpringLighting(scene, camera);
  const shadow = lighting.shadow;
  const w = buildWorld(scene, shadow);
  // Model NullEngine's pending procedural uploads like the parent harness.
  for (const name of ["soft-ground-contact", "street-light-falloff"]) {
    const texture = scene.textures.find(t => t.name === name)!.getInternalTexture()!;
    assert(texture._bufferView && texture._bufferView.byteLength > 0, `${name}: procedural pixels are generated`);
    texture.isReady = true;
  }

  verifyWorldLayout(w);
  verifyModelLogic();
  verifyInventoryRegression(scene);
  verifyMiningView(scene, shadow, w);

  scene.render();
  console.log(
    `Mining regression passed: ${FOREST_ORES.length} deposits across ${Object.keys(ORES).length} ore kinds (copper/iron/crystal), ` +
      `all in-forest and off-road, every deposit reachable from spawn and mineable from one side, ` +
      `collider walk/block reversal, 3/4/5-hit breakage, impact-at-0.38s, no double-loot on repeat, ` +
      `far/wrong-tool/obstacle rejection, cancel + hand-swap no-damage, depleted no-resource, ` +
      `120 s respawn-no-overlap, loot→pack/capacity/drop-pickup/sell, view cracks + hide + fixed debris pool + reduced-motion, finite materials/vertices.`,
  );
  scene.dispose();
  engine.dispose();
}

verifyMining();
