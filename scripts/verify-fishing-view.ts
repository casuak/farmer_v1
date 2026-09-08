import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { createFarmer } from "../components/game/character";
import { createHeldTools } from "../components/game/farmView";
import { FishingModel,FISHING,findFishingSpot,inventoryCatchSlot } from "../components/game/fishing";
import { InventoryModel,type FishId } from "../components/game/inventory";
import { createFishPixels,fishSpriteSVG,FISH_SPRITES } from "../components/game/fishSprites";
import { createFishingView,catchFlyPosition,catchJumpPosition } from "../components/game/fishingView";
import type { buildWorld } from "../components/game/world";

export function verifyFishingView(scene:Scene,camera:Camera,shadow:ShadowGenerator,world:ReturnType<typeof buildWorld>){
  const bag=new InventoryModel();assert.equal(bag.slots[6]?.id,"fishingRod");bag.select(6);assert.equal(bag.hand,"fishingRod");assert.equal(bag.tool,null);
  for(const id of ["carp","perch","sardine","redSnapper"] as FishId[]){
    const p=createFishPixels(id);assert.equal(p.data.length,p.width*p.height*4);assert(p.data.some(v=>v===0));assert(p.data.some(v=>v===255));
    assert.equal(readFileSync(`public/items/fish-${id}.svg`,"utf8").trim(),fishSpriteSVG(id));
  }
  // Real world collision path, not just idealized geography stubs.
  const shore={x:-7.5,z:-23.5};assert(world.canWalk(shore.x,shore.z));
  const spot=findFishingSpot(shore,{x:-4,z:-23.5},(x,z)=>world.canWalk(x,z,0));assert(spot,"A normal farm riverbank permits fishing with actual world collision");
  for(let x=-7.8;x< -6.5;x+=.013){const p={x,z:-23.5};if(world.canWalk(x,p.z))assert(findFishingSpot(p,{x:-4,z:p.z},(sx,sz)=>world.canWalk(sx,sz,0)),`Sub-tile bank offset ${x} must not falsely block on the water's edge`);}
  assert.equal(findFishingSpot({x:-26,z:-13},{x:-4,z:-13},(x,z)=>world.canWalk(x,z,.04)),null,"Cannot fish through a house");
  const farmer=createFarmer(scene,shadow),tools=createHeldTools(scene,farmer.hand,shadow);farmer.root.position.set(shore.x,0,shore.z);tools.select("fishingRod");
  farmer.animate(0,1/60,false,false,false,0,true,"fishingRod");farmer.fishPose("waiting",0,true);tools.rodTip.computeWorldMatrix(true);
  assert(tools.rodTip.getAbsolutePosition().y>1,"Rod tip clears the ground in the fishing pose");
  const doc=Object.getOwnPropertyDescriptor(globalThis,"document");let appended=0,removed=0;
  const makeElement=()=>({className:"",alt:"",hidden:true,src:"",textContent:"",style:{} as Record<string,string>,dataset:{} as Record<string,string>,attributes:{} as Record<string,string>,appendChild(){},setAttribute(key:string,value:string){this.attributes[key]=value;},remove(){removed++;}});
  const flight=makeElement(),slot={dataset:{} as Record<string,string>,getBoundingClientRect:()=>({left:180,top:250,width:40,height:40})};
  const canvas={getBoundingClientRect:()=>({left:0,top:0,width:512,height:256}),parentElement:{appendChild(){appended++;},querySelector:()=>slot}} as unknown as HTMLCanvasElement;
  Object.defineProperty(globalThis,"document",{value:{createElement:(tag:string)=>tag==="img"?flight:makeElement()},configurable:true});
  try{
    camera.getViewMatrix(true);camera.getProjectionMatrix(true);scene.updateTransformMatrix();
    const view=createFishingView(scene,camera,canvas,tools.rodTip),model=new FishingModel(()=>.25);assert.equal(appended,4);
    for(const id of ["carp","perch","sardine","redSnapper"] as FishId[]){const tex=scene.textures.find(t=>t.name===FISH_SPRITES[id])!;assert(tex.hasAlpha);if(tex.getInternalTexture())tex.getInternalTexture()!.isReady=true;}
    const count=scene.meshes.length;
    view.update(model.snapshot(),shore,0,0,true,spot,null);assert(view.charge.hidden);assert(view.biteSignal.hidden);
    assert(model.beginCharge());model.update(FISHING.chargeSeconds*.75);
    const powerSpot=findFishingSpot(shore,{x:-4,z:shore.z},(x,z)=>world.canWalk(x,z,0),model.snapshot().castPower);assert(powerSpot);
    view.update(model.snapshot(),shore,1,.016,true,powerSpot,null);assert(!view.charge.hidden);assert(view.target.isEnabled());assert(!view.bobber.isEnabled());assert(!view.line.isEnabled());
    assert(Math.abs(view.target.position.x-powerSpot.x)<1e-6);assert(Math.abs(Number(view.charge.dataset.power)-.75)<1e-6);
    model.cancel();view.clear();assert(view.charge.hidden);assert(!view.target.isEnabled());
    model.cast(spot);view.update(model.snapshot(),shore,0,0,true,null,null);assert(view.bobber.isEnabled());assert(view.line.isEnabled());assert(view.charge.hidden);
    model.update(.8);view.update(model.snapshot(),shore,.8,.8,true,null,null);assert.equal(model.phase,"waiting");assert(Math.abs(view.bobber.position.x-spot.x)<.001);assert(view.biteSignal.hidden);
    for(let i=0;i<1000&&model.snapshot().phase!=="bite";i++)model.update(.01);
    const biteState=model.snapshot();
    for(const motion of [true,false]){
      view.update({...biteState,phaseTime:.9},shore,3,.016,motion,null,null);assert(!view.biteSignal.hidden);assert(view.droplets.every(m=>m.isEnabled()),"Vigorous water splash persists after the initial half-second, also visible with reduced motion");
      const positions=view.droplets.map(m=>m.position.asArray());view.update({...biteState,phaseTime:.9},shore,3,0,motion,null,null);assert.deepEqual(view.droplets.map(m=>m.position.asArray()),positions,"Paused bite bursts freeze");
    }
    model.press();view.update(model.snapshot(),shore,3.1,.016,true,null,null);assert(view.biteSignal.hidden,"Hooking immediately removes the water exclamation");
    for(let i=0;i<3000&&model.snapshot().phase==="reeling";i++){const s=model.snapshot();if(s.fishPosition>s.barPosition)model.press();else model.release();model.update(1/120);}
    assert.equal(model.phase,"catching");const state=model.snapshot();assert(state.fish);const targetSlot=inventoryCatchSlot(bag,state.fish.id);assert.notEqual(targetSlot,null);
    for(const motion of [true,false]){
      view.clear();view.update({...state,phaseTime:.2},shore,2,.016,motion,null,targetSlot);
      assert(view.fish.isEnabled());assert(!view.bobber.isEnabled());assert(!view.line.isEnabled());assert(flight.hidden);
      const low=view.fish.position.y;view.update({...state,phaseTime:.5},shore,2.3,.016,motion,null,targetSlot);assert(view.fish.position.y>low,"Fish texture rises out of the water");
      const end=catchJumpPosition(spot,shore,1,!motion);assert(end.y>0);
      view.update({...state,phaseTime:FISHING.jumpSeconds+.1},shore,3,.016,motion,null,targetSlot);assert(!view.fish.isEnabled());assert(!flight.hidden);assert.equal(flight.src,FISH_SPRITES[state.fish.id]);
      const before={...flight.style};view.update({...state,phaseTime:FISHING.jumpSeconds+.1},shore,3,0,motion,null,targetSlot);assert.deepEqual(flight.style,before,"Paused flight does not advance");
      view.update({...state,phaseTime:FISHING.catchSeconds},shore,3.8,.016,motion,null,targetSlot);assert.equal(Number.parseFloat(flight.style.left),200);assert.equal(Number.parseFloat(flight.style.top),270);
      assert(Math.abs(catchFlyPosition({x:10,y:20},{x:200,y:270},1,!motion).scale-.18)<1e-10);
    }
    assert.equal(scene.meshes.length,count,"Fishing animation reuses its meshes");
    model.update(FISHING.catchSeconds+.1);const caught=model.takeCatch();assert(caught);assert(bag.add([{id:caught.id,count:1}]));assert.equal(bag.slots[targetSlot!]?.id,caught.id);assert.equal(model.takeCatch(),null);
    view.clear();assert(flight.hidden);view.land(targetSlot);assert.equal(slot.dataset.fishReceived,"true");view.update(model.snapshot(),shore,5,1,true,null,null);assert.equal(slot.dataset.fishReceived,undefined);
    view.dispose();assert.equal(removed,4);assert(!view.fish.isEnabled());assert(view.charge.hidden);assert(view.biteSignal.hidden);
    for(const mesh of scene.meshes){const positions=mesh.getVerticesData("position");if(positions)assert(Array.from(positions).every(Number.isFinite));}
    farmer.root.dispose();
  }finally{if(doc)Object.defineProperty(globalThis,"document",doc);else Reflect.deleteProperty(globalThis,"document");}
  console.log("Fishing view regression passed: real riverbank collision, initial rod and pose, legacy grid and shared generated PNG assets, rise from water, projected inventory flight, pause/reduced motion, actual stack destination, one award, pooled meshes and DOM cleanup.");
}
