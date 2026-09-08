import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { InventoryModel,inventoryGains,MAIN_SLOTS,BASE_SLOTS,type InventoryGain } from "../components/game/inventory";
import { GroundItems,createGroundItemView } from "../components/game/droppedItems";
import { FarmModel } from "../components/game/farming";
import { createPickupView } from "../components/game/pickupView";
import { PICKUP_POOL_SIZE,PICKUP_LIFT_SECONDS,PICKUP_FLY_SECONDS,pickupFlightPose } from "../components/game/pickupMotion";

function verifyReceipts(){
  const empty=()=>{const bag=new InventoryModel();bag.slots=Array.from({length:BASE_SLOTS},()=>null);return bag;};
  const ground=new GroundItems(),bag=empty();
  let item=ground.add({id:"wood",count:3},{x:0,z:0});
  const first=ground.pickup(item.id,bag);assert(first.ok);assert.deepEqual(first.gains,[{slot:0,id:"wood",count:3}]);
  assert.equal(ground.items.length,0);assert.equal(ground.pickup(item.id,bag).ok,false);assert.equal(bag.count("wood"),3);
  item=ground.add({id:"wood",count:4},{x:0,z:0});
  const merged=ground.pickup(item.id,bag);assert(merged.ok);assert.deepEqual(merged.gains,[{slot:0,id:"wood",count:4}]);assert.equal(bag.count("wood"),7);
  bag.slots[0]={id:"wood",count:29};bag.slots[1]={id:"wood",count:28};
  item=ground.add({id:"wood",count:30},{x:0,z:0});
  const split=ground.pickup(item.id,bag);assert(split.ok);assert.deepEqual(split.gains,[{slot:0,id:"wood",count:1},{slot:1,id:"wood",count:2},{slot:2,id:"wood",count:27}]);
  const before=bag.snapshot().slots,copy=JSON.stringify(before);assert(bag.add([{id:"shell",count:2}]));
  assert.deepEqual(inventoryGains(before,bag.slots),[{slot:3,id:"shell",count:2}]);assert.equal(JSON.stringify(before),copy,"Receipt calculation is pure");
  assert.deepEqual(inventoryGains(bag.slots,before),[],"Consumption is not a pickup");
  const equipBefore=empty().slots,equipAfter=empty().slots;equipAfter[12]={id:"hat",count:1};equipAfter[13]={id:"shirt",count:1};equipAfter[14]={id:"backpack",count:1};
  assert.deepEqual(inventoryGains(equipBefore,equipAfter),[],"Equipment slots are not award destinations");
  const full=empty();for(let i=0;i<MAIN_SLOTS;i++)full.slots[i]={id:"wood",count:30};full.slots[0]!.count=29;
  const blocked=ground.add({id:"wood",count:2},{x:1,z:1}),prior=full.snapshot();
  const fail=ground.pickup(blocked.id,full);assert(!fail.ok);assert(!("gains" in fail));assert.deepEqual(full.snapshot(),prior,"No partial merge when entire stack does not fit");assert(ground.items.some(i=>i.id===blocked.id));
  assert(full.buyBackpack().ok);const extra=ground.pickup(blocked.id,full);assert(extra.ok);assert.deepEqual(extra.gains,[{slot:0,id:"wood",count:1},{slot:15,id:"wood",count:1}]);
  const atomic=full.snapshot();assert(!full.add([{id:"shell",count:1000}]));assert.deepEqual(full.snapshot(),atomic);assert.deepEqual(inventoryGains(atomic.slots,full.slots),[]);
  const cropBag=new InventoryModel(),farm=new FarmModel([{x:1,z:0,kind:"dirt"}],()=>true,cropBag);farm.seedExample(1,0,24);
  const old=cropBag.snapshot().slots,harvest=farm.harvestArea({x:0,z:0},{x:2,z:0});assert(harvest.ok);
  assert.deepEqual(inventoryGains(old,cropBag.slots),[{slot:1,id:"seeds",count:2},{slot:9,id:"turnip",count:1}],"Harvest uses the same exact gain contract");
  console.log("Pickup receipts passed: fresh/merged/split stacks, pure positive deltas, equipment exclusions, backpack overflow, atomic full-bag failure, no repeat loot, crop gains.");
}

