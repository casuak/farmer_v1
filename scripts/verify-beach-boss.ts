import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { createFarmCamera } from "../components/game/engine";
import { createSpringLighting } from "../components/game/lighting";
import { buildWorld } from "../components/game/world";
import { BeachBossModel, BOSS, onBossBeach, PlayerHealth } from "../components/game/beachBoss";
import { CombatModel, type Hittable } from "../components/game/combat";
import { BOUNDS, FARM_SPAWN } from "../components/game/geography";

/* ------------------------------------------------------------------ *
 * Verification harness: a tiny assertion collector so a geometry bug
 * in the shipped code surfaces as a named failure instead of aborting.
 * ------------------------------------------------------------------ */
let passed = 0;
const failures: { name: string; error: string }[] = [];
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    const lines = (e instanceof Error ? e.stack ?? String(e) : String(e)).split("\n");
    failures.push({ name, error: lines.slice(0, 5).join("\n") });
  }
}

/* ---------------- real world + boss setup (NullEngine) ---------------- */
let canWalk: (x: number, z: number, r?: number) => boolean;
let clearLine: (a: { x: number; z: number }, b: { x: number; z: number }) => boolean;
let residents: Hittable[];
const engine = new NullEngine();
const scene = new Scene(engine);
try {
  engine.getCaps().maxTextureSize = 4096;
  engine.getCaps().maxRenderTextureSize = 4096;
  const camera = createFarmCamera(scene);
  camera.orthoTop = 16; camera.orthoBottom = -16; camera.orthoLeft = -26; camera.orthoRight = 26;
  const lighting = createSpringLighting(scene, camera);
  const w = buildWorld(scene, lighting.shadow);
  canWalk = w.canWalk;
  clearLine = (a, b) => w.clearReach(a, b);
  residents = w.residents.residents;
} catch (e) {
  failures.push({ name: "setup(3D world build)", error: String(e) });
}

const mkBoss = () => new BeachBossModel(canWalk, clearLine);
const playerOnBeach = (p: { x: number; z: number }) => onBossBeach(p.x, p.z, 0);
const bossOnField = (p: { x: number; z: number }) => onBossBeach(p.x, p.z, BOSS.bodyRadius) && canWalk(p.x, p.z, BOSS.bodyRadius);
const assertEnvelope = (boss: BeachBossModel) => {
  const p = boss.position;
  assert(onBossBeach(p.x, p.z, BOSS.bodyRadius), `envelope: boss left the beach (${p.x.toFixed(2)},${p.z.toFixed(2)}) phase=${boss.phase}`);
  assert(canWalk(p.x, p.z, BOSS.bodyRadius), `envelope: boss left walkable ground (${p.x.toFixed(2)},${p.z.toFixed(2)}) phase=${boss.phase}`);
};
const advance = (boss: BeachBossModel, seconds: number, player: { x: number; z: number }) => {
  let acc = 0; const dt = 1 / 60;
  while (acc + dt <= seconds + 1e-9) { boss.update(dt, player); acc += dt; }
  if (acc < seconds - 1e-9) boss.update(seconds - acc, player);
};
const advanceTo = (boss: BeachBossModel, player: { x: number; z: number }, phase: string, maxSeconds = 8) => {
  let time = 0;
  while (boss.phase !== phase && time < maxSeconds) { boss.update(1 / 60, player); time += 1 / 60; }
  assert.equal(boss.phase, phase, `boss did not reach ${phase} in ${maxSeconds}s (at ${boss.phase}, pos ${boss.position.x.toFixed(2)},${boss.position.z.toFixed(2)}, t=${time.toFixed(2)})`);
};
// A resident that stands near the home pocket, as part of the world — never handed to the boss AI.
const residentNearHome = { x: 24, z: -16 };
const near = { x: 24, z: -16 };
const chargeNear={x:26,z:-16};
const far = { x: 0, z: -16 };
const offBeach = { x: 0, z: 0 };

t("home is an unobstructed beach pocket with a connected nav graph", () => {
  // Constructing the model re-validates home walkability; it throws if not.
  assert(bossOnField(BOSS.home), `boss home (${BOSS.home.x},${BOSS.home.z}) on beach + walkable`);
  assert(playerOnBeach(near), "near player is on the boss beach");
  assert(playerOnBeach(far), "far player is still on beach (only distance differs)");
  assert(!playerOnBeach(offBeach), "town/land point is not the boss beach");
});

