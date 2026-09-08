import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { createFarmCamera } from "../components/game/engine";
import { createSpringLighting } from "../components/game/lighting";
import { buildWorld } from "../components/game/world";
import { createFarmer } from "../components/game/character";
import { createHeldTools } from "../components/game/farmView";
import { createFlashlight } from "../components/game/flashlight";
import { createRoomCutawayShadows,cutawayVisibility } from "../components/game/roomCutaway";

const engine=new NullEngine(),scene=new Scene(engine),camera=createFarmCamera(scene),lighting=createSpringLighting(scene,camera),world=buildWorld(scene,lighting.shadow);
const farmer=createFarmer(scene,lighting.shadow),tools=createHeldTools(scene,farmer.hand,lighting.shadow);
const sourceList=lighting.shadow.getShadowMap()!.renderList!,before=[...sourceList];
const cutaway=createRoomCutawayShadows(lighting.shadow,world.occluders);
const allowed=(name:string)=>lighting.shadow.customAllowRendering(scene.getMeshByName(name)!.subMeshes![0]);
console.log('Created room shadow test scene');
for(const room of world.rooms){
  console.log('Checking room',room.id);
  const back=world.occluders.find(o=>o.mesh.name===room.id+'-back-walls')!,front=world.occluders.find(o=>o.mesh.name===room.id+'-front-walls')!,roof=world.occluders.find(o=>o.mesh.name===room.id+'-roof')!;
  assert.equal(back.room,room.id);assert.equal(back.insideOpacity,1);assert.equal(front.insideOpacity,0);assert.equal(roof.insideOpacity,0);
  cutaway.update(room.id);
  assert(allowed(back.mesh.name));assert(!allowed(front.mesh.name));assert(!allowed(roof.mesh.name));assert(allowed(room.id+'-interior'));assert(allowed('farmer-torso'));
  for(const other of world.rooms)if(other.id!==room.id)assert(allowed(other.id+'-roof'),'Other buildings retain sun shadows');
  for(const o of [back,front,roof]){let visibility=.19;for(let i=0;i<150;i++)visibility=cutawayVisibility(visibility,o.insideOpacity!,1/60);assert.equal(visibility,o.insideOpacity);o.mesh.visibility=visibility;assert(o.mesh.isVisible&&o.mesh.isEnabled());}
  assert(scene.getMeshByName(room.id+'-floor')!.receiveShadows);assert(scene.getMeshByName(room.id+'-interior')!.receiveShadows);
  cutaway.update(null);assert(allowed(front.mesh.name));assert(allowed(roof.mesh.name));
}
assert.equal(lighting.shadow.getShadowMap()!.renderList,sourceList,'Never mutate shared caster-list identity');assert.equal(sourceList.length,before.length);assert(sourceList.every((mesh,index)=>mesh===before[index]),'No physical casters deleted');
// A camera-hidden wall remains a real flashlight blocker and shadow-map caster.
const home=world.rooms[0],flashlight=createFlashlight(scene,tools.flashlightTip,sourceList);
farmer.root.position.set(home.x,0,home.z-home.d/2+.9);farmer.body.rotation.y=Math.PI;
tools.select('flashlight');farmer.animate(0,0,false,false,false,0,false,'flashlight');
flashlight.update('flashlight',Math.PI,farmer.root.position,false,false,1);
const near=scene.getMeshByName(home.id+'-front-walls')!;assert.equal(near.visibility,0);assert(flashlight.shadow.getShadowMap()!.renderList!.includes(near));assert(flashlight.active);assert(flashlight.light.isEnabled(),'Camera cutaway keeps the persistent spotlight registered');
assert(flashlight.shadow.transparencyShadow&&!flashlight.shadow.enableSoftTransparentShadow);
for(const dt of [0,NaN,Infinity,-1])assert.equal(cutawayVisibility(.5,0,dt),.5);
assert.equal(cutawayVisibility(.0001,0,0),0);assert.equal(cutawayVisibility(.9999,1,0),1);
cutaway.dispose();assert(!lighting.shadow.customAllowRendering);flashlight.dispose();scene.dispose();engine.dispose();
console.log('Wall corners passed: 4 room cutaways, exact opacity endpoints, only near-wall/roof sun filtering, furniture/player/exterior shadows retained, physical flashlight casters retained, cleanup.');
