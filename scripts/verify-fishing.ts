import assert from "node:assert/strict";
import {
  FishingModel,
  FISHING,
  FISH,
  findFishingSpot,
  castPowerAt,
  inventoryCatchSlot,
  type FishingSpot,
} from "../components/game/fishing";
import { InventoryModel, ITEMS, isEquipmentSlot } from "../components/game/inventory";
import { BOUNDS, isWater, onBridge, onDock } from "../components/game/geography";

/** Seeded LCG so species / wait layout / movement are reproducible. */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Float-tolerant equality, used where the triangle wave is built from modulo. */
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** A fishing line has zero radius; dry samples at the edge must not collide with the water. */
function canStand(x: number, z: number, r = 0): boolean {
  if (Math.abs(x) > BOUNDS.x - 0.5 - r || Math.abs(z) > BOUNDS.z - 0.5 - r) return false;
  for (const [dx, dz] of [[-r, -r], [r, -r], [-r, r], [r, r]] as const) {
    if (isWater(x + dx, z + dz) && !onBridge(x + dx, z + dz) && !onDock(x + dx, z + dz)) return false;
  }
  return true;
}

/** A canStand that additionally blocks a small obstacle (wall / tree / fence) at (wx,wz). */
function obstacleAt(wx: number, wz: number, r = 0.3): (x: number, z: number) => boolean {
  return (x, z) => canStand(x, z) && !(Math.abs(x - wx) < r && Math.abs(z - wz) < r);
}

/** Insert a fish stack (id is a plain string here, safe at runtime). */
function putFish(bag: InventoryModel, index: number, id: string, count: number): void {
  (bag.slots as Array<{ id: string; count: number } | null>)[index] = { id, count };
}

const SPOT: FishingSpot = { x: -6, z: -10, kind: "river" };
const SEA_SPOT: FishingSpot = { x: 30, z: -23, kind: "sea" };
const RIVER_POOL = ["carp", "perch"];
const SEA_POOL = ["sardine", "redSnapper"];

/** Update in small chunks until a target phase is reached. */
function advanceUntil(model: FishingModel, target: FishingModel["phase"], cap = 120): void {
  let t = 0;
  while (model.phase !== target && t < cap) {
    model.update(0.05);
    t += 0.05;
  }
  assert.equal(model.phase, target);
}

/** Cast, ride the wait to the bite, and hook it. */
function enterReeling(model: FishingModel, spot: FishingSpot = SPOT): void {
  assert(model.cast(spot), "cast is accepted from idle");
  advanceUntil(model, "waiting");
  advanceUntil(model, "bite");
  model.press();
  assert.equal(model.phase, "reeling");
}

/** Chase the fish with a bang-bang bar controller until the catch starts. */
function chaseToCatch(model: FishingModel): void {
  let steps = 0;
  while (model.phase === "reeling" && steps < 35 * 240) {
    const s = model.snapshot();
    if (s.fishPosition > s.barPosition) model.press();
    else model.release();
    model.update(1 / 120);
    steps++;
  }
  assert.equal(model.phase, "catching", `controlled reeling should succeed (took ${steps} steps)`);
}

/** Chase, then deliberately let the bar leave the fish (records a non-perfect), then land it. */
function chaseWithLeave(model: FishingModel): void {
  let steps = 0;
  while (model.phase === "reeling" && model.snapshot().phaseTime < 1.3 && steps < 35 * 240) {
    const s = model.snapshot();
    if (s.fishPosition > s.barPosition) model.press();
    else model.release();
    model.update(1 / 120);
    steps++;
  }
  const leaveUntil = model.snapshot().phaseTime + 1.5;
  while (model.phase === "reeling" && model.snapshot().phaseTime < leaveUntil) {
    model.release();
    model.update(1 / 120);
    steps++;
  }
  while (model.phase === "reeling" && steps < 35 * 240) {
    const s = model.snapshot();
    if (s.fishPosition > s.barPosition) model.press();
    else model.release();
    model.update(1 / 120);
    steps++;
  }
  assert.equal(model.phase, "catching", "an early leave still ends in a catch");
}

