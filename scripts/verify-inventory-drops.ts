import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { GroundItems } from "../components/game/droppedItems";
import { INVENTORY_DROP,groundDropPose,inventoryDropLanding } from "../components/game/groundDropMotion";
import { ITEMS,InventoryModel,isEquipmentSlot,type ItemId } from "../components/game/inventory";
import { createFarmCamera } from "../components/game/engine";
import { createSpringLighting } from "../components/game/lighting";
import { buildWorld } from "../components/game/world";
import { BOUNDS,BRIDGES,DOCK,shoreX,riverCenter } from "../components/game/geography";

const yes=()=>true,origin:{x:number;y:number;z:number}={x:0,y:INVENTORY_DROP.bodyHeight,z:0};
const settle=(ground:GroundItems)=>{let landed=0;for(let i=0;i<100;i++)landed+=ground.update(.01);return landed;};
const emptyBag=()=>{const bag=new InventoryModel();bag.slots.fill(null);return bag;};
const total=(bag:InventoryModel,ground:GroundItems,id:ItemId)=>bag.count(id)+ground.items.reduce((sum,item)=>sum+(item.stack.id===id?item.stack.count:0),0);
let itemTypes=0;
for(const id of Object.keys(ITEMS) as ItemId[]){
  const bag=emptyBag(),ground=new GroundItems(),count=ITEMS[id].max;bag.slots[0]={id,count};
  const result=ground.dropFromInventory(bag,0,origin,0,yes,yes);assert(result.ok);
  assert.equal(bag.count(id),0);assert.equal(total(bag,ground,id),count);assert.equal(ground.items.length,1);
  const item=result.item;assert.deepEqual(item.flight!.from,origin);assert.equal(item.position.x,0);assert(item.position.z<-.8);
  assert.equal(ground.nearest(origin),null);const afterDrop=bag.snapshot();assert(!ground.pickup(item.id,bag).ok);assert.deepEqual(bag.snapshot(),afterDrop);
  const poses=Array.from({length:101},(_,i)=>groundDropPose({...item.flight!,elapsed:i/100*item.flight!.duration},item.position,.18,true));
  assert.equal(poses[0].y,origin.y);assert(poses.some(p=>p.y>origin.y+.1),`${id}: body pop rises`);
  assert(Math.abs(poses.at(-1)!.y-.18)<1e-8);assert.equal(poses.at(-1)!.progress,1);
  assert.deepEqual({x:poses.at(-1)!.x,z:poses.at(-1)!.z},item.position);
  const frozen=JSON.stringify(ground.items);for(const dt of [0,-1,NaN,Infinity])ground.update(dt);assert.equal(JSON.stringify(ground.items),frozen);
  ground.update(100);assert(item.flight,"A long frame cannot skip the entire flight");assert(!ground.pickup(item.id,bag).ok);
  assert.equal(settle(ground),1);assert.equal(ground.update(.1),0);assert.equal(ground.nearest(origin)?.id,item.id);assert.deepEqual(bag.snapshot(),afterDrop,"Landing never awards inventory");
  const receipt=ground.pickup(item.id,bag);assert(receipt.ok);assert.equal(receipt.gains.reduce((n,g)=>n+g.count,0),count);assert.equal(total(bag,ground,id),count);assert(!ground.pickup(item.id,bag).ok);itemTypes++;
}
// Equipment and backpack mutations are identical to normal bag.drop, never lossy.
for(const [index,id] of [[12,"hat"],[13,"shirt"],[14,"backpack"]] as const){
  const bag=emptyBag(),ground=new GroundItems();bag.slots[index]={id,count:1};
  if(index===14)bag.slots.push(...Array(8).fill(null));
  assert(ground.dropFromInventory(bag,index,origin,0,yes,yes).ok);assert.equal(bag.slots[index],null);assert.equal(bag.slots.length,15);settle(ground);assert(ground.pickup(ground.items[0].id,bag).ok);assert.equal(bag.count(id),1);
}
const blockedBag=new InventoryModel();assert(blockedBag.buyBackpack().ok);blockedBag.slots[15]={id:"stone",count:12};const blockedGround=new GroundItems(),blockedBefore=blockedBag.snapshot();
assert(!blockedGround.dropFromInventory(blockedBag,14,origin,0,yes,yes).ok);assert.deepEqual(blockedBag.snapshot(),blockedBefore);assert.equal(blockedGround.items.length,0);
for(const index of [-1,99,1.5,NaN])assert(!blockedGround.dropFromInventory(blockedBag,index,origin,0,yes,yes).ok);
assert(!blockedGround.dropFromInventory(blockedBag,0,origin,0,()=>false,yes).ok);assert(!blockedGround.dropFromInventory(blockedBag,0,origin,0,yes,()=>false).ok);assert.deepEqual(blockedBag.snapshot(),blockedBefore);
// Four cardinal headings match the character's -Z face, not +Z or camera direction.
for(const [yaw,x,z] of [[0,0,-1],[-Math.PI/2,1,0],[Math.PI,0,1],[Math.PI/2,-1,0]]){
  const p=inventoryDropLanding(origin,yaw,yes,yes)!;assert(p);assert(Math.abs(p.x-x*1.05)<1e-8&&Math.abs(p.z-z*1.05)<1e-8);
}
// A nearby shore or wall shortens/redirects the arc, and a blocked middle is not crossed.
const bank=(x:number,z:number,r=0)=>z-r>-.42;
const shoreLanding=inventoryDropLanding(origin,0,bank,yes)!;assert(shoreLanding);assert(bank(shoreLanding.x,shoreLanding.z,.24));
const wall=(x:number,z:number,r=0)=>!(z<-.38+r&&z>-.62-r&&Math.abs(x)<2+r);
const wallLanding=inventoryDropLanding(origin,0,wall,yes)!;assert(wallLanding);assert(wallLanding.z>-.38);
for(let i=0;i<=100;i++)assert(wall(wallLanding.x*i/100,wallLanding.z*i/100,.24));
assert.deepEqual(inventoryDropLanding(origin,0,(x,z)=>Math.hypot(x,z)<.1,yes),{x:0,z:0},"Safe feet fallback stays animated");
assert.equal(inventoryDropLanding(origin,0,()=>false,yes),null,"Open water has no unsafe feet fallback");
// Already resting piles and repeated same-item drops never absorb or restart a flight.
const repeats=new GroundItems(),repeatBag=emptyBag();repeatBag.slots[0]={id:"stone",count:5};repeatBag.slots[1]={id:"stone",count:7};
const resting=repeats.add({id:"stone",count:3},{x:0,z:-1.05});
const first=repeats.dropFromInventory(repeatBag,0,origin,0,yes,yes);assert(first.ok);repeats.update(.1);
const second=repeats.dropFromInventory(repeatBag,1,origin,0,yes,yes);assert(second.ok);assert.notEqual(first.item.id,second.item.id);assert.equal(first.item.flight!.elapsed,.1);assert.equal(second.item.flight!.elapsed,0);assert.equal(resting.stack.count,3);
assert.notDeepEqual(first.item.position,second.item.position);assert.equal(total(repeatBag,repeats,"stone"),15);assert.equal(settle(repeats),2);assert.equal(repeats.items.length,3);
const full=new InventoryModel();for(let i=0;i<full.slots.length;i++)if(!isEquipmentSlot(i))full.slots[i]={id:"wood",count:ITEMS.wood.max};const fullBefore=full.snapshot();assert(!repeats.pickup(first.item.id,full).ok);assert.deepEqual(full.snapshot(),fullBefore);assert.equal(repeats.items.length,3);
for(const item of [...repeats.items])assert(repeats.pickup(item.id,repeatBag).ok);assert.equal(repeatBag.count("stone"),15);
// Launch snapshots do not follow the walking/turning avatar after release.
const movingOrigin={...origin},movingBag=emptyBag(),movingGround=new GroundItems();movingBag.slots[0]={id:"wood",count:2};const moving=movingGround.dropFromInventory(movingBag,0,movingOrigin,0,yes,yes);assert(moving.ok);movingOrigin.x=40;movingOrigin.y=9;assert.deepEqual(moving.item.flight!.from,origin);
const reduced=groundDropPose({...moving.item.flight!,elapsed:.2},moving.item.position,.18,false);assert(Number.isFinite(reduced.y));assert(reduced.y<groundDropPose({...moving.item.flight!,elapsed:.2},moving.item.position,.18,true).y);

