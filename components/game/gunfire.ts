import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { Shot } from "./combat";
import { Voxels } from "./voxel";

export const MUZZLE_FLASH_LIFE=.10,TRACER_LIFE=.10,TRACER_LENGTH=1.8;
export function createGunfire(scene:Scene,muzzle:TransformNode){
  const light=new StandardMaterial("muzzle-flame-light",scene);light.disableLighting=true;light.emissiveColor=Color3.White();
  const flash=new Voxels().box(0,-.15,0,.23,.31,.23,"#ffc15b").box(0,-.22,0,.11,.43,.12,"#fff7ce")
    .box(0,-.13,0,.46,.085,.065,"#ffcf72").box(0,-.13,0,.065,.085,.42,"#ffcf72")
    .box(0,-.10,0,.15,.24,.15,"#fffef0").build("pistol-muzzle-flash",scene,light);
  flash.parent=muzzle;flash.receiveShadows=false;flash.setEnabled(false);
  const smokeMat=new StandardMaterial("gun-smoke-soft",scene);smokeMat.disableLighting=true;smokeMat.emissiveColor=Color3.FromHexString("#d9d6c3");smokeMat.alpha=.24;smokeMat.disableDepthWrite=true;
  const smoke=Array.from({length:6},()=>{const mesh=new Voxels().box(0,0,0,.13,.13,.13,"#ffffff").build("pistol-smoke",scene,smokeMat);mesh.receiveShadows=false;mesh.setEnabled(false);return {mesh,life:0,vx:0,vz:0};});
  let queued=false,life=0,cursor=0;
  function fire(){queued=true;}
  function update(dt:number,motion:boolean){
    const fresh=queued;
    if(fresh){
      queued=false;life=MUZZLE_FLASH_LIFE;muzzle.computeWorldMatrix(true);const p=muzzle.getAbsolutePosition();
      if(motion)for(let i=0;i<2;i++){const puff=smoke[cursor++%smoke.length],a=cursor*2.4;puff.life=.28;puff.vx=Math.cos(a)*.25;puff.vz=Math.sin(a)*.25;puff.mesh.position.copyFrom(p);puff.mesh.setEnabled(true);}
    }else life=Math.max(0,life-dt);
    flash.setEnabled(life>0);flash.visibility=life/MUZZLE_FLASH_LIFE;flash.scaling.setAll(.7+.3*life/MUZZLE_FLASH_LIFE);
    for(const puff of smoke)if(puff.life>0){
      if(!fresh)puff.life=Math.max(0,puff.life-dt);
      puff.mesh.setEnabled(motion&&puff.life>0);if(!motion)continue;
      puff.mesh.position.x+=puff.vx*dt;puff.mesh.position.z+=puff.vz*dt;puff.mesh.position.y+=dt*.48;
      puff.mesh.scaling.setAll(1+(1-puff.life/.28)*1.4);puff.mesh.visibility=puff.life/.28;
    }
  }
  return {fire,update,flash,smoke};
}

/** Warm outlines and long tapered tails remain legible on pale terrain, even without bloom. */
export function createBulletTrails(scene:Scene,shots:readonly Shot[]){
  const ink=new StandardMaterial("bright-projectile-ink",scene);ink.disableLighting=true;ink.emissiveColor=Color3.White();
  const glow=new StandardMaterial("amber-projectile-tracer",scene);glow.disableLighting=true;glow.emissiveColor=Color3.FromHexString("#ffbd50");glow.disableDepthWrite=true;glow.backFaceCulling=false;
  const views=shots.map((shot,i)=>{
    const root=new TransformNode("projectile-flight-"+i,scene);root.setEnabled(false);
    const head=new Voxels().box(0,0,0,.20,.15,.70,"#df8734").box(0,.007,-.04,.11,.17,.59,"#fffbd5").box(0,0,-.36,.11,.11,.17,"#fff8bb").build("pistol-projectile",scene,ink);head.parent=root;head.receiveShadows=false;
    const tail=new Mesh("pistol-tracer",scene),v=new VertexData();
    v.positions=[-.14,0,0,.14,0,0,-.018,0,1,.018,0,1,0,-.10,0,0,.10,0,0,-.013,1,0,.013,1];
    v.indices=[0,1,2,2,1,3,4,6,5,5,6,7];v.colors=[1,1,1,.82,1,1,1,.82,1,1,1,0,1,1,1,0,1,1,1,.82,1,1,1,.82,1,1,1,0,1,1,1,0];
    v.normals=[];VertexData.ComputeNormals(v.positions,v.indices,v.normals);v.applyToMesh(tail);tail.parent=root;tail.material=glow;tail.hasVertexAlpha=true;tail.isPickable=false;tail.receiveShadows=false;tail.position.z=.12;
    return {root,head,tail,shot,generation:0,life:0};
  });
  function update(dt:number){
    for(const v of views){
      const s=v.shot,fresh=s.generation!==v.generation;
      if(fresh){v.generation=s.generation;v.life=TRACER_LIFE;}
      else if(s.active)v.life=TRACER_LIFE;else v.life=Math.max(0,v.life-dt);
      v.root.setEnabled(s.active||v.life>0);if(!v.root.isEnabled())continue;
      v.root.position.set(s.x,s.y,s.z);v.root.rotation.y=Math.atan2(-s.dx,-s.dz);
      const length=Math.min(TRACER_LENGTH,Math.max(0,s.travelled-.12)),opacity=s.active?1:v.life/TRACER_LIFE;
      v.tail.setEnabled(length>.03);v.tail.scaling.z=length;v.tail.visibility=opacity;v.head.visibility=opacity;
    }
  }
  return {views,update};
}
