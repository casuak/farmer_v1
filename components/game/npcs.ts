import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Point } from "./farming";
import { moveWithCollisions } from "./movement";
import { Voxels,voxelMaterial } from "./voxel";

const RESIDENTS=[
  {name:"莉芙",color:"#c49389",line:"广场旁的绿屋顶就是松果杂货店。进门按 E，萝卜和贝壳都能卖！",route:[[4,18],[12,18],[12,20],[4,20]]},
  {name:"阿松",color:"#809aa4",line:"沿海岸木栈道往南走，再向海边拐，就到小船的码头了。",route:[[18,0],[26,0],[26,-3],[18,-3]]},
  {name:"米娅",color:"#d1b576",line:"樱花开的季节，连海风都带着一点甜味。",route:[[4.5,7],[12.5,7],[12.5,9],[4.5,9]]},
  {name:"奥利",color:"#819b75",line:"林间空地里有史莱姆。带上手枪，可以一边后退一边射击。",route:[[-20,7],[-20,16],[-18,16],[-18,7]]},
  {name:"艾达",color:"#a392af",line:"帆布背包只要 120 金币，穿上就多 8 格位置。",route:[[10,31],[12,31],[12,34],[10,34]]},
];

export function createResidents(scene:Scene,shadow:ShadowGenerator,canWalk:(x:number,z:number,r?:number)=>boolean) {
  const mat=voxelMaterial(scene,"village-residents");
  const residents=RESIDENTS.map((r,i)=>{
    const root=new TransformNode("resident-"+r.name,scene);root.position.set(r.route[0][0],0,r.route[0][1]);root.scaling.setAll(.93+(i%2)*.06);
    const torso=new Voxels().box(0,.80,0,.43,.58,.31,r.color).box(0,1.30,0,.42,.42,.35,"#e0b68e").box(0,1.50,.025,.46,.17,.39,i%2?"#7b6653":"#655444").box(0,1.64,.02,.59,.11,.46,i===3?"#648270":"#d9bd8a");
    for(const x of [-.09,.09])torso.box(x,1.31,-.185,.045,.055,.02,"#444b40");
    const tm=torso.build("resident-torso",scene,mat);tm.parent=root;shadow.addShadowCaster(tm);
    const limbs=[-1,1,-1,1].map((s,j)=>{
      const limb=new TransformNode("resident-limb",scene);limb.parent=root;limb.position.set(s*(j<2?.12:.29),j<2?.55:1.03,0);
      const v=new Voxels();if(j<2)v.box(0,-.23,0,.17,.43,.22,"#68756a").box(0,-.48,-.04,.20,.12,.30,"#775d47");else v.box(0,-.13,0,.16,.26,.20,r.color).box(0,-.31,0,.14,.20,.17,"#e0b68e");
      const m=v.build("resident-clothes",scene,mat);m.parent=limb;shadow.addShadowCaster(m);return limb;
    });
    return {...r,root,limbs,index:1,wait:i*.5,phase:i*2};
  });
  function update(dt:number,time:number,motion:boolean){
    for(const r of residents){
      let moving=false;
      if(r.wait>0)r.wait-=dt;else{
        const dest=r.route[r.index],dx=dest[0]-r.root.position.x,dz=dest[1]-r.root.position.z,length=Math.hypot(dx,dz);
        if(length<.14){r.index=(r.index+1)%r.route.length;r.wait=1.0+(r.index%2)*1.2;}
        else{const step=Math.min(length,dt*.88);moving=moveWithCollisions(r.root.position,dx/length*step,dz/length*step,(x,z)=>canWalk(x,z,.18));r.root.rotation.y=Math.atan2(-dx,-dz);if(!moving&&dt>0){r.index=(r.index+1)%r.route.length;r.wait=.7;}}
      }
      const gait=moving?Math.sin(time*7+r.phase):0;r.limbs.forEach((l,j)=>l.rotation.x=gait*(j%2?1:-1)*(j<2?.38:.28));r.root.position.y=motion&&moving?Math.abs(gait)*.025:0;
    }
  }
  function nearest(p:Point){return residents.filter(r=>Math.hypot(r.root.position.x-p.x,r.root.position.z-p.z)<2).sort((a,b)=>Math.hypot(a.root.position.x-p.x,a.root.position.z-p.z)-Math.hypot(b.root.position.x-p.x,b.root.position.z-p.z))[0]??null;}
  return {update,nearest,residents};
}