// Real world obstacles, live ore, building walls, river banks, bridge and dock edges.
const engine=new NullEngine(),scene=new Scene(engine),camera=createFarmCamera(scene),lighting=createSpringLighting(scene,camera),world=buildWorld(scene,lighting.shadow);
let approaches=0,edgeApproaches=0;
const positions:{x:number;z:number;edge?:boolean}[]=[];
for(let x=-BOUNDS.x+1;x<BOUNDS.x;x+=6)for(let z=-BOUNDS.z+1;z<BOUNDS.z;z+=6)positions.push({x,z});
for(let z=-32;z<=32;z+=4)for(const x of [shoreX(z)-1,riverCenter(z)-2.8,riverCenter(z)+2.8])positions.push({x,z,edge:true});
for(const b of BRIDGES)for(const z of [b.z,b.z-1.1,b.z+1.1])positions.push({x:b.x,z,edge:true});
for(const x of [28,32,37.8])for(const z of [DOCK.z,DOCK.z-.8,DOCK.z+.8])positions.push({x,z,edge:true});
for(const p of positions){
  if(!world.canWalk(p.x,p.z,.27))continue;
  for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
    const end=inventoryDropLanding(p,yaw,world.canWalk,world.clearReach)!;assert(end,`Valid avatar ground always has a fallback: ${JSON.stringify(p)}`);
    assert(world.canWalk(end.x,end.z,.24));assert(world.clearReach(p,end));assert(Math.hypot(p.x-end.x,p.z-end.z)<1.8);
    for(let i=0;i<=50;i++){const u=i/50;assert(world.canWalk(p.x+(end.x-p.x)*u,p.z+(end.z-p.z)*u,.24),`Arc footprint remains safe ${JSON.stringify({p,end,u})}`);}
    approaches++;if(p.edge)edgeApproaches++;
  }
}
assert(approaches>300);assert(edgeApproaches>40);scene.dispose();engine.dispose();
console.log(JSON.stringify({result:"passed",itemTypes,approaches,edgeApproaches,checks:"all inventory types and quantities; equipment/backpacks; visible facing/body-height pop; conservative swept safe landing; shore/wall/feet fallback; airborne pickup lock; independent repeated flights; pause/long frame; full bag; exactly-once pickup; reduced motion; real world banks/bridges/dock/buildings/live ore"}));