t("world reachability: beach home (22,-16) connects to the player spawn by walkable tiles", () => {
  const r = 0.27; // the player collision radius used across the whole world
  const wf = (ix: number, iz: number) => canWalk(ix + 0.5, iz + 0.5, r);
  const key = (ix: number, iz: number) => `${ix},${iz}`;
  const sx = Math.floor(FARM_SPAWN.x), sz = Math.floor(FARM_SPAWN.z);
  const home = { x: Math.floor(BOSS.home.x), z: Math.floor(BOSS.home.z) };
  const seen = new Set<string>([key(sx, sz)]);
  const queue: [number, number][] = [[sx, sz]];
  let reached = sx === home.x && sz === home.z;
  let count = 0;
  while (queue.length) {
    const [x, z] = queue.shift()!;
    count++;
    if (x === home.x && z === home.z) reached = true;
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < -BOUNDS.x || nx >= BOUNDS.x || nz < -BOUNDS.z || nz >= BOUNDS.z) continue;
      const k = key(nx, nz);
      if (seen.has(k) || !wf(nx, nz)) continue;
      seen.add(k); queue.push([nx, nz]);
    }
  }
  assert(wf(home.x, home.z), `home tile (${home.x},${home.z}) is itself walkable`);
  assert(reached, `boss home ${BOSS.home.x},${BOSS.home.z} is NOT reachable from the player spawn via walkable tiles`);
  assert(count >= 1000, `reachable landmass from spawn is suspiciously small (${count} tiles)`);
  console.log(`  [reachability] spawn tile (${sx},${sz}) reaches ${count} walkable tiles; beach boss home (${home.x},${home.z}) connected.`);
});

t("idle: only the given (far) player is considered; NPC residents are not boss AI", () => {
  const boss = mkBoss();
  assert(residents.length > 0, "world residents exist");
  // A villager stands next to the boss, but the boss is never handed any villager list.
  assert(bossOnField(residentNearHome), "test resident is on the beach near home");
  advance(boss, 4, far);
  assert.equal(boss.phase, "idle", `far player must not aggro (phase=${boss.phase})`);
  assert.deepEqual(boss.takeEvents(), [], "no alert/aggro events with a far player");
  assert.equal(boss.snapshot(far, 5, 5, false).visible, false, "HUD hidden while the player is far");
  assertEnvelope(boss);
});

t("near beach player drives idle → alert → chase → windup", () => {
  const boss = mkBoss();
  advanceTo(boss, chargeNear, "windup");
  const events = boss.takeEvents();
  assert(events.some(e => e.type === "alert"), "alert raised");
  assert(events.some(e => e.type === "windup"), "windup begun");
  assert(boss.telegraph, "windup holds a charge telegraph");
});

t("windup locks its telegraph (no re-aim) for the complete .82s warning", () => {
  const boss = mkBoss();
  advanceTo(boss, chargeNear, "windup");
  const lane = { start: { ...boss.telegraph!.start }, end: { ...boss.telegraph!.end }, width: boss.telegraph!.width };
  assert.equal(lane.width, BOSS.chargeWidth, "charge capsule width matches BOSS.chargeWidth");
  // Player dashes away during the windup — the frozen lane must not follow.
  const dodger = { x: 24, z: -13.5 };
  advanceTo(boss, dodger, "charge");
  assert.deepEqual({ ...boss.telegraph!.start }, lane.start, "windup start not re-aimed");
  assert.deepEqual({ ...boss.telegraph!.end }, lane.end, "windup end not re-aimed");
  assert.equal(boss.telegraph!.width, lane.width, "windup width unchanged");
  // A fresh boss: measure the windup dwell time before the charge.
  const b2 = mkBoss();
  advanceTo(b2, chargeNear, "windup");
  let dwell = 0, peak = 0;
  while (b2.phase === "windup") { b2.update(1 / 60, near); dwell += 1 / 60; peak = Math.max(peak, b2.telegraph?.progress ?? 0); }
  assert(dwell >= BOSS.windupSeconds - 1e-9, `windup lasted ${dwell.toFixed(3)}s`);
  assert(dwell<1,"Stronger boss telegraphs faster but never skips its tell");
  assert.equal(b2.phase, "charge");
  assert(peak <= 1.001, "telegraph progress clamps at 1");
  assertEnvelope(b2);
});

