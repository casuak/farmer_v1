import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { buildWorld } from "../components/game/world";
import { tileKey,FarmModel } from "../components/game/farming";
import { MovementMode,locomotionPose } from "../components/game/movement";
import { InventoryModel,ITEMS } from "../components/game/inventory";
import { BoatModel,BOAT_SPEED } from "../components/game/boat";
import { createBoatView } from "../components/game/ocean";
import { GroundItems,createGroundItemView } from "../components/game/droppedItems";
import { createFarmer } from "../components/game/character";
import { BOUNDS,canSail,seaHeight } from "../components/game/geography";
import type { createSpringLighting } from "../components/game/lighting";

export function verifyExpansion(scene:Scene,w:ReturnType<typeof buildWorld>,lighting:ReturnType<typeof createSpringLighting>){
  // Half-metre flood fill includes door centres; 1 m centres alone miss narrow doorways.
  const reached=new Set<string>(),queue=[{x:-3.5,z:-3.5}];reached.add(tileKey(-3.5,-3.5));
  for(let i=0;i<queue.length;i++)for(const [dx,dz] of [[.5,0],[-.5,0],[0,.5],[0,-.5]]){
    const p={x:queue[i].x+dx,z:queue[i].z+dz},key=tileKey(p.x,p.z);
    if(!reached.has(key)&&w.canWalk(p.x,p.z)){reached.add(key);queue.push(p);}
  }
  for(const p of [{x:-28,z:0},{x:-6,z:20},{x:27,z:-5},{x:37,z:0},{x:16,z:20}])assert(reached.has(tileKey(p.x,p.z)),`Region destination ${JSON.stringify(p)} connects to spawn`);
  assert.equal(w.rooms.length,4);
  for(const room of w.rooms){
    const entry={x:room.x,z:Math.ceil((room.z-room.d/2+.6)*2)/2};
    assert(w.canWalk(entry.x,entry.z),`${room.name} has a usable entrance`);assert(reached.has(tileKey(entry.x,entry.z)),`${room.name} connects to spawn`);assert.equal(w.roomAt(entry)?.id,room.id);assert(!w.canWalk(room.x+room.w/2,room.z),"Side walls block passage");
    const roof=w.occluders.find(o=>o.room===room.id&&o.mesh.name.endsWith("-roof"));assert(roof&&roof.insideOpacity!<.05);assert(scene.getMeshByName(room.id+"-interior")!.getTotalVertices()>200);
  }
  for(let x=5.5;x<12.5;x+=.1)assert(w.canWalk(x,20),"Town bridge remains traversable");
  for(const kind of ["sea","sand","dock","floor"])assert(w.tiles.some(t=>t.kind===kind));
  const mode=new MovementMode();assert(mode.running,"The player starts in run mode");mode.shift(true);assert(!mode.running);mode.shift(true);assert(!mode.running,"Holding Shift never repeats the toggle");mode.shift(false);assert(!mode.running,"Key release keeps the selected mode");mode.shift(true);assert(mode.running);mode.shift(false);
  const walk=locomotionPose(1.1,1,false),run=locomotionPose(1.1,1,true);assert(run.bob>walk.bob&&run.lean<walk.lean&&run.elbow>walk.elbow+.5,"Run has a separate bent-arm, forward-leaning gait");
  assert(walk.leftArm*walk.leftLeg<0&&walk.rightArm*walk.rightLeg<0,"Arms counter-swing with their corresponding legs");
  const farmer=createFarmer(scene,lighting.shadow);farmer.animate(2,.1,true,true,false,0,true);
  const head=Vector3.TransformCoordinates(new Vector3(0,1.3,0),farmer.body.computeWorldMatrix(true));assert(head.z<-.1,"Running leans toward the face at local -Z");
  assert(farmer.elbows[0].rotation.x>.5);
  farmer.animate(2,.1,false,false,false,.215,true);
  const hand=Vector3.TransformCoordinates(new Vector3(0,-.20,-.02),farmer.hand.computeWorldMatrix(true));assert(hand.z<-.4,"The working hand and held tool swing in front of the torso");
  farmer.animate(2,.1,false,false,true,0,true);
  const boot=Vector3.TransformCoordinates(new Vector3(0,-.48,-.045),farmer.limbs[0].computeWorldMatrix(true));assert(boot.z<-.4,"Seated legs extend toward the bow instead of behind the player");
  const footfalls=(running:boolean)=>{let hits=0;for(let i=0;i<60;i++)if(farmer.animate(i/60,1/60,true,running,false,0,true))hits++;return hits;};
  const walkingHits=footfalls(false),runningHits=footfalls(true);assert(walkingHits>=3&&runningHits>walkingHits,"Footstep sounds follow the independent walk and run animation cadence");
  assert(!farmer.animate(3,.1,false,true,false,0,true));assert(!farmer.animate(3,.1,true,true,true,0,true),"Standing still and sailing do not produce footfalls");
  const boat=new BoatModel(),boatView=createBoatView(scene,lighting.shadow,boat);assert(!boat.board({x:0,z:0}));assert(boat.board({x:37,z:0}));
  const landing=boat.disembark(w.canWalk);assert(landing&&w.canWalk(landing.x,landing.z));assert(!boat.aboard);
  boat.board({x:37,z:0});const startZ=boat.position.z;boat.move(0,-1,1);assert(Math.abs(boat.position.z-(startZ-BOAT_SPEED))<.001);
  boat.position={x:43,z:-15};assert.equal(boat.disembark(w.canWalk),null,"Cannot disembark in deep sea");assert(boat.aboard);boat.move(-1,0,5);assert(canSail(boat.position.x,boat.position.z));
  boat.position={x:44,z:0};boat.move(1,0,10);assert(boat.position.x<=BOUNDS.x-1.5);boat.reset();boat.board({x:37,z:0});boat.move(0,1,1);assert(boat.position.z<-2,"Boat cannot cross pier");
  boatView.update(1,true);const boatY=boatView.root.position.y;boatView.update(2,true);assert.notEqual(boatY,boatView.root.position.y);assert.notEqual(seaHeight(36,0,0),seaHeight(36,0,2));
  const pack=new InventoryModel();assert.equal(pack.slots.length,15);assert.equal(pack.gold,200);
  const resources=()=>Object.keys(ITEMS).map(id=>pack.count(id as keyof typeof ITEMS)),counts=resources();pack.select(0);assert(pack.move(0,10).ok);assert.equal(pack.selected,10);assert(pack.move(10,2).ok);assert.deepEqual(resources(),counts,"Slot swaps conserve items");
  assert(pack.buyBackpack().ok);assert.equal(pack.gold,80);assert.equal(pack.slots.length,23);assert(pack.backpack);assert(!pack.buyBackpack().ok);assert.equal(pack.gold,80);
  assert(pack.move(2,22).ok);assert.equal(pack.slots[22]?.id,"hoe");assert(pack.buy("seeds").ok);assert.equal(pack.gold,75);
  assert(pack.add([{id:"turnip",count:4}]));const pi=pack.slots.findIndex(s=>s?.id==="turnip");assert(pack.sell(pi,false).ok);assert.equal(pack.count("turnip"),3);assert.equal(pack.gold,93);assert(pack.sell(pi,true).ok);assert.equal(pack.gold,147);assert(!pack.sell(pi,true).ok);
  const drops=new GroundItems(),dropView=createGroundItemView(scene,drops),dropped=pack.drop(22)!;assert.equal(dropped.id,"hoe");assert.equal(pack.count("hoe"),0);
  const drop=drops.add(dropped,{x:0,z:0});dropView.update(0,true);const dropMeshes=scene.meshes.length;dropView.update(2,true);assert.equal(scene.meshes.length,dropMeshes);assert.equal(drops.nearest({x:.5,z:0})!.id,drop.id);assert(drops.pickup(drop.id,pack).ok);assert.equal(pack.count("hoe"),1);assert.equal(drops.items.length,0);assert(!drops.pickup(drop.id,pack).ok);dropView.update(3,true);assert.equal(scene.meshes.length,dropMeshes-2);
  const merge=new InventoryModel();merge.slots[1]={id:"seeds",count:95};merge.slots[4]={id:"seeds",count:10};assert(merge.move(4,1).ok);assert.equal(merge.slots[1]!.count,99);assert.equal(merge.slots[4]!.count,6);assert.equal(merge.count("seeds"),105);
  const full=new InventoryModel();for(let i=0;i<full.slots.length;i++)full.slots[i]={id:"wood",count:30};full.gold=70;
  const snapshot=full.snapshot();assert(!full.buy("seeds").ok);assert.deepEqual(full.snapshot(),snapshot,"Full-pack purchase does not consume gold");assert(!full.add([{id:"wood",count:1},{id:"seeds",count:2}]));assert.deepEqual(full.snapshot(),snapshot,"Multiple item additions are atomic");
  const held=drops.add({id:"shell",count:2},{x:0,z:0});assert(!drops.pickup(held.id,full).ok);assert.equal(drops.items.length,1,"Full-pack pickup stays on the ground");
  const logs=new GroundItems(),log=logs.add({id:"wood",count:3},{x:0,z:0});
  let floor=0;const logView=createGroundItemView(scene,logs,()=>floor);logView.update(0,true);
  const logMesh=scene.getMeshByName("dropped-wood")!,rest=logMesh.position.clone(),heading=logMesh.rotation.y;
  for(const time of [1,4,13]){logView.update(time,true);assert(logMesh.position.equals(rest)&&logMesh.rotation.y===heading,"Wood does not hover or spin above the ground");}
  for(const height of [0,.08,.18]){floor=height;logView.update(4,false);logMesh.computeWorldMatrix(true);assert(Math.abs(logMesh.getBoundingInfo().boundingBox.minimumWorld.y-floor-.008)<.00001,"Wood rests on terrain, room floors and raised walkways");}
  logs.items=logs.items.filter(item=>item.id!==log.id);logView.update(4,false);
  const poor=new InventoryModel();poor.gold=4;assert(!poor.buy("seeds").ok);assert(!poor.buyBackpack().ok);assert.equal(poor.gold,4);assert.equal(poor.slots.length,15);
  const harvest=new FarmModel([{x:0,z:0,kind:"dirt"}]);harvest.seedExample(0,0,24);
  harvest.bag.slots=Array.from({length:15},()=>({id:"wood" as const,count:30}));harvest.bag.slots[0]={id:"scythe",count:1};harvest.bag.slots[1]={id:"seeds",count:99};
  const fullHarvest=harvest.bag.snapshot();assert(!harvest.use("scythe",{x:0,z:0},{x:.5,z:.5}).ok);assert.deepEqual(harvest.bag.snapshot(),fullHarvest);assert(harvest.get(0,0)!.crop);
  harvest.bag.slots[2]=null;assert(!harvest.use("scythe",{x:0,z:0},{x:.5,z:.5}).ok,"One free slot cannot hold two distinct harvest rewards");harvest.bag.slots[3]=null;assert(harvest.use("scythe",{x:0,z:0},{x:.5,z:.5}).ok);assert.equal(harvest.bag.count("turnip"),1);assert.equal(harvest.bag.count("seeds"),101);
  const starts=w.residents.residents.map(r=>r.root.position.clone());for(let i=0;i<360;i++)w.residents.update(1/30,i/30,true);
  assert(w.residents.residents.filter((r,i)=>Vector3.Distance(r.root.position,starts[i])>1).length>=4,"Residents advance along walkable routes");for(const r of w.residents.residents)assert(w.canWalk(r.root.position.x,r.root.position.z,.18));
  w.update(.3,true);assert(scene.getMeshByName("leaping-silver-fish")!.isEnabled());const gull=scene.getTransformNodeByName("seagull-0")!,gs=gull.position.clone(),fish=scene.getMeshByName("swimming-fish-shadow")!,fs=fish.position.clone();
  w.update(4,true);assert(!scene.getMeshByName("leaping-silver-fish")!.isEnabled());assert(Vector3.Distance(gull.position,gs)>.1);assert(Vector3.Distance(fish.position,fs)>.1);assert(scene.getMeshByName("ocean-wave-surface")!.getTotalVertices()>1000);
  lighting.follow({x:38,z:-20});assert(Vector3.Distance(lighting.sun.position.add(lighting.sun.direction.scale(70)),new Vector3(38,0,-20))<.05,"The shadow camera stays within a texel of the follow target");
}
