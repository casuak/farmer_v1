import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { Point } from "./farming";

/** Reusable crescent with a fine leading edge and a fading, tapered ribbon. */
export function createActionEffects(scene:Scene){
  const mesh=new Mesh("tool-swing-crescent",scene),data=new VertexData(),positions:number[]=[],colors:number[]=[],indices:number[]=[];
  for(let i=0;i<=32;i++){
    const u=i/32,angle=-1.2+u*2.4,tip=Math.sin(Math.PI*u);
    for(const edge of [0,1]){
      const r=1.62-(edge===0?.23*tip:0);
      positions.push(Math.sin(angle)*r,0,-Math.cos(angle)*r);colors.push(1,1,1,edge===0?.10:.85*tip);
    }
    if(i<32){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
  }
  data.positions=positions;data.indices=indices;data.colors=colors;data.normals=positions.map((_,i)=>i%3===1?1:0);data.applyToMesh(mesh);
  const material=new StandardMaterial("warm-swing-light",scene);material.disableLighting=true;material.emissiveColor=Color3.FromHexString("#ffdf8c");material.backFaceCulling=false;material.disableDepthWrite=true;material.alpha=.85;
  mesh.material=material;mesh.hasVertexAlpha=true;mesh.isPickable=false;mesh.setEnabled(false);
  let life=0,yaw=0;
  function swing(player:Point&{y?:number},heading:number,kind:"scythe"|"sword"){
    life=.35;yaw=heading;mesh.position.set(player.x,(player.y??0)+.46,player.z);mesh.setEnabled(true);
    material.emissiveColor=Color3.FromHexString(kind==="scythe"?"#ffe39a":"#bbebff");
  }
  function update(dt:number,motion:boolean){
    if(life<=0)return;life=Math.max(0,life-dt);
    const progress=1-life/.35;mesh.rotation.y=yaw+(motion?progress*1.4-.7:0);
    mesh.visibility=Math.sin(Math.PI*progress)*.92;mesh.scaling.setAll(.90+progress*.12);
    if(life===0)mesh.setEnabled(false);
  }
  return {swing,update,mesh};
}
