import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Point } from "./farming";
import { moveWithCollisions } from "./movement";
import { Voxels,voxelMaterial } from "./voxel";

export const VILLAGER_HEALTH=3,PANIC_SECONDS=4.5,STARTLED_SECONDS=9,FLEE_SPEED=3.4,RESIDENT_FLASH=.22;
const KNOCKBACK=2.4,KNOCKBACK_DRAG=12,RECOVER_SECONDS=22;
const CRIES=["哎哟！好疼！","别打我！救命！","有话好说，别开枪！"];
const PANIC_LINE="救命！别追我！",INJURED_LINE="刚才那一下好疼……让我缓一缓";

const RESIDENTS=[
  {name:"莉芙",color:"#c49389",line:"广场旁的绿屋顶就是松果杂货店。进门按 E，萝卜和贝壳都能卖！",route:[[4,18],[12,18],[12,20],[4,20]]},
  {name:"阿松",color:"#809aa4",line:"沿海岸木栈道往南走，再向海边拐，就到小船的码头了。",route:[[18,0],[26,0],[26,-3],[18,-3]]},
  {name:"米娅",color:"#d1b576",line:"樱花开的季节，连海风都带着一点甜味。",route:[[4.5,7],[12.5,7],[12.5,9],[4.5,9]]},
  {name:"奥利",color:"#819b75",line:"林间空地里有史莱姆。带上手枪，可以一边后退一边射击。",route:[[-20,7],[-20,16],[-18,16],[-18,7]]},
  {name:"艾达",color:"#a392af",line:"帆布背包只要 120 金币，穿上就多 8 格位置。",route:[[10,31],[12,31],[12,34],[10,34]]},
];

export type Resident={
  name:string;color:string;line:string;route:number[][];
  root:TransformNode;limbs:TransformNode[];meshes:Mesh[];seed:number;
  index:number;wait:number;phase:number;
  hp:number;flash:number;flashy:boolean;panic:number;nervous:number;regen:number;
  knockX:number;knockZ:number;fleeX:number;fleeZ:number;retarget:number;blocked:number;
  hurt:(damage:number,dx:number,dz:number)=>void;cry:()=>string;lineNow:()=>string;
};

