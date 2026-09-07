import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Voxels,voxelMaterial } from "../components/game/voxel";
import { buildWorld } from "../components/game/world";
import { createFarmCamera,SPAWN } from "../components/game/engine";
import { BRIDGES,GARDEN,riverCenter } from "../components/game/geography";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { FarmModel,GROWTH_SECONDS,MAP_WIDTH,MAP_DEPTH,worldToTile,inReach,tileKey,type TileKind } from "../components/game/farming";
import { createFarmView,createHeldTools } from "../components/game/farmView";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { WALK_SPEED,SPRINT_SPEED,moveWithCollisions } from "../components/game/movement";
import { createSpringLighting } from "../components/game/lighting";
import { verifyExpansion } from "./verify-expansion";
import { verifyRendering } from "./verify-rendering";
import { verifyDaylight } from "./verify-daylight";
import { verifyShadowAndLamps } from "./verify-shadow-lamps";
import { verifyWildlife } from "./verify-wildlife";
import { verifyAudio } from "./verify-audio";
import { verifyRiverFish } from "./verify-river-fish";
import { verifyActions } from "./verify-actions";
import { verifyCombatFeedback,verifyMovingShooting } from "./verify-combat-feedback";
import { verifyDistrictsAndGunfire } from "./verify-districts-gunfire";
import { verifyVillagers } from "./verify-villagers";
import { verifyFishingView } from "./verify-fishing-view";
import "./verify-fishing";

await verifyRendering();
verifyWildlife();
verifyRiverFish();
verifyAudio();

const engine=new NullEngine();const scene=new Scene(engine);
// Exercise the full-resolution desktop path; render regression covers small caps.
engine.getCaps().maxTextureSize=4096;engine.getCaps().maxRenderTextureSize=4096;
const camera=createFarmCamera(scene);
camera.orthoTop=16;camera.orthoBottom=-16;camera.orthoLeft=-26;camera.orthoRight=26;
const lighting=createSpringLighting(scene,camera),shadow=lighting.shadow;
const w=buildWorld(scene,shadow);
// NullEngine retains raw pixels but never completes GPU uploads. Model that completion
// only in this test; material compilation/readiness below still runs normally.
for(const name of ["soft-ground-contact","street-light-falloff"]){
  const texture=scene.textures.find(t=>t.name===name)!.getInternalTexture()!;
  assert(texture._bufferView&&texture._bufferView.byteLength>0,`${name}: procedural pixels are generated`);
  texture.isReady=true;
}
for(const target of [new Vector3(10,0,0),new Vector3(-14,0,9),new Vector3(-1.6,0,1),new Vector3(38,0,-25),new Vector3(-38,0,30)]) {
  camera.setTarget(target);camera.getViewMatrix(true);
  assert.equal(camera.mode,Camera.ORTHOGRAPHIC_CAMERA);
  assert.equal(camera.alpha,-Math.PI/4);assert.equal(camera.beta,Math.PI/4);assert.equal(camera.radius,65);
}
assert.equal(w.tiles.length,MAP_WIDTH*MAP_DEPTH);
assert.equal(new Set(w.tiles.map(t=>tileKey(t.x,t.z))).size,MAP_WIDTH*MAP_DEPTH);
assert(w.tiles.every(t=>Number.isInteger(t.x)&&Number.isInteger(t.z)),"All tiles use the same integer lattice");
assert.deepEqual(worldToTile({x:-.01,z:-.99}),{x:-1,z:-1});
assert(w.canWalk(SPAWN.x,SPAWN.z));
for(const p of [{x:-26,z:-13},{x:-31.1,z:-18.2},{x:-30,z:-33.6},{x:0,z:40},{x:48,z:0},{x:riverCenter(5),z:5},{x:-4,z:1.62}])assert(!w.canWalk(p.x,p.z));
for(const b of BRIDGES)for(let x=b.x-b.w/2;x<b.x+b.w/2;x+=.1)assert(w.canWalk(x,b.z),"The full bridge remains walkable");
assert.equal(WALK_SPEED,6);assert.equal(SPRINT_SPEED,9);
const fenceRunner={x:-30,z:-32.5};moveWithCollisions(fenceRunner,0,-5,w.canWalk);assert(fenceRunner.z>-33.3,"Fast movement cannot cross a thin fence");
const riverRunner={x:-8,z:5};moveWithCollisions(riverRunner,8,0,w.canWalk);assert(riverRunner.x<-3,"Fast movement cannot cross water");
const bridgeRunner={x:-8.8,z:0};moveWithCollisions(bridgeRunner,9.5,0,w.canWalk);assert(Math.abs(bridgeRunner.x-.7)<.001);
verifyExpansion(scene,w,lighting);
verifyDaylight(scene,camera,w,lighting);
verifyShadowAndLamps(scene,w,lighting);
verifyActions(scene,w,shadow);
verifyCombatFeedback(scene,shadow);
verifyMovingShooting(scene,shadow);
verifyDistrictsAndGunfire(scene,w,shadow);
verifyVillagers(scene,shadow,w);
verifyFishingView(scene,camera,shadow,w);