t("charge capsule 2.5: standing on the route is hit exactly once, even with dt=0.25 (no tunnelling)", () => {
  const boss = mkBoss();
  advanceTo(boss, chargeNear, "windup");
  advanceTo(boss, near, "charge"); // keep player on the route
  boss.takeEvents(); // discard alert/windup/charge markers
  let guard = 0;
  while (boss.phase === "charge" && guard++ < 20) boss.update(0.25, near); // deliberately big frames
  const hits = boss.takeEvents().filter(e => e.type === "playerHit");
  assert.equal(hits.length, 1, `standing on route: expected one hit, got ${hits.length}`);
  assert.equal(hits[0].damage, BOSS.chargeDamage);
  assert(boss.phase === "recover" || boss.phase === "chase", `charge ends into recover/chase (got ${boss.phase})`);
  assertEnvelope(boss);
});

t("charge capsule 2.5: a sideways dodge clears the frozen lane", () => {
  const boss = mkBoss();
  advanceTo(boss, chargeNear, "windup");
  const dodger = { x: 24, z: -13.5 };
  advanceTo(boss, dodger, "charge"); // sidestep during the windup
  boss.takeEvents();
  let guard = 0;
  while (boss.phase === "charge" && guard++ < 20) boss.update(0.25, dodger);
  assert.equal(boss.takeEvents().filter(e => e.type === "playerHit").length, 0, "sidestep dodges the charge");
  assert(Math.abs(boss.position.z - (-16)) < 1.1, "charge runs along the locked lane, not toward the dodger");
  assertEnvelope(boss);
});

t("player leaving the beach or boarding a boat cancels warn/charge and returns", () => {
  for (const off of [{ ...offBeach }, { x: 24, z: -16, aboard: true }]) {
    const boss = mkBoss();
    advanceTo(boss, chargeNear, "windup");
    assert(boss.telegraph, "windup armed before the player leaves");
    boss.setPlayer(off as never);
    boss.update(1 / 60, off as never);
    assert.equal(boss.phase, "return", `expected return after player left (got ${boss.phase})`);
    assert.equal(boss.telegraph, null, "telegraph cleared on disengage");
    assertEnvelope(boss);
  }
});

t("returning boss pathfinds home around obstacles, regains full HP, re-enters idle", () => {
  const boss = mkBoss();
  advanceTo(boss, near, "chase");
  boss.setPlayer(near);
  const dealt = boss.hurt(10, near, "sword");
  assert.equal(dealt, 10, "boss takes real damage before leaving");
  assert.equal(boss.hp, BOSS.maxHp - 10);
  boss.disengage();
  assert.equal(boss.phase, "return");
  boss.takeEvents();
  let steps = 0;
  while ((boss.phase as string) !== "idle" && steps++ < 3000) { boss.update(1 / 30, far); assertEnvelope(boss); }
  assert.equal(boss.phase, "idle", `boss never reached home (${boss.position.x.toFixed(2)},${boss.position.z.toFixed(2)}, phase=${boss.phase})`);
  assert.equal(boss.hp, BOSS.maxHp, "boss regens to full when it reaches home");
  assert(Math.hypot(boss.position.x - BOSS.home.x, boss.position.z - BOSS.home.z) < 0.5, "boss stands at home");
});