export function createResidents(scene:Scene,shadow:ShadowGenerator,canWalk:(x:number,z:number,r?:number)=>boolean) {
  const mat=voxelMaterial(scene,"village-residents");
  const bright=new StandardMaterial("resident-hit-red",scene);bright.disableLighting=true;bright.emissiveColor=Color3.FromHexString("#ff6557");
  const residents:Resident[]=RESIDENTS.map((r,i)=>{
    const root=new TransformNode("resident-"+r.name,scene);root.position.set(r.route[0][0],0,r.route[0][1]);root.scaling.setAll(.93+(i%2)*.06);
    const torso=new Voxels().box(0,.80,0,.43,.58,.31,r.color).box(0,1.30,0,.42,.42,.35,"#e0b68e").box(0,1.50,.025,.46,.17,.39,i%2?"#7b6653":"#655444").box(0,1.64,.02,.59,.11,.46,i===3?"#648270":"#d9bd8a");
    for(const x of [-.09,.09])torso.box(x,1.31,-.185,.045,.055,.02,"#444b40");
    const tm=torso.build("resident-torso",scene,mat);tm.parent=root;shadow.addShadowCaster(tm);
    const limbMeshes:Mesh[]=[];
    const limbs=[-1,1,-1,1].map((s,j)=>{
      const limb=new TransformNode("resident-limb",scene);limb.parent=root;limb.position.set(s*(j<2?.12:.29),j<2?.55:1.03,0);
      const v=new Voxels();if(j<2)v.box(0,-.23,0,.17,.43,.22,"#68756a").box(0,-.48,-.04,.20,.12,.30,"#775d47");else v.box(0,-.13,0,.16,.26,.20,r.color).box(0,-.31,0,.14,.20,.17,"#e0b68e");
      const m=v.build("resident-clothes",scene,mat);m.parent=limb;shadow.addShadowCaster(m);limbMeshes.push(m);return limb;
    });
    const resident:Resident={
      ...r,root,limbs,meshes:[tm,...limbMeshes],seed:i,index:1,wait:i*.5,phase:i*2,
      hp:VILLAGER_HEALTH,flash:0,flashy:false,panic:0,nervous:0,regen:0,knockX:0,knockZ:0,fleeX:0,fleeZ:0,retarget:0,blocked:0,
      hurt(damage:number,dx:number,dz:number){
        this.hp=Math.max(0,this.hp-damage);this.flash=RESIDENT_FLASH;this.panic=PANIC_SECONDS;this.nervous=STARTLED_SECONDS;this.regen=0;
        const length=Math.hypot(dx,dz)||1;
        this.knockX=dx/length*KNOCKBACK;this.knockZ=dz/length*KNOCKBACK;
        this.fleeX=dx/length;this.fleeZ=dz/length;this.retarget=0;this.blocked=0;
      },
      cry(){return CRIES[(this.seed*2+1)%CRIES.length];},
      lineNow(){return this.panic>0?PANIC_LINE:this.hp<VILLAGER_HEALTH?INJURED_LINE:this.line;},
    };
    return resident;
  });
  function recoil(r:Resident,dt:number){
    const decay=Math.exp(-KNOCKBACK_DRAG*dt),dx=r.knockX*(1-decay)/KNOCKBACK_DRAG,dz=r.knockZ*(1-decay)/KNOCKBACK_DRAG;
    moveWithCollisions(r.root.position,dx,dz,(x,z)=>canWalk(x,z,.18));
    r.knockX*=decay;r.knockZ*=decay;
    if(Math.hypot(r.knockX,r.knockZ)<.01)r.knockX=r.knockZ=0;
  }
  function update(dt:number,time:number,motion:boolean,player?:Point){
    for(const r of residents){
      if(r.knockX||r.knockZ)recoil(r,dt);
      r.flash=Math.max(0,r.flash-dt);
      let moving=false;const panicking=r.panic>0;
      if(panicking){
        r.panic=Math.max(0,r.panic-dt);r.retarget-=dt;
        if(r.retarget<=0){
          r.retarget=.26+(r.seed%3)*.04;
          const dx=r.root.position.x-(player?.x??r.root.position.x-r.fleeX),dz=r.root.position.z-(player?.z??r.root.position.z-r.fleeZ);
          const length=Math.hypot(dx,dz),base=length>.1?Math.atan2(dx,dz)+Math.sin(time*3.9+r.phase)*.5:Math.atan2(r.fleeX,r.fleeZ);
          r.fleeX=Math.sin(base);r.fleeZ=Math.cos(base);
        }
        const speed=FLEE_SPEED*dt;
        if(speed>0){
          moving=moveWithCollisions(r.root.position,r.fleeX*speed,r.fleeZ*speed,(x,z)=>canWalk(x,z,.18));
          if(!moving){
            const px=r.fleeX,pz=r.fleeZ,side=Math.sin(time*2.3+r.phase)>.15?1:-1;
            for(const [tx,tz] of side>0?[[pz,-px],[-pz,px]]:[[-pz,px],[pz,-px]]){
              if(moveWithCollisions(r.root.position,tx*speed,tz*speed,(x,z)=>canWalk(x,z,.18))){r.fleeX=tx;r.fleeZ=tz;moving=true;break;}
            }
          }
        }
        r.blocked=moving?0:r.blocked+1;
        r.root.rotation.y=Math.atan2(-r.fleeX,-r.fleeZ);
      } else if(r.wait>0)r.wait-=dt; else {
        const dest=r.route[r.index],dx=dest[0]-r.root.position.x,dz=dest[1]-r.root.position.z,length=Math.hypot(dx,dz);
        if(length<.14){r.index=(r.index+1)%r.route.length;r.wait=1.0+(r.index%2)*1.2;}
        else{const step=Math.min(length,dt*.88);moving=moveWithCollisions(r.root.position,dx/length*step,dz/length*step,(x,z)=>canWalk(x,z,.18));r.root.rotation.y=Math.atan2(-dx,-dz);if(!moving&&dt>0){r.index=(r.index+1)%r.route.length;r.wait=.7;}}
      }
      r.nervous=Math.max(0,r.nervous-dt);
      if(r.panic<=0&&r.hp<VILLAGER_HEALTH){r.regen+=dt;if(r.regen>=RECOVER_SECONDS){r.regen=0;r.hp++;}}
      const gait=moving&&!panicking?Math.sin(time*7+r.phase):0;
      if(panicking){
        // 恐慌逃跑：双手向前扑，双腿急促倒腾。
        const scramble=Math.sin(time*13+r.phase*1.7),tremble=Math.sin(time*27+r.phase*3);
        r.limbs[0].rotation.x=scramble*.95;r.limbs[1].rotation.x=-scramble*.95;
        r.limbs[0].rotation.z=r.limbs[1].rotation.z=0;r.limbs[2].rotation.z=-.26;r.limbs[3].rotation.z=.26;
        r.limbs[2].rotation.x=1.48+tremble*.09;r.limbs[3].rotation.x=1.48-tremble*.09;
        r.root.position.y=motion?Math.abs(scramble)*.05:0;
      } else {
        const shake=r.nervous>0&&motion?Math.sin(time*23+r.phase)*.05:0;
        r.limbs.forEach((l,j)=>l.rotation.x=gait*(j%2?1:-1)*(j<2?.38:.28));
        r.limbs[2].rotation.x+=shake;r.limbs[3].rotation.x-=shake;
        r.limbs[2].rotation.z=r.limbs[3].rotation.z=0;
        r.root.position.y=r.nervous>0&&!moving&&motion?Math.abs(Math.sin(time*9+r.phase))*.018:motion&&moving?Math.abs(gait)*.025:0;
      }
      const flashy=r.flash>0;
      if(flashy!==r.flashy){r.flashy=flashy;for(const m of r.meshes){m.material=flashy?bright:mat;m.useVertexColors=!flashy;}}
    }
  }
  function nearest(p:Point){return residents.filter(r=>Math.hypot(r.root.position.x-p.x,r.root.position.z-p.z)<2).sort((a,b)=>Math.hypot(a.root.position.x-p.x,a.root.position.z-p.z)-Math.hypot(b.root.position.x-p.x,b.root.position.z-p.z))[0]??null;}
  return {update,nearest,residents};
}
