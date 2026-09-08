import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { MiningModel, ORES, type MiningImpact, type OreKind } from "../components/game/mining";
import { MINING_IMPACT_TIME, MINING_SWING_DURATION } from "../components/game/miningMotion";
import { MiningHold } from "../components/game/miningInput";
import { GroundItems, createGroundItemView } from "../components/game/droppedItems";
import { InventoryModel, ITEMS, inventoryGains, isEquipmentSlot, type Stack } from "../components/game/inventory";
import { createFarmCamera } from "../components/game/engine";
import { createSpringLighting } from "../components/game/lighting";
import { buildWorld } from "../components/game/world";

const totals = (stacks: readonly Stack[]) => stacks.reduce((result, stack) => {
  result[stack.id] = (result[stack.id] ?? 0) + stack.count;
  return result;
}, {} as Record<string, number>);
const groundTotals = (ground: GroundItems) => totals(ground.items.map(item => item.stack));
const expected = {
  copper: [{ id: "copperOre", count: 3 }, { id: "stone", count: 2 }],
  iron: [{ id: "ironOre", count: 4 }, { id: "stone", count: 3 }],
  crystal: [{ id: "crystal", count: 5 }, { id: "stone", count: 2 }],
} satisfies Record<OreKind, Stack[]>;
function checkReceipt(receipt: MiningImpact, kind: OreKind, hit: number) {
  assert(receipt.ok);
  assert.equal(receipt.broken, hit === ORES[kind].health);
  assert.deepEqual(receipt.loot, [
    { id: expected[kind][0].id, count: 1 },
    ...(receipt.broken ? [expected[kind][1]] : []),
  ], `${kind} hit ${hit}: exactly one mineral; original stone only on final hit`);
}
function advance(ground: GroundItems, seconds: number) {
  let landed = 0;
  while (seconds > 1e-9) { const dt = Math.min(.01, seconds); landed += ground.update(dt); seconds -= dt; }
  return landed;
}

// Independent contract expectations prevent ORES and the receipt implementation drifting together.
for (const kind of ["copper", "iron", "crystal"] as const) {
  assert.deepEqual(ORES[kind].loot, expected[kind], `${kind}: ORES describes the entire deposit yield`);
  const model = new MiningModel(() => true, [{ id: "ore", kind, x: 0, z: 0, size: 1 }]);
  const node = model.get("ore")!, player = { x: 1.3, z: 0 }, receipts: Stack[] = [];
  for (let hit = 1; hit <= ORES[kind].health; hit++) {
    assert(model.begin(node.id, player, "pickaxe").ok);
    for (let repeat = 0; repeat < 10; repeat++) assert(!model.begin(node.id, player, "pickaxe").ok);
    const hp = node.health;
    assert.equal(model.update(MINING_IMPACT_TIME - .001, player, "pickaxe"), null);
    assert.equal(node.health, hp, "pre-contact updates award nothing");
    const receipt = model.update(.002, player, "pickaxe")!;
    checkReceipt(receipt, kind, hit); receipts.push(...receipt.loot.map(s => ({ ...s })));
    assert.equal(node.health, hp - 1);
    for (let i = 0; i < 10; i++) assert.equal(model.update(.001, player, "pickaxe"), null, "one receipt per swing even with repeated updates");
    assert.equal(model.update(MINING_SWING_DURATION, player, "pickaxe"), null, "recovery cannot duplicate loot");
  }
  assert.deepEqual(totals(receipts), totals(expected[kind]));
  for (let i = 0; i < 20; i++) {
    assert(!model.begin(node.id, player, "pickaxe").ok);
    assert.equal(model.update(.01, player, "pickaxe"), null, "depleted retries cannot mint ore");
  }
  // A returned mutable receipt must not mutate the published deposit definition.
  const isolated = new MiningModel(() => true, [{ id: "ore", kind, x: 0, z: 0, size: 1 }]);
  assert(isolated.begin("ore", player, "pickaxe").ok);
  isolated.update(MINING_SWING_DURATION + .1, player, "pickaxe")!.loot[0].count = 999;
  assert.deepEqual(ORES[kind].loot, expected[kind]);
  assert(isolated.begin("ore", player, "pickaxe").ok);
  checkReceipt(isolated.update(MINING_SWING_DURATION + .1, player, "pickaxe")!, kind, 2);
}