t("weapons deal real HP through combat.model.setEnemies; miss deals nothing", () => {
  const boss = mkBoss();
  boss.setPlayer(near);
  const combat = new CombatModel(canWalk, clearLine, []);
  combat.setEnemies([boss.enemy]);

  // Sword: 2 damage to the enemy hook.
  combat.attack("sword", near, { x: BOSS.home.x, z: BOSS.home.z });
  assert.equal(boss.hp, BOSS.maxHp - 2, "sword deals 2 through the enemy hook");
  const swordHits = combat.takeHits();
  assert.equal(swordHits.length, 1);
  assert.equal(swordHits[0].damage, 2);
  assert.equal(swordHits[0].height, 2.5, "boss damage number floats at height 2.5");
  assert.deepEqual(combat.takeVictims(), [], "boss hit never enters the villager victims list");

  // Miss: aim away, far outside the sword cone. Use a fresh combat + boss so
  // the miss is clean regardless of the cooldown left by the hit above.
  const boss2 = mkBoss();
  boss2.setPlayer(near);
  const combat2 = new CombatModel(canWalk, clearLine, []);
  combat2.setEnemies([boss2.enemy]);
  combat2.attack("sword", near, { x: 24, z: 6 }); // aim due north, boss sits west — out of the cone
  assert.equal(boss2.hp, BOSS.maxHp, "a sword swung away from the boss deals no damage");
  assert.equal(combat2.takeHits().length, 0);
  assert.equal(combat2.takeVictims().length, 0);

  // Pistol: bullet flies the line and lands 1 damage.
  const boss3 = mkBoss();
  boss3.setPlayer(near);
  const combat3 = new CombatModel(canWalk, clearLine, []);
  combat3.setEnemies([boss3.enemy]);
  assert(combat3.attack("pistol", near, { x: BOSS.home.x, z: BOSS.home.z }).fired, "pistol fires");
  let guard = 0;
  while (boss3.hp === BOSS.maxHp && guard++ < 60) combat3.update(1 / 60);
  assert.equal(boss3.hp, BOSS.maxHp - 1, "pistol bullet lands 1 damage on the boss");
  const pistolHits = combat3.takeHits();
  assert.equal(pistolHits[0].damage, 1);
  assert.equal(pistolHits[0].height, 2.5);
  assert.deepEqual(combat3.takeVictims(), [], "pistol boss hit is not a villager victim");
});

t("boss being hurt never scares or damages an NPC (no takeVictims)", () => {
  let mockHurt = 0;
  const mockVillager: Hittable = { name: "Mock", cry: () => "!", root: { position: { x: 24, z: -6 } }, hurt() { mockHurt++; } };
  const boss = mkBoss();
  boss.setPlayer(near);
  const combat = new CombatModel(canWalk, clearLine, [mockVillager]);
  combat.setEnemies([boss.enemy]);
  combat.attack("sword", near, { x: BOSS.home.x, z: BOSS.home.z }); // hits the boss only
  assert.equal(mockHurt, 0, "the nearby villager is not hit when the boss is");
  assert.deepEqual(combat.takeVictims(), [], "no villager victim is queued");
  assert.equal(boss.hp, BOSS.maxHp - 2);
});

t("off-beach and aboard alive players reject boss damage", () => {
  for (const bad of [{ ...offBeach }, { x: 24, z: -16, aboard: true }]) {
    const boss = mkBoss();
    boss.setPlayer(bad as never);
    assert.equal(boss.hurt(10, bad as never, "sword"), 0, `off-field player ${JSON.stringify(bad)} cannot be hit through`);
    assert.equal(boss.hp, BOSS.maxHp, "boss HP unchanged");
  }
});

t("72 HP, single defeat event, no post-mortem heal or re-reward", () => {
  const boss = mkBoss();
  boss.setPlayer(near);
  boss.takeEvents();
  const dealt = boss.hurt(BOSS.maxHp, near, "sword");
  assert.equal(dealt, BOSS.maxHp, "lethal hit deals the remaining (capped) HP");
  assert.equal(boss.hp, 0);
  assert.equal(boss.phase, "defeated");
  const events = boss.takeEvents();
  assert.equal(events.filter(e => e.type === "defeat").length, 1, "exactly one defeat event");
  // Post-mortem: no heal, no more damage, no reward event.
  advance(boss, 3, near);
  assert.equal(boss.hp, 0, "a defeated boss never heals");
  assert.equal(boss.hurt(5, near, "sword"), 0, "a defeated boss takes no more damage");
  assert.equal(boss.takeEvents().filter(e => e.type === "defeat").length, 0, "no repeat defeat event");
  assert.equal(boss.alive, false);
  assertEnvelope(boss);
});

