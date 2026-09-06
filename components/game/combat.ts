import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Voxels,voxelMaterial,seededRandom } from "./voxel";
import type { Point } from "./farming";
export type Weapon="pistol"|"sword";
export type Slime={x:number;z:number;home:Point;hp:number;yaw:number;phase:number;wait:number;travel:number;flash:number;respawn:number};
export type Shot={active:boolean;x:number;z:number;y:number;dx:number;dz:number;remaining:number};
export const SLIME_HEALTH=3;
export class CombatModel{
  readonly slimes:Slime[]=[];
  readonly shots:Shot[]=Array.from({length:8},()=>({active:false,x:0,z:0,y:.85,dx:0,dz:0,remaining:0}));
  private random=seededRandom(53871);
  private cooldown=0;
  constructor(private canWalk:(x:number,z:number,r?:number)=>boolean,private clearLine:(a:Point,b:Point)=>boolean){
    for(const [x,z] of [[-22,-3],[-24,2],[-27,-6],[-30,5],[-25,12],[-31,17],[-27,-18],[-34,-12],[-34,23],[-23,25]]){
      let spawn:Point|null=null;
      for(let i=0;i<100&&!spawn;i++){
        const p={x:x+(this.random()-.5)*4,z:z+(this.random()-.5)*4};
        if(this.inForest(p.x,p.z)&&canWalk(p.x,p.z,.42))spawn=p;
      }
      if(spawn)this.slimes.push({...spawn,home:{...spawn},hp:SLIME_HEALTH,yaw:this.random()*Math.PI*2,phase:this.random()*8,wait:this.random()*2,travel:0,flash:0,respawn:0});
    }
  }
  private inForest(x:number,z:number){return x<-19.5&&x>-39&&z>-32&&z<32;}
  private hit(slime:Slime,damage:number){slime.hp=Math.max(0,slime.hp-damage);slime.flash=.24;if(!slime.hp)slime.respawn=18+this.random()*12;}
  attack(weapon:Weapon,player:Point&{y?:number},aim:Point):{fired:boolean;hits:number;heading:number}{
    let dx=aim.x-player.x,dz=aim.z-player.z;const length=Math.hypot(dx,dz);if(length<.001){dx=0;dz=-1;}else{dx/=length;dz/=length;}
    const heading=Math.atan2(-dx,-dz);
    if(this.cooldown>0)return {fired:false,hits:0,heading};
    this.cooldown=weapon==="pistol"?.32:.48;let hits=0;
    if(weapon==="sword"){
      for(const s of this.slimes){const x=s.x-player.x,z=s.z-player.z,d=Math.hypot(x,z);
        if(s.hp>0&&d<=2.05&&(d<.2||(x*dx+z*dz)/d>.35)&&this.clearLine(player,s)){this.hit(s,2);hits++;}
      }
    }else{
      const shot=this.shots.find(s=>!s.active);if(shot)Object.assign(shot,{active:true,x:player.x,z:player.z,y:(player.y??0)+.88,dx,dz,remaining:11});
    }
    return {fired:true,hits,heading};
  }
  update(dt:number):number{
    if(!Number.isFinite(dt)||dt<=0)return 0;dt=Math.min(dt,.25);this.cooldown=Math.max(0,this.cooldown-dt);let hits=0;
    for(const s of this.slimes){
      s.flash=Math.max(0,s.flash-dt);
      if(s.hp===0){s.respawn-=dt;if(s.respawn<=0){s.hp=SLIME_HEALTH;s.x=s.home.x;s.z=s.home.z;s.wait=1;}continue;}
      s.phase+=dt*4.8;s.wait-=dt;
      if(s.wait>0)continue;
      if(s.travel<=0){s.yaw=this.random()*Math.PI*2;s.travel=1+this.random()*2.5;}
      const nx=s.x-Math.sin(s.yaw)*dt*.55,nz=s.z-Math.cos(s.yaw)*dt*.55;
      if(this.inForest(nx,nz)&&Math.hypot(nx-s.home.x,nz-s.home.z)<3.5&&this.canWalk(nx,nz,.4)){s.x=nx;s.z=nz;s.travel-=dt;}else s.travel=0;
      if(s.travel<=0)s.wait=.6+this.random()*1.6;
    }
    for(const shot of this.shots)if(shot.active){
      let left=Math.min(dt*18,shot.remaining);
      while(left>0&&shot.active){
        const step=Math.min(.10,left),next={x:shot.x+shot.dx*step,z:shot.z+shot.dz*step};
        if(!this.clearLine(shot,next)){shot.active=false;break;}
        shot.x=next.x;shot.z=next.z;shot.remaining-=step;left-=step;
        const enemy=this.slimes.find(s=>s.hp>0&&Math.hypot(s.x-shot.x,s.z-shot.z)<.48);
        if(enemy){this.hit(enemy,1);hits++;shot.active=false;}
      }
      if(shot.remaining<=.001)shot.active=false;
    }
    return hits;
  }
}