const farm=new FarmModel(w.tiles,w.clearReach),target={x:-22,z:-24},player={...SPAWN};
assert.equal(farm.get(-26,-13)!.kind,"building");assert.equal(farm.get(Math.floor(riverCenter(5)),5)!.kind,"water");assert.equal(farm.get(GARDEN.x+1,GARDEN.z+1)!.kind,"dirt");
assert.equal(farm.get(target.x,target.z)!.kind,"grass");
assert(inReach(player,target));assert(!inReach(player,{x:0,z:0}));
assert(!farm.use("seeds",target,player).ok,"Seeds require tilled soil");
assert(!farm.use("water",target,player).ok,"Watering requires tilled soil");
assert(!farm.use("hoe",{x:0,z:0},player).ok,"Tools cannot act remotely");
assert(farm.use("hoe",target,player).ok);
assert(farm.use("seeds",target,player).ok);assert.equal(farm.inventory.seeds,23);
assert(!farm.use("seeds",target,player).ok);assert.equal(farm.inventory.seeds,23);
assert(!farm.use("hoe",target,player).ok,"Hoe cannot destroy a crop");
farm.update(50);assert.equal(farm.get(target.x,target.z)!.crop!.age,0,"Dry crops wait for water");
assert(!farm.use("scythe",target,player).ok,"Immature crops cannot be harvested");
assert(farm.use("water",target,player).ok);assert(!farm.use("water",target,player).ok);
const view=createFarmView(scene,shadow,w.tiles,w.clearTile);view.updateTile(farm.get(target.x,target.z)!);
for(let stage=1;stage<=4;stage++){
  const changed=farm.update(6);assert.equal(changed.length,1);assert.equal(changed[0].crop!.stage,stage);view.updateTile(changed[0]);
}
assert.equal(farm.get(target.x,target.z)!.crop!.age,GROWTH_SECONDS);
assert.equal(farm.inspect(target,player,"scythe")!.actionable,true);
assert(farm.use("scythe",target,player).ok);assert.equal(farm.inventory.turnips,1);assert.equal(farm.inventory.seeds,25);
assert.equal(farm.get(target.x,target.z)!.crop,null);assert.equal(farm.get(target.x,target.z)!.watered,false);assert(farm.get(target.x,target.z)!.tilled);
view.updateTile(farm.get(target.x,target.z)!);
assert(!farm.use("scythe",target,player).ok);assert.equal(farm.inventory.turnips,1);
assert.deepEqual(player,SPAWN,"Tool actions do not move the player");
const plotMeshCount=scene.meshes.length;
for(let i=0;i<4;i++)view.updateTile(farm.get(target.x,target.z)!);
assert.equal(scene.meshes.length,plotMeshCount,"Updating a plot disposes old meshes");
farm.bag.remove("seeds",farm.inventory.seeds);assert(!farm.use("seeds",target,player).ok);assert.equal(farm.inventory.seeds,0);
for(const kind of ["building","tree","rock","water","path","bank","bridge","fence","decoration","sea","sand","dock","floor"] as TileKind[]){
  const protectedFarm=new FarmModel([{x:0,z:0,kind}]);assert(!protectedFarm.use("hoe",{x:0,z:0},{x:.5,z:.5}).ok);
}
const blocked=new FarmModel([{x:0,z:0,kind:"grass"}],()=>false);
assert(!blocked.use("hoe",{x:0,z:0},{x:.5,z:.5}).ok,"A fence can block an otherwise adjacent tile");
assert(!farm.inspect(target,player,"hoe","building")!.actionable,"A roof pick must not till ground behind the roof");
view.hover(farm.inspect(target,player,"seeds"));view.effect(target,"water");view.update(3,.016,true,player,true,true);
const hand=new TransformNode("test-hand",scene),tools=createHeldTools(scene,hand,shadow);
for(const tool of ["hoe","seeds","water","scythe"] as const){tools.select(tool);assert.equal(scene.meshes.filter(m=>m.name.startsWith("equipped-")&&m.isEnabled()).length,1);}

