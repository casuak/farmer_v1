import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GroundItems,createGroundItemView } from "../components/game/droppedItems";
import { InventoryModel,isEquipmentSlot } from "../components/game/inventory";
import { ORES,MINING_REACH } from "../components/game/mining";
import { createFarmCamera } from "../components/game/engine";
import { createSpringLighting } from "../components/game/lighting";
import { buildWorld } from "../components/game/world";

const engine=new NullEngine(),scene=new Scene(engine),camera=createFarmCamera(scene),lighting=createSpringLighting(scene,camera),world=buildWorld(scene,lighting.shadow);
const sums=(ground:GroundItems)=>ground.items.reduce((counts,item)=>{counts[item.stack.id]=(counts[item.stack.id]??0)+item.stack.count;return counts;},{} as Record<string,number>);
const ground=new GroundItems(),player={x:1,z:0},origin={x:0,y:.62,z:0};
const drops=ground.eject(ORES.copper.loot,origin,player,()=>true,()=>true),view=createGroundItemView(scene,ground,()=>0),bag=new InventoryModel(),before=bag.snapshot();
assert.equal(drops.length,2);assert.deepEqual(sums(ground),{copperOre:3,stone:2});assert(Math.hypot(drops[0].position.x-drops[1].position.x,drops[0].position.z-drops[1].position.z)>.58);
assert.equal(ground.nearest(player),null);assert(!ground.pickup(drops[0].id,bag).ok);assert.deepEqual(bag.snapshot(),before);
view.update(0,true);const start=view.center(drops[0].id)!;assert(Math.abs(start.y-origin.y)<.00001&&Math.hypot(start.x,start.z)<.00001,"Loot starts at the real ore center");
const state=JSON.stringify(ground.items);ground.update(0);ground.update(NaN);view.update(0,true);assert.equal(JSON.stringify(ground.items),state);assert(view.center(drops[0].id)!.equalsWithEpsilon(start),"Paused drop stays frozen");
const samples:number[]=[];let landed=0;
for(let i=0;i<110;i++){
  landed+=ground.update(.01);view.update(i*.01,true);samples.push(view.center(drops[0].id)!.y);
  for(const mesh of scene.meshes.filter(m=>m.name==="dropped-copperOre"||m.name==="dropped-stone")){mesh.computeWorldMatrix(true);assert(mesh.getBoundingInfo().boundingBox.minimumWorld.y>=.007,"Actual rotated pile never clips below floor");}
}
assert.equal(landed,2);assert.equal(ground.update(1),0);assert(samples.some(y=>y>start.y+.35),"Loot pops upward before falling");assert(samples.at(-1)!<.3,"Loot lands on ground rather than flying into inventory");
assert(samples.slice(66,82).some((y,i,a)=>i>0&&y>a[i-1]+.001),"Landing has a small settling bounce");assert.equal(ground.items.length,2);assert.deepEqual(bag.snapshot(),before,"Landing alone never awards loot");
const full=new InventoryModel();for(let i=0;i<full.slots.length;i++)if(!isEquipmentSlot(i))full.slots[i]={id:"wood",count:30};
const fullBefore=full.snapshot();assert(!ground.pickup(drops[0].id,full).ok);assert.deepEqual(full.snapshot(),fullBefore);assert.equal(ground.items.length,2);
assert(ground.pickup(drops[0].id,bag).ok);assert(ground.pickup(drops[1].id,bag).ok);assert.equal(bag.count("copperOre"),3);assert.equal(bag.count("stone"),2);assert(!ground.pickup(drops[0].id,bag).ok);view.update(2,true);assert.equal(view.center(drops[0].id),null);
const merging=new GroundItems(),air=merging.eject([{id:"stone",count:2}],origin,player,()=>true,()=>true)[0],added=merging.add({id:"stone",count:3},air.position);assert.notEqual(added.id,air.id);assert.deepEqual(sums(merging),{stone:5});
const reduced=new GroundItems(),reducedItem=reduced.eject([{id:"crystal",count:2}],origin,player,()=>true,()=>true)[0],reducedView=createGroundItemView(scene,reduced,()=>0);
reducedView.update(0,false);const lowStart=reducedView.center(reducedItem.id)!.y;let maximum=lowStart;
for(let i=0;i<100;i++){reduced.update(.01);reducedView.update(i*.01,false);maximum=Math.max(maximum,reducedView.center(reducedItem.id)!.y);}assert(maximum<lowStart+.16);assert(!reducedItem.flight);assert(reduced.nearest(player));
// Every real deposit and reachable approach tested with real world collisions.
let approaches=0;
for(const node of world.mining.nodes){
  const hp=node.health;node.health=0;
  let tested=0;
  for(let i=0;i<24;i++){
    const a=i*Math.PI/12,p={x:node.x+Math.cos(a)*1.45,z:node.z+Math.sin(a)*1.45};
    if(!world.canWalk(p.x,p.z,.27)||!world.clearReach(p,world.mining.contact(node,p)))continue;
    const m=new GroundItems(),items=m.eject(ORES[node.kind].loot,{x:node.x,y:.62*node.size,z:node.z},p,world.canWalk,world.clearReach);
    for(const item of items){const end=item.position;assert(world.canWalk(end.x,end.z,.24),`${node.id} end walkable`);assert(world.clearReach(p,end),`${node.id} reachable`);assert(Math.hypot(p.x-end.x,p.z-end.z)<1.8);}
    assert(Math.hypot(items[0].position.x-items[1].position.x,items[0].position.z-items[1].position.z)>.4,`${node.id}: different loot piles remain distinguishable`);
    assert(Math.hypot(p.x-node.x,p.z-node.z)<=MINING_REACH);tested++;approaches++;
  }
  assert(tested>0,`${node.id} has a valid mining/drop approach`);node.health=hp;
}
console.log(JSON.stringify({result:"passed",approaches,checks:"actual 12-ore world safe destinations; separate conserved piles; ballistic rise/gravity/settling bounce; actual floor clearance; no midair pickup/merge; pause; once-only landing; full-bag persistence; landed receipts; reduced motion"}));
scene.dispose();engine.dispose();