// Cancellation, invalid dt, pause and validation at contact never create phantom receipts.
for (const cancel of ["explicit", "tool", "range", "obstacle", "pause"] as const) {
  let clear = true;
  const model = new MiningModel(() => clear), node = model.nodes[0], player = { x: node.x + 1.3, z: node.z };
  const hold = new MiningHold();
  assert(model.begin(node.id, player, "pickaxe").ok); hold.press("keyboard", node.id);
  assert.equal(model.update(.1, player, "pickaxe"), null);
  const frozen = JSON.stringify(model.swing);
  for (const dt of [0, NaN, -1, Infinity]) assert.equal(model.update(dt, player, "pickaxe"), null);
  assert.equal(JSON.stringify(model.swing), frozen, "paused/invalid deltas never advance contact");
  if (cancel === "explicit" || cancel === "pause") { model.cancel(); hold.clear(); }
  if (cancel === "range") player.x += 10;
  if (cancel === "obstacle") clear = false;
  const receipt = model.update(MINING_SWING_DURATION, player, cancel === "tool" ? "sword" : "pickaxe");
  assert(!receipt?.ok, `${cancel} cannot award a successful hit`);
  assert.deepEqual(receipt?.loot ?? [], []);
  assert.equal(node.health, ORES[node.kind].health);
  if (cancel === "pause") {
    assert.equal(hold.next(model, player, "pickaxe"), null, "resume does not revive a held press");
    assert.equal(model.update(2, player, "pickaxe"), null);
  }
}
{
  const model = new MiningModel(), node = model.nodes[0], player = { x: node.x + 1.3, z: node.z };
  assert(model.begin(node.id, player, "pickaxe").ok);
  const committed = model.update(MINING_IMPACT_TIME + .001, player, "pickaxe")!;
  model.cancel();
  assert.equal(model.update(2, player, "pickaxe"), null);
  assert.deepEqual(committed.loot, [{ id: "copperOre", count: 1 }], "cancel after contact retains the one committed receipt");
  assert.equal(node.health, ORES.copper.health - 1);
}