/** Sample 100 fish from a biome spot and assert every draw comes from the biome pool. */
function sampleFishPool(kind: "river" | "sea", spot: FishingSpot, pool: string[]): void {
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const m = new FishingModel(seededRandom(0x2000 + i));
    enterReeling(m, spot);
    const f = m.snapshot().fish;
    assert(f, "fish assigned at hook");
    assert(pool.includes(f.id), `species ${f.id} belongs to the ${kind} pool`);
    assert.equal(FISH[f.id].name, ITEMS[f.id].name, `pool species ${f.id} name matches ITEMS`);
    seen.add(f.id);
    m.cancel();
  }
  assert.equal(seen.size, pool.length, `the ${kind} pool draws every species across samples`);
}

function assertSpotValid(
  sp: ReturnType<typeof findFishingSpot>,
  player: { x: number; z: number },
  aim: { x: number; z: number },
  expectedKind?: "river" | "sea",
): void {
  assert(sp, "findFishingSpot returns a spot");
  const dist = Math.hypot(sp.x - player.x, sp.z - player.z);
  assert(dist >= FISHING.minRange - 1e-9 && dist <= FISHING.maxRange + 1e-9, `landing distance in range (${dist})`);
  assert(isWater(sp.x, sp.z), "landing is real water");
  assert(!onBridge(sp.x, sp.z) && !onDock(sp.x, sp.z), "landing is not on a bridge or dock");
  const dot = (sp.x - player.x) * (aim.x - player.x) + (sp.z - player.z) * (aim.z - player.z);
  assert(dot > 0, "landing is along the aim direction");
  if (expectedKind) assert.equal(sp.kind, expectedKind);
}