export function createCombat(scene:Scene,shadow:ShadowGenerator,canWalk:(x:number,z:number,r?:number)=>boolean,clearLine:(a:Point,b:Point)=>boolean){
  const model=new CombatModel(canWalk,clearLine),skin=voxelMaterial(scene,"forest-slime-skin");
  skin.specularColor=Color3.FromHexString("#8eaf68");skin.specularPower=28;
  const bright=new StandardMaterial("slime-hit-glow",scene);bright.disableLighting=true;bright.emissiveColor=Color3.FromHexString("#fff2be");
  const barMat=new StandardMaterial("slime-health",scene);barMat.disableLighting=true;barMat.emissiveColor=Color3.FromHexString("#b5d98d");
  const baseMat=new StandardMaterial("slime-health-base",scene);baseMat.disableLighting=true;baseMat.emissiveColor=Color3.FromHexString("#304b40");
  const views=model.slimes.map((s,i)=>{
    const root=new TransformNode("forest-slime-"+i,scene);
    const flesh=new Voxels().box(0,.22,0,.76,.40,.67,i%2?"#8bbc62":"#72ac75").box(0,.44,.02,.59,.17,.52,"#a5ce7d").box(-.18,.46,-.22,.14,.07,.08,"#deebb0").box(0,.09,0,.87,.14,.75,"#69a16c");
    const mesh=flesh.build("slime-body",scene,skin);mesh.parent=root;shadow.addShadowCaster(mesh);
    const eyes=new Voxels().box(-.16,.29,-.347,.075,.10,.025,"#243b35").box(.16,.29,-.347,.075,.10,.025,"#243b35").box(0,.20,-.351,.085,.025,.025,"#486e47").build("slime-face",scene,skin);eyes.parent=root;
    const healthRoot=new TransformNode("slime-health-root",scene);healthRoot.billboardMode=TransformNode.BILLBOARDMODE_ALL;
    const back=MeshBuilder.CreatePlane("slime-health-track",{width:.8,height:.07},scene);back.parent=healthRoot;back.material=baseMat;back.isPickable=false;
    const bar=MeshBuilder.CreatePlane("slime-health-fill",{width:.74,height:.045},scene);bar.parent=healthRoot;bar.position.z=-.005;bar.material=barMat;bar.isPickable=false;
    return {root,mesh,eyes,healthRoot,bar,s};
  });
  const shotMat=new StandardMaterial("soft-bullet-trail",scene);shotMat.disableLighting=true;shotMat.emissiveColor=Color3.FromHexString("#ffe1a0");
  const bullets=model.shots.map(()=>{const m=MeshBuilder.CreateBox("pistol-projectile",{width:.055,height:.045,depth:.28},scene);m.material=shotMat;m.isPickable=false;m.setEnabled(false);return m;});
  function update(dt:number,motion:boolean){
    const hits=model.update(dt);
    views.forEach(v=>{
      const {s,root,mesh,eyes,healthRoot,bar}=v,dy=motion?Math.max(0,Math.sin(s.phase))*.12:0;
      root.setEnabled(s.hp>0);root.position.set(s.x,dy+.015,s.z);root.rotation.y=s.yaw;
      const stretch=motion?Math.sin(s.phase)*.07:0;root.scaling.set(1-stretch,1+stretch*1.5,1-stretch);
      mesh.material=s.flash>0?bright:skin;eyes.visibility=s.flash>0?.4:1;
      healthRoot.position.set(s.x,1.02+dy,s.z);healthRoot.setEnabled(s.hp>0&&(s.hp<SLIME_HEALTH||s.flash>0));bar.scaling.x=s.hp/SLIME_HEALTH;bar.position.x=-(1-s.hp/SLIME_HEALTH)*.37;
    });
    bullets.forEach((m,i)=>{const b=model.shots[i];m.setEnabled(b.active);m.position.set(b.x,b.y,b.z);m.rotation.y=Math.atan2(-b.dx,-b.dz);});
    return hits;
  }
  update(0,true);return {model,views,bullets,update};
}