class NodeStub {
  className="";hidden=false;textContent="";style:Record<string,string>={};dataset:Record<string,string>={};attributes:Record<string,string>={};children:NodeStub[]=[];parent:NodeStub|null=null;
  rect={left:0,top:0,width:40,height:40};
  appendChild(node:NodeStub){node.parent=this;this.children.push(node);return node;}
  replaceChildren(){this.children=[];this.textContent="";}
  setAttribute(key:string,value:string){this.attributes[key]=value;if(key==="class")this.className=value;}
  getBoundingClientRect(){return this.rect;}
  cloneNode(){const clone=new NodeStub();clone.className=this.className;return clone;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
  querySelector(selector:string):NodeStub|null{void selector;return null;}
}

function verifyView(){
  const engine=new NullEngine(),scene=new Scene(engine);
  const camera=new ArcRotateCamera("test",-Math.PI/4,Math.PI/4,30,Vector3.Zero(),scene);camera.mode=Camera.ORTHOGRAPHIC_CAMERA;camera.orthoTop=10;camera.orthoBottom=-10;camera.orthoLeft=-15;camera.orthoRight=15;
  camera.getViewMatrix(true);camera.getProjectionMatrix(true);scene.updateTransformMatrix();
  const ground=new GroundItems(),groundView=createGroundItemView(scene,ground,()=>.24),item=ground.add({id:"shell",count:2},{x:0,z:0});groundView.update(0,true);
  const origin=groundView.center(item.id);assert(origin);assert(origin.y>.24&&origin.y<.6,"Origin is the actual grounded mesh center");
  const host=new NodeStub();host.rect={left:20,top:10,width:800,height:650};
  const slots=Array.from({length:23},(_,i)=>{const n=new NodeStub();n.dataset.itemId="shell";n.rect={left:100+i*30,top:550,width:40,height:40};return n;});
  const icon=new NodeStub();icon.className="pickup-source-art";const dock=new NodeStub();dock.rect={left:80,top:520,width:600,height:70};
  host.querySelector=(selector:string)=>{const match=/data-inventory-slot="(\d+)"/.exec(selector);return match?slots[Number(match[1])]??null:selector.includes("data-pickup-icon")?icon:selector===".inventory-dock"?dock:null;};
  const bounds={left:50,top:30,width:720,height:600};
  const canvas={parentElement:host,getBoundingClientRect:()=>bounds} as unknown as HTMLCanvasElement;
  const previous=Object.getOwnPropertyDescriptor(globalThis,"document");Object.defineProperty(globalThis,"document",{value:{createElement:()=>new NodeStub()},configurable:true});
  let target:number|null=8;
  try{
    const view=createPickupView(scene,camera,canvas,()=>target),layer=view.layer as unknown as NodeStub;assert.equal(layer.children.length,PICKUP_POOL_SIZE);
    const meshes=scene.meshes.length;
    view.receive([{slot:8,id:"shell",count:2}],origin,true);const flight=layer.children.find(n=>!n.hidden)!;assert(flight);assert.equal(flight.dataset.itemId,"shell");assert.equal(layer.dataset.total,"1");assert.equal(flight.children[3].children[0].className,"item-art pickup-item-art");
    const initial={...flight.style};view.update(0,true);assert.deepEqual(flight.style,initial,"Pause freezes cosmetic state");
    view.update(.1,true);assert.notDeepEqual(flight.style,initial);assert.equal(flight.dataset.stage,"lift");
    view.update(.1,true);assert.equal(flight.dataset.stage,"fly");
    const oldTarget=Number(flight.dataset.targetX);slots[8].rect.left+=80;bounds.width=390;bounds.height=844;view.update(0,true);assert.equal(Number(flight.dataset.targetX),oldTarget+80,"Resize/layout uses live target slot bounds");
    target=15;view.update(0,true);assert.equal(Number(flight.dataset.targetX),slots[15].rect.left+20-host.rect.left,"Rearranged item retargets");
    for(let i=0;i<8;i++)view.update(.1,true);assert(flight.hidden);assert.equal(slots[15].dataset.pickupReceived,"true");
    view.update(0,true);assert.equal(slots[15].dataset.pickupReceived,"true");for(let i=0;i<5;i++)view.update(.1,true);assert.equal(slots[15].dataset.pickupReceived,undefined);
    const gains:InventoryGain[]=Array.from({length:36},(_,i)=>({slot:8,id:"shell",count:i+1}));view.receive(gains,origin,true);assert.equal(layer.children.length,PICKUP_POOL_SIZE);assert.equal(layer.dataset.active,String(PICKUP_POOL_SIZE));
    for(let i=0;i<15;i++)view.update(.1,true);assert.equal(layer.dataset.active,"0");assert.equal(scene.meshes.length,meshes,"Flights allocate no world meshes");
    view.receive([{slot:8,id:"shell",count:1}],origin,false);const reduced=layer.children.find(n=>!n.hidden)!;assert.equal(reduced.dataset.stage,"fade");const x=reduced.style.transform.split("px,")[0];view.update(.1,false);assert.equal(reduced.style.transform.split("px,")[0],x,"Reduced motion avoids cross-screen travel");
    view.update(.1,false);view.update(.1,false);assert(reduced.hidden);assert.equal(slots[15].dataset.pickupReceived,"true");
    slots[15].dataset.itemId="wood";view.update(0,true);assert.equal(slots[15].dataset.pickupReceived,undefined,"Slot changed item does not retain stale glow");
    target=null;view.receive([{slot:8,id:"shell",count:1}],origin,true);for(let i=0;i<10;i++)view.update(.1,true);assert.equal(layer.dataset.active,"0","Removed destination safely falls back to inventory dock");
    view.receive([{slot:8,id:"shell",count:1}],origin,true);view.clear();assert(layer.children.every(n=>n.hidden));assert(slots.every(s=>s.dataset.pickupReceived===undefined));
    view.dispose();assert.equal(host.children.length,0);view.receive([{slot:8,id:"shell",count:1}],origin,true);assert.equal(host.children.length,0);view.dispose();
    const bag=new InventoryModel();assert(ground.pickup(item.id,bag).ok);groundView.update(0,true);assert.equal(groundView.center(item.id),null);
  }finally{if(previous)Object.defineProperty(globalThis,"document",previous);else Reflect.deleteProperty(globalThis,"document");scene.dispose();engine.dispose();}
  const from={x:100,y:200},to={x:360,y:600};
  const a=pickupFlightPose(from,to,0),b=pickupFlightPose(from,to,PICKUP_LIFT_SECONDS),c=pickupFlightPose(from,to,PICKUP_LIFT_SECONDS+PICKUP_FLY_SECONDS);
  assert.equal(a.x,from.x);assert.equal(a.y,from.y);assert(b.y<from.y);assert.equal(c.x,to.x);assert.equal(c.y,to.y);assert(c.done);
  for(let i=0;i<100;i++){const p=pickupFlightPose(from,to,i/100);assert(Object.values(p).filter(v=>typeof v==="number").every(Number.isFinite));}
  console.log("Pickup view passed: actual ground center, identical item icon, lift/arc/exact landing, live mobile bounds and retargeting, pause, local glow cleanup, 24-node bounded pool, reduced motion, dispose.");
}

verifyReceipts();verifyView();