t("HUD snapshot: hidden far, shown near, hidden again 3s after defeat", () => {
  const boss = mkBoss();
  assert.equal(boss.snapshot(far, 5, 5, false).visible, false, "far player hides the HUD");
  assert.equal(boss.snapshot(near, 5, 5, false).visible, true, "near player shows the HUD");
  boss.setPlayer(near);
  boss.hurt(BOSS.maxHp, near, "sword");
  assert.equal(boss.phase, "defeated");
  advance(boss, 1, near); // phaseTime ~1
  assert.equal(boss.snapshot(near, 5, 5, false).visible, true, "still shown briefly after defeat");
  advance(boss, 2.2, near); // phaseTime ~3.2
  assert.equal(boss.snapshot(near, 5, 5, false).visible, false, "HUD hides 3s after defeat");
});

t("PlayerHealth: iframe, damage, out-of-combat heal, comb-hold, reset", () => {
  const ph = new PlayerHealth();
  assert.equal(ph.hp, 5);
  assert.equal(ph.maxHp, 5);
  assert(ph.hurt(1), "first damage lands");
  assert.equal(ph.hp, 4);
  assert.equal(ph.invulnerability, 1.2, "i-frames start after a hit");
  assert(!ph.hurt(1), "i-frames block a second hit");
  assert.equal(ph.hp, 4, "no HP lost while invulnerable");
  ph.update(1.3, false); // let i-frames expire
  assert(ph.hurt(1), "damage lands after i-frames lapse");
  assert.equal(ph.hp, 3);
  ph.update(3, false); // out of combat: heal every 3s
  assert.equal(ph.hp, 4, "heals one point after 3s out of combat");
  ph.update(3, false);
  assert.equal(ph.hp, 5, "heals back to full");
  ph.update(3, false);
  assert.equal(ph.hp, 5, "no over-heal past max");
  ph.hurt(1);
  ph.update(3, true); // in combat holds the heal timer
  assert.equal(ph.hp, 4, "no heal while in combat");
  ph.reset();
  assert.equal(ph.hp, 5);
  assert.equal(ph.invulnerability, 2);
  assert.equal(ph.flash, 0);
});

t("pause dt=0 freezes movement, telegraph and timers", () => {
  const boss = mkBoss();
  advanceTo(boss, chargeNear, "windup");
  boss.takeEvents(); // discard the alert/windup markers that reaching windup emits
  const frozen = { x: boss.position.x, z: boss.position.z, prog: boss.telegraph?.progress, phase: boss.phase };
  boss.update(0, near);
  assert.deepEqual({ x: boss.position.x, z: boss.position.z, prog: boss.telegraph?.progress, phase: boss.phase }, frozen, "dt=0 freezes the boss");
  assert.equal(boss.takeEvents().length, 0, "dt=0 emits no new events");

  const combat = new CombatModel(() => true, () => true);
  assert.equal(combat.update(0), 0);
  assert.equal(combat.takeHits().length, 0);

  const ph = new PlayerHealth();
  ph.hurt(1);
  const p = { hp: ph.hp, inv: ph.invulnerability, flash: ph.flash };
  ph.update(0, true);
  assert.deepEqual({ hp: ph.hp, inv: ph.invulnerability, flash: ph.flash }, p, "dt=0 freezes player health timers");
});

t("long beach patrol + chase never exits the full footprint and returns without teleporting", () => {
  const boss=mkBoss(),points=[{x:24,z:-16},{x:27,z:-12},{x:25,z:-4},{x:5,z:-8},{x:3,z:-27},{x:20,z:-35},{x:26,z:-30},{x:15,z:-14}];
  const before=residents.map(r=>(r as Hittable&{hp:number}).hp);
  for(const player of points.filter(p=>canWalk(p.x,p.z)&&onBossBeach(p.x,p.z))){
    for(let i=0;i<160;i++){const last={...boss.position};boss.update(.25,player);assertEnvelope(boss);assert(Math.hypot(last.x-boss.position.x,last.z-boss.position.z)<=BOSS.chargeSpeed*.25+.01,"no movement teleport");boss.takeEvents();}
  }
  boss.disengage();for(let i=0;i<240&&boss.phase!=="idle";i++){const last={...boss.position};boss.update(.25,offBeach);assertEnvelope(boss);assert(Math.hypot(last.x-boss.position.x,last.z-boss.position.z)<=BOSS.walkSpeed*.25+.01,"return follows walkable path, never teleports");}
  assert.equal(boss.phase,"idle",`return stopped at ${JSON.stringify(boss.position)}; path ${JSON.stringify((boss as unknown as {path:unknown}).path)} retreat ${JSON.stringify((boss as unknown as {retreat:unknown}).retreat)}`);assert(Math.hypot(boss.position.x-BOSS.home.x,boss.position.z-BOSS.home.z)<.3);assert.deepEqual(residents.map(r=>(r as Hittable&{hp:number}).hp),before,"boss never calls a resident damage hook");
});