const box=new Voxels().box(0,0,0,1,1,1,"#ffffff").build("winding-probe",scene,voxelMaterial(scene));
const positions=box.getVerticesData("position")!,given=box.getVerticesData("normal")!,computed:number[]=[];
VertexData.ComputeNormals(positions,box.getIndices()!,computed);
for(let i=0;i<computed.length;i+=3)assert(computed[i]*given[i]+computed[i+1]*given[i+1]+computed[i+2]*given[i+2]>.99);
const petals=scene.getMeshByName("falling-cherry-blossoms")!;
w.update(1,true);const before=Array.from(petals.getVerticesData("position")!);
w.update(3,true);const after=Array.from(petals.getVerticesData("position")!);
assert(before.some((n,i)=>n!==after[i]),"Petals move with the wind");
w.update(8,false);const still=Array.from(petals.getVerticesData("position")!);w.update(12,false);
assert.deepEqual(Array.from(petals.getVerticesData("position")!),still,"Ambient motion respects the motion toggle");
// Regression: petals must cover the visible frame, including when no cherry tree is in view.
const petalCoverage:string[]=[];
for(const [label,aspect,halfHeight,x,z] of [
  ["desktop",16/9,15.8,-1.6,1],
  ["ultrawide-75%",21/9,15.8/.75,14,-10],
  ["desktop-160%",16/9,15.8/1.6,-14,12],
  ["portrait",9/19.5,13,15,-11],
  ["portrait-75%",9/19.5,13/.75,-12,12],
  ["portrait-160%",9/19.5,13/1.6,4,-12],
] as const) {
  camera.orthoTop=halfHeight;camera.orthoBottom=-halfHeight;
  camera.orthoLeft=-halfHeight*aspect;camera.orthoRight=halfHeight*aspect;
  camera.setTarget(new Vector3(x,0,z));camera.getViewMatrix(true);camera.getProjectionMatrix(true);
  w.update(13+petalCoverage.length,true);
  const clipMatrix=petals.computeWorldMatrix(true).multiply(camera.getViewMatrix().multiply(camera.getProjectionMatrix()));
  const points=petals.getVerticesData("position")!,colors=petals.getVerticesData("color")!;
  const regions=new Set<number>(),edges=new Set<string>();
  for(let i=0;i<points.length;i+=3) {
    if(colors[i/3*4+3]<.5)continue;
    const p=Vector3.TransformCoordinates(new Vector3(points[i],points[i+1],points[i+2]),clipMatrix);
    const u=p.x*.5+.5,v=p.y*.5+.5;
    if(u<=0||u>=1||v<=0||v>=1||p.z<-1||p.z>1)continue;
    regions.add(Math.floor(u*3)+Math.floor(v*3)*3);
    if(u<.1)edges.add("left");if(u>.9)edges.add("right");if(v<.1)edges.add("bottom");if(v>.9)edges.add("top");
  }
  assert.equal(regions.size,9,`${label}: visible petals cover all nine screen regions`);
  assert.equal(edges.size,4,`${label}: petals reach every screen edge`);
  petalCoverage.push(label);
}
for(const m of scene.meshes){const p=m.getVerticesData("position");if(p)assert(Array.from(p).every(Number.isFinite));}
w.update(20,true,{x:SPAWN.x,y:.16,z:SPAWN.z},true);
assert.equal(scene.getMeshByName("farmer-contact-shadow")!.position.y,.187,"Contact shadow follows bridge height");
w.update(20,true,{x:SPAWN.x,y:0,z:SPAWN.z},false);
assert(!scene.getMeshByName("farmer-contact-shadow")!.isEnabled());
assert(!scene.getMeshByName("soft-object-contact-shadows")!.isEnabled(),"Shadow setting disables ground contacts too");
lighting.setBloom(false);scene.render();lighting.setBloom(true);
scene.onReadyTimeoutDuration=8000;
await Promise.race([
  scene.whenReadyAsync(),
  new Promise<never>((_,reject)=>scene.onReadyTimeoutObservable.addOnce(()=>reject(new Error("Scene materials failed to become ready")))),
]);
scene.render();
console.log(JSON.stringify({result:"passed",checks:"7680 tiles, connected biomes and room entries, furniture collisions, toggle walk 2x/run 3x, distinct run animation, sailing and landing, gold and stack capacity, drop/recover, store purchases/sales/backpack, farming regression, ocean/wildlife/NPC movement and villager panic flight, full-screen blossoms, shadows, material readiness and NullEngine frames",petalCoverage,tiles:w.tiles.length,meshes:scene.meshes.length,vertices:scene.meshes.reduce((n,m)=>n+m.getTotalVertices(),0)}));
scene.dispose();engine.dispose();
