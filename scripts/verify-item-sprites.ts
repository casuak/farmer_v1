import assert from "node:assert/strict";
import sharp from "sharp";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { ITEMS,type ItemId } from "../components/game/inventory";
import { ITEM_SPRITES } from "../components/game/itemSprites";
import { FISH_SPRITES } from "../components/game/fishSprites";
import { GroundItems,createGroundItemView } from "../components/game/droppedItems";
import { createFarmCamera } from "../components/game/engine";

const ids=Object.keys(ITEMS) as ItemId[];
assert.deepEqual(Object.keys(ITEM_SPRITES).sort(),[...ids].sort());
for(const id of ids){
  const {data,info}=await sharp('public'+ITEM_SPRITES[id]).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,128);assert.equal(info.height,128);
  let opaque=0,transparent=0;
  for(let i=0;i<data.length;i+=4){
    if(!data[i+3]){transparent++;continue;}
    opaque++;
    assert(!(data[i]>155&&data[i+2]>145&&data[i+1]<115&&Math.min(data[i],data[i+2])-data[i+1]>85),id+': no magenta key pixels');
  }
  assert(opaque>1000&&transparent>1000,id+': recognizable isolated art with alpha');
}
for(const id of Object.keys(FISH_SPRITES) as (keyof typeof FISH_SPRITES)[])assert.equal(FISH_SPRITES[id],ITEM_SPRITES[id]);
const engine=new NullEngine(),scene=new Scene(engine),camera=createFarmCamera(scene);
camera.getViewMatrix(true);camera.getProjectionMatrix(true);scene.updateTransformMatrix();
const ground=new GroundItems(),view=createGroundItemView(scene,ground,()=>.2);
for(const [i,id] of ids.entries())ground.add({id,count:1},{x:-30+i*.7,z:-10});
view.update(0,true);
const mats=scene.materials.length,textures=scene.textures.length;
for(const item of ground.items){
  const mesh=scene.getMeshByName('dropped-'+item.stack.id)!;
  assert.equal(mesh.billboardMode,Mesh.BILLBOARDMODE_ALL);assert.equal(mesh.isPickable,false);
  const material=mesh.material as StandardMaterial,texture=material.diffuseTexture as Texture;
  assert.equal(texture.url,ITEM_SPRITES[item.stack.id]);assert(texture.hasAlpha);assert.equal(texture.samplingMode,Texture.NEAREST_SAMPLINGMODE);
  mesh.computeWorldMatrix(true);assert(mesh.getBoundingInfo().boundingBox.minimumWorld.y>=.207);
  assert.equal(mesh.metadata.airborne,false);assert(view.center(item.id));
}
for(const [i,id] of ids.entries())ground.add({id,count:1},{x:-30+i*.7,z:-7});
view.update(1,true);assert.equal(scene.materials.length,mats);assert.equal(scene.textures.length,textures,'No duplicate per-instance textures');
const positions=scene.meshes.filter(m=>m.name.startsWith('dropped-')).map(m=>m.position.clone());
view.update(2,true);scene.meshes.filter(m=>m.name.startsWith('dropped-')).forEach((m,i)=>assert(m.position.equalsWithEpsilon(positions[i]),'Landed art does not hover or rotate'));
const airborne=ground.eject([{id:"seeds",count:24}],{x:-24,y:.9,z:-10},{x:-23,z:-10},()=>true,()=>true)[0];
for(let i=0;i<4;i++)ground.update(.1);
view.update(3,true);const frozen=view.center(airborne.id)!.asArray();
for(let i=0;i<60;i++){view.update(3,true);assert.deepEqual(view.center(airborne.id)!.asArray(),frozen,'Repeated paused view updates never feed Float32 translation drift into the arc');}
ground.items=[];view.update(3,true);assert.equal(scene.meshes.filter(m=>m.name.startsWith('dropped-')||m.name==='pickup-ring').length,0);
scene.dispose();engine.dispose();
console.log(JSON.stringify({result:'passed',items:ids.length,checks:'all generated PNGs 128px / transparency / no chroma background; fish alias; ground identical texture URLs; alpha-tested camera-facing sprites; actual floor contact; stationary landed items; shared material cache; removed meshes cleaned'}));