t("leaving beach DURING moving charge immediately cancels and returns home",()=>{
  for(const aboard of [false,true]){
    const boss=mkBoss();advanceTo(boss,chargeNear,"charge");boss.update(.10,chargeNear);assert(Math.hypot(boss.position.x-BOSS.home.x,boss.position.z-BOSS.home.z)>1,"actually moving before leaving");boss.takeEvents();
    const escaped=aboard?{...near,aboard:true}:offBeach;boss.update(.016,escaped);assert.equal(boss.phase,"return");assert.equal(boss.telegraph,null);assert.equal(boss.takeEvents().filter(e=>e.type==="playerHit").length,0);
    for(let i=0;i<240&&String(boss.phase)!=="idle";i++){boss.update(.25,escaped);assertEnvelope(boss);}assert.equal(boss.phase,"idle");assert.equal(boss.hp,BOSS.maxHp);
  }
});

t("close range stomp has a full circular warning and one hit, then recovery",()=>{
  const boss=mkBoss();advanceTo(boss,near,"stompWindup");assert(boss.stomp);assert.equal(boss.stomp.radius,BOSS.stompRadius);boss.takeEvents();
  advance(boss,BOSS.stompWindup-.04,near);assert.equal(boss.takeEvents().filter(e=>e.type==="playerHit").length,0);
  advance(boss,.10,near);assert.equal(boss.phase,"stomp");const hits=boss.takeEvents().filter(e=>e.type==="playerHit");assert.equal(hits.length,1);assert.equal(hits[0].damage,1);
  advance(boss,.5,near);assert.equal(boss.takeEvents().filter(e=>e.type==="playerHit").length,0);assertEnvelope(boss);
});
t("half health enables a separately telegraphed two-charge combo and one enrage event",()=>{
  const boss=mkBoss();boss.setPlayer(chargeNear);boss.hurt(BOSS.maxHp/2,chargeNear,"sword");assert(boss.enraged);assert.equal(boss.takeEvents().filter(e=>e.type==="enrage").length,1);
  boss.hurt(1,chargeNear,"sword");assert.equal(boss.takeEvents().filter(e=>e.type==="enrage").length,0);
  advanceTo(boss,chargeNear,"windup");const first=JSON.stringify(boss.telegraph);assert.equal(boss.comboIndex,1);
  advanceTo(boss,chargeNear,"charge");advanceTo(boss,chargeNear,"recover");
  const target={...BOSS.home};assert(playerOnBeach(target));
  advanceTo(boss,target,"windup");assert.equal(boss.comboIndex,2);assert.notEqual(JSON.stringify(boss.telegraph),first,"Second attack warns its new direction rather than silently U-turning");
  let seconds=0;while(boss.phase==="windup"){boss.update(.01,target);seconds+=.01;}assert(seconds>=BOSS.comboWindup-.02);assert(seconds<.7);
  advanceTo(boss,target,"recover");advance(boss,.4,target);assert.equal(boss.phase,"recover","Real recovery opening after both charges");
  boss.disengage();advanceTo(boss,offBeach,"idle",60);assert(!boss.enraged);assert.equal(boss.hp,BOSS.maxHp);
});

/* ---------------- report + cleanup ---------------- */
const summary = { result: failures.length ? "passed-with-failures" : "passed", passed, failed: failures.length, failures };
console.log(JSON.stringify(summary, null, 2));
scene.dispose();
engine.dispose();
if (failures.length) process.exitCode = 1;
