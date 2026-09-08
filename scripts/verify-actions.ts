import assert from "node:assert/strict";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { InventoryModel,BASE_SLOTS,MAIN_SLOTS } from "../components/game/inventory";
import { FarmModel,inReach,sweepTiles,tileKey,type Point } from "../components/game/farming";
import { CombatModel,createCombat,SLIME_HEALTH } from "../components/game/combat";
import { inForest } from "../components/game/geography";
import { createActionEffects } from "../components/game/actionEffects";
import type { buildWorld } from "../components/game/world";

export function verifyActions(scene:Scene,world:ReturnType<typeof buildWorld>,shadow:ShadowGenerator){
  const bag=new InventoryModel();assert.equal(bag.hand,"hoe");bag.select(4);assert.equal(bag.hand,"pistol");bag.select(5);assert.equal(bag.hand,"sword");
  const original=bag.snapshot();assert(!bag.move(0,12).ok);assert.deepEqual(bag.snapshot(),original,"An invalid equipment drop never swaps or deletes either item");
  assert(bag.move(12,9).ok);assert.equal(bag.slots[12],null);assert(bag.move(9,12).ok);assert.equal(bag.slots[12]!.id,"hat");
  assert(bag.buyBackpack().ok);assert.equal(bag.slots[14]!.id,"backpack");assert.equal(bag.slots.length,BASE_SLOTS+8);
  assert(bag.move(0,BASE_SLOTS).ok);const packed=bag.snapshot();
  assert(!bag.move(14,9).ok);assert.equal(bag.drop(14),null);assert(!bag.sell(14).ok);assert.deepEqual(bag.snapshot(),packed,"A full backpack cannot be detached, discarded or sold");
  assert(bag.move(BASE_SLOTS,0).ok);assert(!bag.move(14,BASE_SLOTS).ok,"A backpack cannot contain itself");
  assert(bag.move(14,9).ok);assert(!bag.backpack);assert.equal(bag.slots.length,BASE_SLOTS);assert(bag.move(9,14).ok);assert(bag.backpack);
  const full=new InventoryModel();for(let i=0;i<MAIN_SLOTS;i++)full.slots[i]={id:"wood",count:30};
  full.slots[12]=full.slots[13]=null;assert(!full.add([{id:"wood",count:1}]),"Empty equipment slots cannot silently accept storage items");
  const tiles=Array.from({length:7},(_,x)=>Array.from({length:7},(_,z)=>({x:x-3,z:z-3,kind:"dirt" as const}))).flat();
  const player={x:.5,z:.5};
  for(const aim of [{x:.5,z:-20},{x:.5,z:20},{x:20,z:.5},{x:-20,z:.5}]){
    const farm=new FarmModel(tiles),row=sweepTiles(player,aim);
    for(const t of tiles)farm.seedExample(t.x,t.z,24);
    const nearest=farm.resolveTarget(aim,player)!;assert(inReach(player,nearest));
    const result=farm.harvestArea(player,aim);assert(result.ok);assert.equal(result.tiles.length,3);assert.equal(farm.inventory.turnips,3);
    assert.deepEqual(new Set(result.tiles.map(t=>tileKey(t.x,t.z))),new Set(row.map(t=>tileKey(t.x,t.z))));
    assert(farm.get(0,0)!.crop,"A sweep does not harvest underneath or behind the player");
  }
  const field=new FarmModel(tiles);
  for(const aim of [{x:-50,z:-50},{x:48,z:-20},{x:-.3,z:.7},{x:0,z:-99}]){
    const target=field.resolveTarget(aim,player)!;assert(inReach(player,target));
    const score=(p:Point)=>(p.x+.5-aim.x)**2+(p.z+.5-aim.z)**2;
    for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)assert(score(target)<=score({x,z})+1e-8,"Out-of-range input snaps to the closest displayed tile");
  }
  const blocked=new FarmModel(tiles,(_,p)=>p.x<1);for(const p of sweepTiles(player,{x:.5,z:-5}))blocked.seedExample(p.x,p.z,24);
  assert.equal(blocked.harvestArea(player,{x:.5,z:-5}).tiles.length,2,"A sweep never harvests through an obstacle");
  const crowded=new FarmModel(tiles);for(const p of sweepTiles(player,{x:.5,z:-5}))crowded.seedExample(p.x,p.z,24);
  for(let i=0;i<MAIN_SLOTS;i++)crowded.bag.slots[i]={id:"wood",count:30};crowded.bag.slots[0]={id:"scythe",count:1};crowded.bag.slots[1]={id:"turnip",count:18};crowded.bag.slots[2]={id:"seeds",count:98};
  const before=crowded.bag.snapshot();assert(!crowded.harvestArea(player,{x:.5,z:-5}).ok);assert.deepEqual(crowded.bag.snapshot(),before);assert(sweepTiles(player,{x:.5,z:-5}).every(p=>crowded.get(p.x,p.z)!.crop),"Insufficient capacity preserves every crop in the sweep");

  const model=new CombatModel(()=>true,()=>true),origin={x:-24,z:12};
  model.slimes.forEach((s,i)=>Object.assign(s,{x:-41,z:32+i*.1,wait:100}));
  Object.assign(model.slimes[0],{x:-24,z:10.8});Object.assign(model.slimes[1],{x:-23,z:11});Object.assign(model.slimes[2],{x:-24,z:13});
  const attack=model.attack("sword",origin,{x:-24,z:2});assert.equal(attack.hits,2);assert.equal(model.slimes[2].hp,SLIME_HEALTH,"A sword does not hit behind the player");assert(!model.attack("sword",origin,{x:-24,z:2}).fired,"Held or repeated input respects weapon cooldown");
  for(let i=0;i<6;i++)model.update(.1);
  assert(model.attack("pistol",origin,{x:-24,z:2}).fired);let hits=0;for(let i=0;i<40;i++)hits+=model.update(.02);
  assert.equal(hits,1);assert.equal(model.slimes[0].hp,0,"Projectiles damage and defeat the first intersected slime");
  for(let i=0;i<160;i++)model.update(.2);assert.equal(model.slimes[0].hp,SLIME_HEALTH,"Defeated slimes eventually respawn");
  const wall=new CombatModel(()=>true,(a,b)=>!(a.z>=11.5&&b.z<11.5));wall.slimes.forEach(s=>Object.assign(s,{x:-41,z:32,wait:100}));Object.assign(wall.slimes[0],{x:-24,z:11});
  assert.equal(wall.attack("sword",origin,{x:-24,z:9}).hits,0);for(let i=0;i<6;i++)wall.update(.1);wall.attack("pistol",origin,{x:-24,z:9});for(let i=0;i<20;i++)wall.update(.02);assert.equal(wall.slimes[0].hp,SLIME_HEALTH,"Bullets and sword slashes both stop at barriers");
  const view=createCombat(scene,shadow,world.canWalk,world.clearReach),effects=createActionEffects(scene);assert(view.model.slimes.length>=8);
  const count=scene.meshes.length;for(let i=0;i<120;i++)view.update(.1,true);
  for(const s of view.model.slimes)assert(inForest(s.x,s.z)&&world.canWalk(s.x,s.z,.39),"Slimes wander on clear forest ground");
  effects.swing(player,0,"scythe");effects.update(.1,true);assert(effects.mesh.isEnabled()&&effects.mesh.visibility>0);effects.update(.25,true);assert(!effects.mesh.isEnabled());
  assert.equal(scene.meshes.length,count,"Attacks and wandering reuse their mesh pools");
  console.log("Action regression passed: equipment validation, backpack safety, nearest reachable tile, three-cell directional harvest, capacity conservation, weapon cooldown, barriers, health, respawn and pooled effects.");
}
