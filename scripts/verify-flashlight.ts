import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { Light } from "@babylonjs/core/Lights/light";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { createFarmer } from "../components/game/character";
import { createHeldTools } from "../components/game/farmView";
import { createFlashlight,FLASHLIGHT,flashlightActive,flashlightDirection } from "../components/game/flashlight";
import { buildRooms } from "../components/game/buildings";
import { voxelMaterial } from "../components/game/voxel";
import type { HandItem } from "../components/game/inventory";

const close=(a:number,b:number,epsilon=1e-5)=>assert(Math.abs(a-b)<epsilon,`${a} ~= ${b}`);
for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2,.7]){
  const dir=flashlightDirection(yaw);close(dir.length(),1);assert(dir.y<0);
  close(dir.x/Math.hypot(dir.x,dir.z),-Math.sin(yaw));close(dir.z/Math.hypot(dir.x,dir.z),-Math.cos(yaw));
}
for(const hand of [null,"hoe","pistol","flashlight"] as (HandItem|null)[])for(const aboard of [false,true])for(const rolling of [false,true]){
  assert.equal(flashlightActive(hand,aboard,rolling),hand==="flashlight"&&!aboard&&!rolling);
  assert(!flashlightActive(hand,aboard,rolling,false));
}
const engine=new NullEngine(),scene=new Scene(engine),sun=new DirectionalLight("sun",new Vector3(0,-1,0),scene),sunShadow=new ShadowGenerator(512,sun);
new HemisphericLight("sky",Vector3.Up(),scene);new DirectionalLight("fill",new Vector3(1,-1,0),scene);
for(let i=0;i<5;i++)new PointLight(`street-or-room-${i}`,new Vector3(i,2,0),scene);
const camera=new FreeCamera("test-camera",new Vector3(0,5,10),scene);camera.setTarget(Vector3.Zero());scene.activeCamera=camera;
const material=voxelMaterial(scene),roofMaterial=voxelMaterial(scene,"roof");
const rooms=buildRooms(scene,sunShadow,material,roofMaterial,[],[]);
const fakeGrass=MeshBuilder.CreateBox("flowers-crops-grasses",{size:1},scene);sunShadow.addShadowCaster(fakeGrass);
const trees=Array.from({length:60},(_,i)=>{const m=MeshBuilder.CreateBox("tree-trunk",{size:.15},scene);m.position.set((i%10-5)*.5,.5,-2-Math.floor(i/10)*.5);m.computeWorldMatrix(true);sunShadow.addShadowCaster(m);return m;});
for(const mesh of scene.meshes)mesh.computeWorldMatrix(true);
const farmer=createFarmer(scene,sunShadow),tools=createHeldTools(scene,farmer.hand,sunShadow);
const flashlight=createFlashlight(scene,tools.flashlightTip,sunShadow.getShadowMap()!.renderList!);
assert(flashlight.light instanceof SpotLight);assert(flashlight.light.isEnabled());assert(!flashlight.active);close(flashlight.light.intensity,0);
assert.equal(flashlight.light.falloffType,Light.FALLOFF_STANDARD);
// Mirror StandardMaterial's actual shader, not PBR-only innerAngle/GLTF fields.
const attenuation=(distance:number,angle:number)=>Math.max(0,1-distance/flashlight.light.range)*Math.pow(Math.max(0,Math.cos(angle)),flashlight.light.exponent);
assert(attenuation(2,0)>attenuation(6,0)&&attenuation(6,0)>attenuation(11,0));close(attenuation(12,0),0);
assert(attenuation(2,.10)>attenuation(2,.30)&&attenuation(2,.30)>attenuation(2,.60));
assert(Math.pow(Math.cos(flashlight.light.angle/2),flashlight.light.exponent)<.001,"Outer-cone cutoff is already below 0.1%: visibly soft, not a hard spot");
assert(flashlight.light.diffuse.r>flashlight.light.diffuse.b);assert(FLASHLIGHT.intensity>1);
assert.equal(material.maxSimultaneousLights,8);assert(scene.lights.indexOf(flashlight.light)<8);
assert.equal(flashlight.shadow.getShadowMap()!.getSize().width,512);
assert(flashlight.shadow.usePoissonSampling&&!flashlight.shadow.usePercentageCloserFiltering,"Spot uses color-sampled shadows: second PCF depth sampler breaks Chrome/ANGLE voxel draws");
assert(flashlight.shadow.transparencyShadow&&!flashlight.shadow.enableSoftTransparentShadow);
const update=(dt=1/60)=>flashlight.update("flashlight",farmer.body.rotation.y,farmer.root.position,false,false,dt);
tools.select("flashlight");
const model=scene.getMeshByName("equipped-flashlight")!,lens=scene.getMeshByName("flashlight-lens")!;
assert(model.isEnabled()&&lens.isEnabled());assert.equal(tools.flashlightTip.parent,model);
assert(!scene.getMeshByName("equipped-pistol")!.isEnabled());
for(const motion of [true,false])for(const running of [true,false])for(const yaw of [0,.7,-1.9])for(let frame=0;frame<70;frame++){
  farmer.body.rotation.y=yaw;farmer.animate(frame/60,1/60,true,running,false,0,motion,"flashlight",{movementYaw:yaw+.7});update();
  const p=tools.flashlightTip.getAbsolutePosition();close(Vector3.Distance(p,flashlight.light.position),0);
  assert(p.y>.55&&p.y<1.3,"Head stays safely above ground in idle/walk/run");
  const axis=Vector3.TransformNormal(new Vector3(0,-1,0),model.computeWorldMatrix(true)).normalize();
  assert(Vector3.Dot(axis,flashlight.light.direction)>.985,"Physical barrel aligns with beam even with locomotion lean");
}
farmer.body.rotation.y=0;farmer.animate(1,0,false,false,false,0,false,"flashlight");update();
assert(flashlight.active);
const pos=flashlight.light.position.clone(),direction=flashlight.light.direction.clone(),meshCount=scene.meshes.length,lightCount=scene.lights.length;
for(let i=0;i<100;i++){update(0);assert(flashlight.active);assert(flashlight.light.position.equals(pos));assert(flashlight.light.direction.equals(direction));}
assert.equal(scene.meshes.length,meshCount);assert.equal(scene.lights.length,lightCount);
assert(flashlight.shadow.getShadowMap()!.renderList!.length<=FLASHLIGHT.maxCasters);
assert(!flashlight.shadow.getShadowMap()!.renderList!.includes(fakeGrass));
assert(flashlight.shadow.getShadowMap()!.renderList!.some(m=>trees.includes(m as typeof trees[number])));
for(const hand of ["hoe","pistol",null] as (HandItem|null)[]){tools.select(hand);flashlight.update(hand,0,farmer.root.position,false,false,0);assert(!flashlight.active);assert(flashlight.light.isEnabled());close(flashlight.light.intensity,0);assert(!lens.isEnabled());}
tools.select("flashlight");flashlight.update("flashlight",0,farmer.root.position,true,false,0);assert(!flashlight.active);assert(flashlight.light.isEnabled());close(flashlight.light.intensity,0);
flashlight.update("flashlight",0,farmer.root.position,false,true,0);assert(!flashlight.active);assert(flashlight.light.isEnabled());close(flashlight.light.intensity,0);
tools.select(null);update();assert(!flashlight.active);assert(flashlight.light.isEnabled());close(flashlight.light.intensity,0);tools.select("flashlight");update();assert(flashlight.active);
// Real room walls are prioritized ahead of nearby tree casters; camera-faded
// walls still occlude, but the geometric doorway remains open.
const home=rooms[0],front=home.z-home.d/2;
farmer.root.position.set(home.x,0,front-1.1);farmer.body.rotation.y=Math.PI;
farmer.animate(0,1,false,false,false,0,false,"flashlight");update(1);
const facade=scene.getMeshByName(`${home.id}-front-walls`)!;facade.visibility=.11;
assert(flashlight.shadow.getShadowMap()!.renderList!.includes(facade));assert(flashlight.active);
const ray=new Ray(new Vector3(home.x,1,front-1),new Vector3(0,0,1),3);
assert(!ray.intersectsMesh(facade,false).hit,"Door opening is not filled by a fake full-house occluder");
ray.origin.x=home.x+2;assert(ray.intersectsMesh(facade,false).hit,"Faded facade still has solid wall geometry");
farmer.root.position.set(home.x+2,0,front-.35);farmer.animate(0,1,false,false,false,0,false,"flashlight");update(1);
assert(flashlight.active&&flashlight.light.isEnabled());close(flashlight.light.intensity,0);assert.equal(flashlight.shadow.getShadowMap()!.renderList!.length,0,"Hand poking through a wall cannot light the far side");
farmer.root.position.set(home.x+2,0,front-1.5);farmer.animate(0,1,false,false,false,0,false,"flashlight");update(1);assert(flashlight.active);
scene.shadowsEnabled=false;update();assert(flashlight.light.range<2,"No-shadow setting conservatively clips light before walls");scene.shadowsEnabled=true;update();close(flashlight.light.range,FLASHLIGHT.range);
// The real ground material is light-receiving; no emissive ground decal substitutes for the light.
const ground=MeshBuilder.CreateGround("flashlight-test-ground",{width:20,height:20},scene);ground.material=material;ground.receiveShadows=true;
scene.render();assert(ground.lightSources.includes(flashlight.light));assert(ground.lightSources.indexOf(flashlight.light)<material.maxSimultaneousLights);
const map=flashlight.shadow.getShadowMap()!;flashlight.dispose();flashlight.dispose();update();
assert(!scene.lights.includes(flashlight.light));assert(!scene.textures.includes(map));
console.log(JSON.stringify({result:"passed",checks:"SpotLight + actual StandardMaterial soft cosine cone/linear distance decay; 8-light priority; model/lens/tip + barrel alignment; walk/run/mobile hold; pause/no allocations; select/drop/boat/roll off; 512px bounded static casters; faded wall/door/hand-through-wall protection; no-shadows range fallback; receiving material + disposal",note:"NullEngine validates scene/model/shadow configuration, not GPU pixel luminance."}));
scene.dispose();engine.dispose();
