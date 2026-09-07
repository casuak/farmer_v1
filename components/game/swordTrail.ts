import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { SWORD } from "./swordMotion";

const SAMPLES=12,FADE_SECONDS=.085;
/** Short translucent ribbon sampled from the ACTUAL blade, only during the cutting stroke. */
export function createSwordTrail(scene:Scene,base:TransformNode,tip:TransformNode){
  const mesh=new Mesh("sword-blade-trail",scene),data=new VertexData(),positions=new Float32Array(SAMPLES*6),colors=new Float32Array(SAMPLES*8),indices:number[]=[];
  for(let i=0;i<SAMPLES-1;i++){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
  data.positions=positions;data.colors=colors;data.indices=indices;data.applyToMesh(mesh,true);
  const mat=new StandardMaterial("sword-steel-afterimage",scene);mat.disableLighting=true;mat.emissiveColor=Color3.FromHexString("#d5eff3");mat.backFaceCulling=false;mat.disableDepthWrite=true;mat.alpha=.42;mat.specularColor=Color3.Black();
  mesh.material=mat;mesh.hasVertexAlpha=true;mesh.isPickable=false;mesh.alwaysSelectAsActiveMesh=true;mesh.setEnabled(false);
  const samples=Array.from({length:SAMPLES},()=>({base:new Vector3(),tip:new Vector3(),age:FADE_SECONDS}));
  let count=0,lastElapsed=0;
  function clear(){count=0;lastElapsed=0;mesh.setEnabled(false);}
  function update(elapsed:number|null,dt:number,motion:boolean){
    if(!motion){clear();return;}
    const step=Number.isFinite(dt)?Math.max(0,Math.min(.045,dt)):0;
    if(elapsed!==null&&elapsed<lastElapsed)clear();
    lastElapsed=elapsed??0;
    // dt=0 means pause: don't age or insert duplicate vertices.
    if(step===0)return;
    for(let i=0;i<count;i++)samples[i].age+=step;
    while(count>0&&samples[0].age>=FADE_SECONDS){for(let i=1;i<count;i++){samples[i-1].base.copyFrom(samples[i].base);samples[i-1].tip.copyFrom(samples[i].tip);samples[i-1].age=samples[i].age;}count--;}
    if(elapsed!==null&&elapsed>=SWORD.windup&&elapsed<=SWORD.cutEnd){
      if(count===SAMPLES){for(let i=1;i<count;i++){samples[i-1].base.copyFrom(samples[i].base);samples[i-1].tip.copyFrom(samples[i].tip);samples[i-1].age=samples[i].age;}count--;}
      base.computeWorldMatrix(true);tip.computeWorldMatrix(true);const a=base.getAbsolutePosition(),b=tip.getAbsolutePosition(),s=samples[count++];
      Vector3.LerpToRef(a,b,.25,s.base);s.tip.copyFrom(b);s.age=0;
    }
    mesh.setEnabled(count>=2);if(count<2)return;
    for(let i=0;i<SAMPLES;i++){
      const sample=samples[Math.min(i,count-1)],fade=Math.max(0,1-sample.age/FADE_SECONDS);
      for(let edge=0;edge<2;edge++){
        const p=edge?sample.tip:sample.base,vertex=i*2+edge,j=vertex*3,c=vertex*4;
        positions[j]=p.x;positions[j+1]=p.y;positions[j+2]=p.z;
        colors[c]=colors[c+1]=colors[c+2]=1;colors[c+3]=i<count?fade*(edge?.70:.025):0;
      }
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind,positions);mesh.updateVerticesData(VertexBuffer.ColorKind,colors);
  }
  return {update,clear,mesh};
}