export function verifyFishing(): void {
  // --- initial state ---
  const m = new FishingModel();
  assert.equal(m.phase, "idle");
  assert.equal(m.active, false);
  const s0 = m.snapshot();
  assert.equal(s0.phase, "idle");
  assert.equal(s0.canCast, false);
  assert.equal(s0.spot, null);
  assert.equal(s0.fish, null);
  assert.equal(s0.progress, 0);
  assert.equal(s0.inBar, false);
  assert.equal(s0.held, false);
  assert.equal(s0.barSize, FISHING.barSize);
  assert.equal(s0.message, "");

  // --- canCast is a parent-published override, default false ---
  m.canCast = true;
  assert.equal(m.snapshot().canCast, true, "canCast reflects the parent publish");

  // --- findFishingSpot: river, sea, distance, forward, no bridge/dock ---
  const riverSpot = findFishingSpot({ x: -8, z: -10 }, { x: 0, z: -10 }, canStand);
  assertSpotValid(riverSpot, { x: -8, z: -10 }, { x: 0, z: -10 }, "river");

  const seaSpot = findFishingSpot({ x: 28, z: -23 }, { x: 40, z: -23 }, canStand);
  assertSpotValid(seaSpot, { x: 28, z: -23 }, { x: 40, z: -23 }, "sea");

  // distance limit: the only water in that direction is beyond maxRange.
  const tooFar = findFishingSpot({ x: 24, z: -23 }, { x: 40, z: -23 }, canStand);
  if (tooFar) {
    const d = Math.hypot(tooFar.x - 24, tooFar.z + 23);
    assert(d <= FISHING.maxRange + 1e-9, "a found spot is never beyond maxRange");
  }

  // cast across the river at a bridge's z: the whole river there is bridged -> no spot.
  const bridgeSpot = findFishingSpot({ x: -10, z: -20 }, { x: 0, z: -20 }, canStand);
  assert.equal(bridgeSpot, null, "a bridge crossing yields no landing spot");

  // a tree / fence placed right at the water's edge must still block the cast.
  const treeAtBank = findFishingSpot({ x: -8, z: -10 }, { x: 0, z: -10 }, obstacleAt(-6.2, -10));
  assert.equal(treeAtBank, null, "an obstacle hugging the water's edge blocks the path");

  // an obstacle further back also blocks.
  const wallMid = findFishingSpot({ x: -8, z: -10 }, { x: 0, z: -10 }, obstacleAt(-6.6, -10));
  assert.equal(wallMid, null, "an inland obstacle blocks the path");

  // no aim direction -> null.
  assert.equal(findFishingSpot({ x: 0, z: 0 }, { x: 0, z: 0 }, canStand), null);

  // --- valid / invalid cast gating ---
  const c = new FishingModel();
  assert.equal(c.cast(null as unknown as FishingSpot), false, "a null spot is rejected");
  assert.equal(c.cast({ x: NaN, z: -10, kind: "river" }), false, "a NaN-coordinate spot is rejected");
  assert.equal(c.cast({ x: 0, z: 0, kind: "river" }), false, "a land spot is rejected");
  assert.equal(c.cast({ x: 100, z: -10, kind: "river" }), false, "an out-of-bounds spot is rejected");
  assert.equal(c.cast({ x: 30, z: -23, kind: "river" }), false, "a sea location must declare kind 'sea'");
  assert.equal(c.cast({ x: -6, z: -10, kind: "invalid" as unknown as FishingSpot["kind"] }), false, "an unknown kind is rejected");
  assert(c.cast(SPOT), "cast from idle");
  assert.equal(c.phase, "casting");
  assert.equal(c.cast(SPOT), false, "cannot cast while casting");
  assert(c.cancel());
  assert.equal(c.phase, "idle");
  assert.equal(c.cancel(), false, "cancel from idle returns false");
  assert(c.cast(SPOT));
  advanceUntil(c, "waiting");
  assert.equal(c.cast(SPOT), false, "cannot cast while waiting");
  assert(c.cancel());
  assert.equal(c.phase, "idle");

  // --- update while idle is a genuine no-op (phaseTime stays 0) ---
  const idleNoop = new FishingModel();
  idleNoop.update(5);
  assert.equal(idleNoop.snapshot().phaseTime, 0, "update while idle does not accumulate phaseTime");

  // --- cast keeps its own copy of the spot; snapshot returns copies ---
  const copyCast = new FishingModel(seededRandom(5));
  const mutableSpot = { ...SPOT };
  copyCast.cast(mutableSpot);
  mutableSpot.x = 12345;
  assert.equal(copyCast.snapshot().spot!.x, SPOT.x, "the model copies the spot at cast time");
  const snapSpot = copyCast.snapshot();
  snapSpot.spot!.x = 9999;
  assert.notEqual(copyCast.snapshot().spot!.x, 9999, "snapshot spot is a copy, not an alias");
  copyCast.cancel();

  // --- waiting cannot skip the bite; press in waiting is a no-op ---
  const wait = new FishingModel();
  wait.cast(SPOT);
  advanceUntil(wait, "waiting");
  wait.press();
  assert.equal(wait.phase, "waiting", "press during waiting does not skip the bite");
  assert.equal(wait.snapshot().held, false);
  advanceUntil(wait, "bite");
  assert.equal(wait.phase, "bite");

  // --- bite window: hooking press, failure to press escapes -> escaped -> idle ---
  const escape = new FishingModel();
  escape.cast(SPOT);
  advanceUntil(escape, "waiting");
  advanceUntil(escape, "bite");
  assert.equal(escape.snapshot().fish, null, "no fish before hooking");
  advanceUntil(escape, "escaped");
  assert.equal(escape.phase, "escaped");
  assert.equal(escape.takeCatch(), null, "an escaped fish is never awarded");
  advanceUntil(escape, "idle");
  assert.equal(escape.phase, "idle");

  // --- hooking transitions bite -> reeling with held=true ---
  const hook = new FishingModel(seededRandom(7));
  enterReeling(hook);
  assert.equal(hook.snapshot().held, true, "hooking holds the bar");
  const fish = hook.snapshot().fish;
  assert(fish, "a fish species is assigned at hooking");
  assert(FISH[fish.id], "fish id is in the species table");
  assert.equal(FISH[fish.id].name, ITEMS[fish.id].name, "fish name is sourced from ITEMS");
  assert(fish.length >= FISH[fish.id].minLength && fish.length <= FISH[fish.id].maxLength, "length is within the species range");
  hook.release();
  assert.equal(hook.snapshot().held, false, "release lowers the hold");
  hook.cancel();
  assert.equal(hook.phase, "idle", "reeling can be cancelled");

  // --- biome pools: river only draws carp/perch, sea only sardine/redSnapper (parent pool check) ---
  sampleFishPool("river", SPOT, RIVER_POOL);
  sampleFishPool("sea", SEA_SPOT, SEA_POOL);

  // --- controlled reeling succeeds; catch stays ready in catching until claimed ---
  const success = new FishingModel(seededRandom(12345));
  enterReeling(success);
  chaseToCatch(success);
  assert.equal(success.snapshot().progress, 1, "progress fills on success");
  const hooked = success.snapshot().fish;
  assert(hooked && FISH[hooked.id], "the hooked fish carries through to the catch");
  assert.equal(success.takeCatch(), null, "catch is not claimable before the 1.55s completes");
  success.update(FISHING.catchSeconds);
  assert.equal(success.phase, "catching", "the landed fish waits in catching until claimed");
  assert.equal(success.active, true, "the session stays active until the catch is claimed");
  const claimed = success.takeCatch();
  assert(claimed, "the catch is claimable once");
  assert(FISH[claimed.id], "claimed id matches a species");
  assert.equal(FISH[claimed.id].name, ITEMS[claimed.id].name, "claimed fish name is from ITEMS");
  assert.equal(claimed.perfect, true, "a clean catch (never left the bar) is perfect");
  assert.equal(success.phase, "idle", "claiming the fish returns to idle");
  assert.equal(success.takeCatch(), null, "the catch is not repeatable");
  assert.equal(success.snapshot().fish, null, "the fish is cleared after claiming");

  // --- a catch after an early leave is landed but flagged non-perfect ---
  const imperfect = new FishingModel(seededRandom(777));
  enterReeling(imperfect);
  chaseWithLeave(imperfect);
  assert.equal(imperfect.snapshot().perfect, false, "the live bar reports non-perfect after a leave");
  imperfect.update(FISHING.catchSeconds);
  assert.equal(imperfect.phase, "catching");
  const landed = imperfect.takeCatch();
  assert(landed, "a catch after a leave is still claimable");
  assert.equal(landed.perfect, false, "the claimed fish carries the non-perfect flag");
  assert.equal(imperfect.snapshot().fish, null, "the imperfect catch is cleared after claiming");

  // cannot recast until the catch is claimed
  const recast = new FishingModel(seededRandom(99));
  enterReeling(recast);
  chaseToCatch(recast);
  recast.update(FISHING.catchSeconds);
  assert.equal(recast.phase, "catching");
  assert.equal(recast.cast(SPOT), false, "must claim the fish before casting again");
  assert(recast.takeCatch());
  assert.equal(recast.phase, "idle");
  assert(recast.cast(SPOT), "can cast again after claiming");

  // --- no-operation reeling genuinely fails ---
  const noOp = new FishingModel(seededRandom(3));
  enterReeling(noOp);
  for (let i = 0; i < 40 * 120; i++) noOp.update(1 / 120);
  assert.notEqual(noOp.phase, "reeling", "no-touch reeling cannot succeed");
  assert.equal(noOp.takeCatch(), null, "no-touch reeling awards nothing");
  assert.equal(noOp.phase, "idle");

  // --- dt = 0 / NaN / negative are no-ops ---
  const noop = new FishingModel(seededRandom(11));
  noop.cast(SPOT);
  const beforeNoop = noop.snapshot();
  noop.update(0);
  noop.update(NaN);
  noop.update(-0.5);
  assert.deepEqual(noop.snapshot(), beforeNoop, "0/NaN/negative dt do not advance the model");

  // --- huge dt is bounded (60s at most) and settles to idle, without hanging ---
  const huge = new FishingModel(seededRandom(4));
  enterReeling(huge);
  huge.update(1e9);
  assert.equal(huge.phase, "idle", "a huge dt is bounded and finishes the session");

  // --- reset clears everything ---
  const reset = new FishingModel(seededRandom(21));
  enterReeling(reset);
  reset.reset();
  const sr = reset.snapshot();
  assert.equal(sr.phase, "idle");
  assert.equal(sr.spot, null);
  assert.equal(sr.fish, null);
  assert.equal(sr.progress, 0);
  assert.equal(sr.held, false);

  // --- inventory slot selection: stack reuse, empty fallback, equipment excluded, full bag ---
  const bag = new InventoryModel();
  const beforeBag = bag.snapshot();
  const emptySlot = inventoryCatchSlot(bag, "carp");
  assert.notEqual(emptySlot, null, "fresh bag returns a normal slot");
  const emptyIdx = emptySlot as number;
  assert(!isEquipmentSlot(emptyIdx), "fresh bag returns a normal (non-equipment) slot");
  assert.equal(bag.slots[emptyIdx], null);
  assert.deepEqual(bag.snapshot(), beforeBag, "inventoryCatchSlot never mutates the bag");

  putFish(bag, 6, "carp", 1);
  assert.equal(inventoryCatchSlot(bag, "carp"), 6, "an existing partial fish stack is reused");

  putFish(bag, 7, "sardine", 1);
  assert.equal(inventoryCatchSlot(bag, "perch"), 8, "a different species falls through to an empty slot");

  // full backpack: no stackable fish, no empty normal slot -> null
  const full = new InventoryModel();
  full.buyBackpack();
  for (let i = 0; i < full.slots.length; i++) {
    if (!isEquipmentSlot(i)) full.slots[i] = { id: "wood", count: 30 };
  }
  assert.equal(full.slots.length, 23);
  assert.equal(inventoryCatchSlot(full, "carp"), null, "a full bag returns null");

  // when only equipment slots are non-empty, an empty normal slot must still win
  const equip = new InventoryModel();
  const slot = inventoryCatchSlot(equip, "carp");
  if (slot === null) assert.fail("expected a slot for an empty bag");
  assert(!isEquipmentSlot(slot), "never picks an equipment slot");

  // --- castPowerAt triangle wave: endpoints, rise/fall, repeats, NaN/negative ---
  assert.equal(castPowerAt(0), 0, "triangle starts at 0");
  assert(approx(castPowerAt(FISHING.chargeSeconds), 1), "triangle peaks at the charge apex");
  assert(approx(castPowerAt(2 * FISHING.chargeSeconds), 0), "triangle returns to 0 after a full round trip");
  assert(approx(castPowerAt(3 * FISHING.chargeSeconds), 1), "triangle repeats on the next rise");
  assert(approx(castPowerAt(4 * FISHING.chargeSeconds), 0), "triangle repeats on the next fall");
  assert(approx(castPowerAt(FISHING.chargeSeconds / 2), 0.5), "midpoint of the rise is 0.5");
  assert(approx(castPowerAt(FISHING.chargeSeconds * 1.5), 0.5), "midpoint of the fall is 0.5");
  const period = 2 * FISHING.chargeSeconds;
  for (const s of [0.3, 0.9, 1.5]) {
    assert(approx(castPowerAt(s), castPowerAt(s + period)), "triangle is exactly periodic");
    assert(approx(castPowerAt(s), castPowerAt(s + 2 * period)), "triangle is exactly periodic over two periods");
  }
  assert(castPowerAt(0.1) < castPowerAt(0.5) && castPowerAt(0.5) < castPowerAt(1.0), "rise is strictly monotonic");
  assert.equal(castPowerAt(NaN), 0, "NaN power is coerced to 0");
  assert.equal(castPowerAt(Number.POSITIVE_INFINITY), 0, "Infinity power is coerced to 0");
  assert.equal(castPowerAt(-1), 0, "negative power is coerced to 0");
  assert.equal(castPowerAt(-0.1), 0, "a small negative power is coerced to 0");

  // --- charging: begin from idle, hold never auto-casts, release + parent cast fires ---
  const charge = new FishingModel(seededRandom(31));
  assert.equal(charge.beginCharge(), true, "charge starts from idle");
  assert.equal(charge.phase, "charging");
  assert.equal(charge.snapshot().held, true, "charging holds the rod");
  assert.equal(charge.snapshot().castPower, 0, "charge starts at power 0");
  assert.equal(charge.beginCharge(), false, "cannot begin a charge while already charging");
  charge.update(0.3);
  assert(approx(charge.snapshot().castPower, castPowerAt(0.3)), "charging power tracks the triangle wave");
  // holding arbitrarily long never auto-casts or hooks.
  charge.update(FISHING.chargeSeconds * 4);
  assert.equal(charge.phase, "charging", "a long hold never auto-casts");
  assert.equal(charge.snapshot().held, true);
  const tBefore = charge.snapshot().phaseTime;
  charge.release();
  assert.equal(charge.snapshot().held, false, "release clears the hold in charging");
  assert.equal(charge.phase, "charging", "release does not fire the cast by itself");
  assert.equal(charge.cast(SPOT), true, "the parent can cast from charging");
  assert.equal(charge.phase, "casting");
  assert(approx(charge.snapshot().castPower, castPowerAt(tBefore)), "the cast preserves the released power");
  charge.cancel();
  assert.equal(charge.phase, "idle", "a charged cast still cancels to idle");

  // --- charging pause: 0 / NaN / negative dt are no-ops ---
  const chargeNoop = new FishingModel(seededRandom(33));
  assert(chargeNoop.beginCharge());
  chargeNoop.update(0.2);
  const beforePause = chargeNoop.snapshot();
  chargeNoop.update(0);
  chargeNoop.update(NaN);
  chargeNoop.update(-0.1);
  assert.deepEqual(chargeNoop.snapshot(), beforePause, "0/NaN/negative dt do not advance charging");

  // --- charging cancel / reset return to idle and clear power ---
  const chCancel = new FishingModel(seededRandom(35));
  assert(chCancel.beginCharge());
  assert.equal(chCancel.cancel(), true, "charging can be cancelled");
  assert.equal(chCancel.phase, "idle");
  assert.equal(chCancel.snapshot().castPower, 0, "cancel clears the charge power");
  assert(chCancel.beginCharge());
  chCancel.update(0.5);
  assert(chCancel.snapshot().castPower > 0, "charge accumulates power while held");
  chCancel.reset();
  assert.equal(chCancel.phase, "idle", "reset from charging returns to idle");
  assert.equal(chCancel.snapshot().castPower, 0, "reset clears the charge power");
  assert.equal(chCancel.snapshot().held, false);

  // --- a plain (non-charged) idle cast remains compatible and carries power 0 ---
  const plainCast = new FishingModel(seededRandom(37));
  assert.equal(plainCast.cast(SPOT), true, "idle cast is still accepted");
  assert.equal(plainCast.snapshot().phase, "casting");
  assert.equal(plainCast.snapshot().castPower, 0, "a non-charged cast carries power 0");

  // --- findFishingSpot power: strictly monotonic distance, always legal water ---
  const RIVER_FROM = { x: -8, z: -10 };
  const RIVER_AIM = { x: 0, z: -10 };
  const p0 = findFishingSpot(RIVER_FROM, RIVER_AIM, canStand, 0);
  const p025 = findFishingSpot(RIVER_FROM, RIVER_AIM, canStand, 0.25);
  const p05 = findFishingSpot(RIVER_FROM, RIVER_AIM, canStand, 0.5);
  const p075 = findFishingSpot(RIVER_FROM, RIVER_AIM, canStand, 0.75);
  const p1 = findFishingSpot(RIVER_FROM, RIVER_AIM, canStand, 1);
  assert(p0 && p025 && p05 && p075 && p1, "every power level finds a river spot");
  const d0 = Math.hypot(p0!.x - RIVER_FROM.x, p0!.z - RIVER_FROM.z);
  const d025 = Math.hypot(p025!.x - RIVER_FROM.x, p025!.z - RIVER_FROM.z);
  const d05 = Math.hypot(p05!.x - RIVER_FROM.x, p05!.z - RIVER_FROM.z);
  const d075 = Math.hypot(p075!.x - RIVER_FROM.x, p075!.z - RIVER_FROM.z);
  const d1 = Math.hypot(p1!.x - RIVER_FROM.x, p1!.z - RIVER_FROM.z);
  assert(d0 < d025 && d025 < d05 && d05 < d075 && d075 < d1, "identical aimed river casts land strictly farther with power");
  for (const s of [p0, p025, p05, p075, p1]) assertSpotValid(s, RIVER_FROM, RIVER_AIM, "river");
  // full power never punches through the far bank to land: it stays inside the run.
  assert(d1 < FISHING.maxRange, "river full power stays inside the water run");
  assert(!onBridge(p1!.x, p1!.z) && !onDock(p1!.x, p1!.z), "river full power never lands on a bridge or dock");
  assert.deepEqual(findFishingSpot(RIVER_FROM,RIVER_AIM,(x,z)=>x<=p1.x&&canStand(x,z),1),p1,"A blocked far bank does not reject a cast that lands before it");

  // --- sea casting: min power lands at the near end, max power casts farther ---
  const SEA_FROM = { x: 28, z: -23 };
  const SEA_AIM = { x: 40, z: -23 };
  const sMin = findFishingSpot(SEA_FROM, SEA_AIM, canStand, 0);
  const sMax = findFishingSpot(SEA_FROM, SEA_AIM, canStand, 1);
  assert(sMin && sMax, "sea casting works at min and max power");
  assert.equal(sMin.kind, "sea");
  assert.equal(sMax.kind, "sea");
  const sdMin = Math.hypot(sMin!.x - SEA_FROM.x, sMin!.z - SEA_FROM.z);
  const sdMax = Math.hypot(sMax!.x - SEA_FROM.x, sMax!.z - SEA_FROM.z);
  assert(sdMax > sdMin, "open sea casts strictly farther at max power");
  assert(sdMax > sdMin * 1.5, "sea far end sits substantially beyond the near end");
  assert(sdMin >= FISHING.minRange - 1e-9 && sdMin <= FISHING.maxRange + 1e-9, "sea min power stays in range");
  assert(sdMax <= FISHING.maxRange + 1e-9, "sea max power stays in range");
  for (const s of [sMin, sMax]) assertSpotValid(s, SEA_FROM, SEA_AIM, "sea");

  // --- out-of-range power is clamped; non-finite power returns null ---
  assert.deepEqual(findFishingSpot(RIVER_FROM, RIVER_AIM, canStand, -0.5), p0, "negative power clamps to 0");
  assert.deepEqual(findFishingSpot(RIVER_FROM, RIVER_AIM, canStand, 1.5), p1, "over-1 power clamps to 1");
  assert.equal(findFishingSpot(RIVER_FROM, RIVER_AIM, canStand, NaN), null, "NaN power yields no spot");
  assert.equal(
    findFishingSpot(RIVER_FROM, RIVER_AIM, canStand, Number.POSITIVE_INFINITY),
    null,
    "Infinity power yields no spot",
  );

  // --- casting from a bridge toward the side still reaches the outer water ---
  const bridgeSide = findFishingSpot({ x: -4, z: -20 }, { x: -4, z: -10 }, canStand);
  assertSpotValid(bridgeSide, { x: -4, z: -20 }, { x: -4, z: -10 }, "river");

  console.log(
    `Fishing regression passed: ${Object.keys(FISH).length} species, phase machine ` +
      `(cast/wait/bite/reel/catch/escape), spot validation (river/sea/distance/bridge/dock/water-edge obstacle), ` +
      `controlled success vs no-op failure, bounded dt, cancel/reset, catch-once, inventory stacking and full-bag capacity, ` +
      `charge triangle wave, hold-vs-release casting, and power-scaled landing (monotonic / always-water / sea min-max).`,
  );
}

verifyFishing();