const engine = new NullEngine(), scene = new Scene(engine), camera = createFarmCamera(scene);
const lighting = createSpringLighting(scene, camera), world = buildWorld(scene, lighting.shadow);
let approaches = 0, liveHits = 0, totalHits = 0;
try {
  // Unlike the old break-only ejection regression, keep the real ore collider live for each surviving hit.
  for (const node of world.mining.nodes) {
    let tested = 0;
    for (let angle = 0; angle < 24; angle++) {
      node.health = ORES[node.kind].health; node.respawn = 0; world.mining.cancel();
      const a = angle * Math.PI / 12, player = { x: node.x + Math.cos(a) * 1.45, z: node.z + Math.sin(a) * 1.45 };
      if (!world.canWalk(player.x, player.z, .27) || world.mining.reason(node, player, "pickaxe")) continue;
      const ground = new GroundItems(), bag = new InventoryModel(), before = bag.snapshot(), receipts: Stack[] = [];
      const origin = { x: node.x, y: world.heightAt(node.x, node.z) + .62 * node.size, z: node.z };
      for (let hit = 1; hit <= ORES[node.kind].health; hit++) {
        assert(world.mining.begin(node.id, player, "pickaxe").ok);
        advance(ground, MINING_IMPACT_TIME + .001);
        const receipt = world.mining.update(MINING_IMPACT_TIME + .001, player, "pickaxe")!;
        checkReceipt(receipt, node.kind, hit); receipts.push(...receipt.loot);
        if (!receipt.broken) {
          assert(world.mining.blocks(node.x, node.z));
          assert(!world.canWalk(node.x, node.z), "surviving ore collider remains live during landing search"); liveHits++;
        }
        const previous = ground.items.map(item => ({ id: item.id, flight: item.flight, elapsed: item.flight?.elapsed, stack: { ...item.stack } }));
        const items = ground.eject(receipt.loot, origin, player, world.canWalk, world.clearReach);
        assert.equal(items.length, receipt.broken ? 2 : 1, "every hit produces a new independent mineral flight");
        for (const old of previous) {
          const item = ground.items.find(item => item.id === old.id)!;
          assert.equal(item.flight, old.flight, "new hit neither resets nor replaces an earlier flight");
          assert.equal(item.flight?.elapsed, old.elapsed);
          assert.deepEqual(item.stack, old.stack, "new hit never merges away its pop animation");
        }
        if (hit > 1) assert(previous.some(item => item.flight), "consecutive mining flights overlap in time");
        for (const item of items) {
          assert(item.flight && item.flight.elapsed === 0);
          assert.deepEqual(item.flight.from, origin);
          assert(world.canWalk(item.position.x, item.position.z, .24), `${node.id} hit ${hit}: safe landing with real colliders`);
          assert(world.clearReach(player, item.position), `${node.id} hit ${hit}: unobstructed pickup reach`);
          assert(Math.hypot(player.x - item.position.x, player.z - item.position.z) < 1.8);
          assert(!ground.pickup(item.id, bag).ok, "fresh flight is not pickable");
          assert.notEqual(ground.nearest(item.position)?.id, item.id, "nearest excludes airborne items");
        }
        assert.equal(new Set(ground.items.map(item => item.id)).size, ground.items.length);
        assert.deepEqual(groundTotals(ground), totals(receipts), "each hit conserves all prior and current ore");
        assert.deepEqual(bag.snapshot(), before, "hit/flight/landing never directly awards inventory");
        const recovery = MINING_SWING_DURATION - MINING_IMPACT_TIME + .001;
        assert.equal(world.mining.update(recovery, player, "pickaxe"), null);
        advance(ground, recovery); totalHits++;
      }
      advance(ground, 1);
      assert(ground.items.every(item => !item.flight));
      assert.equal(ground.update(.1), 0, "landing is committed only once");
      assert.deepEqual(groundTotals(ground), totals(expected[node.kind]));
      for (const item of [...ground.items]) {
        const beforeSlots = bag.snapshot().slots, pickup = ground.pickup(item.id, bag);
        assert(pickup.ok);
        assert.deepEqual(pickup.gains, inventoryGains(beforeSlots, bag.slots), "receipt matches actual slot deltas");
        assert.deepEqual(totals(pickup.gains), totals([item.stack]));
        assert(!ground.pickup(item.id, bag).ok, "pickup receipt cannot be replayed");
      }
      for (const stack of expected[node.kind]) assert.equal(bag.count(stack.id), stack.count);
      assert.equal(ground.items.length, 0); approaches++; tested++;
    }
    assert(tested > 0, `${node.id}: at least one live-collider approach`);
    node.health = ORES[node.kind].health; node.respawn = 0; world.mining.cancel();
  }

  // Existing landed AND airborne same-kind piles reserve their destinations, without swallowing new flights.
  const ground = new GroundItems(), origin = { x: 0, y: .62, z: 0 }, player = { x: 1.3, z: 0 };
  const landed = ground.eject([{ id: "copperOre", count: 1 }], origin, player, () => true, () => true)[0];
  advance(ground, 1);
  const second = ground.eject([{ id: "copperOre", count: 1 }], origin, player, () => true, () => true)[0];
  advance(ground, .1);
  const third = ground.eject([{ id: "copperOre", count: 1 }], origin, player, () => true, () => true)[0];
  for (const [a, b] of [[landed, second], [landed, third], [second, third]])
    assert(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > .58, "successive ejections space against existing destinations");
  assert.equal(ground.items.length, 3); assert(second.flight && third.flight);
  assert(second.flight.elapsed > third.flight.elapsed, "each flight owns its independent age");
  const view = createGroundItemView(scene, ground, () => 0); view.update(0, true);
  const secondPose = view.center(second.id)!, thirdPose = view.center(third.id)!;
  assert(!secondPose.equalsWithEpsilon(thirdPose), "earlier airborne sprite is separate from the new pop at origin");
  const frozen = JSON.stringify(ground.items);
  for (const dt of [0, NaN, -1, Infinity]) { ground.update(dt); view.update(0, true); }
  assert.equal(JSON.stringify(ground.items), frozen);
  assert(view.center(second.id)!.equalsWithEpsilon(secondPose));
  assert(view.center(third.id)!.equalsWithEpsilon(thirdPose), "paused flight poses remain frozen");
  advance(ground, 1);
  const full = new InventoryModel();
  for (let slot = 0; slot < full.slots.length; slot++) if (!isEquipmentSlot(slot)) full.slots[slot] = { id: "wood", count: ITEMS.wood.max };
  const fullBefore = full.snapshot(), groundBefore = JSON.stringify(ground.items);
  for (const item of ground.items) assert(!ground.pickup(item.id, full).ok);
  assert.deepEqual(full.snapshot(), fullBefore); assert.equal(JSON.stringify(ground.items), groundBefore, "full bag leaves every per-hit pile intact");
  full.slots[9] = null;
  for (const item of [...ground.items]) { const receipt = ground.pickup(item.id, full); assert(receipt.ok); assert.equal(receipt.gains.reduce((n, gain) => n + gain.count, 0), 1); }
  assert.equal(full.count("copperOre"), 3); assert.equal(ground.items.length, 0);
  console.log(JSON.stringify({ result: "passed", approaches, liveHits, totalHits, checks: "per-hit receipts; original stone byproducts; total yields; repeat/recovery/depleted defense; cancellation/contact validation; all 12 live-collider ore landings; overlapping independent flights; existing-pile spacing; no midair pickup; actual slot receipts; conservation; full bag; pause" }));
} finally {
  scene.dispose(); engine.dispose();
}
