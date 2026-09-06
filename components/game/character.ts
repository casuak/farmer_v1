import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Voxels,voxelMaterial } from "./voxel";
import { locomotionPose } from "./movement";
import type { HandItem,InventorySnapshot } from "./inventory";

export function createFarmer(scene:Scene,shadow:ShadowGenerator) {
  const avatar=new TransformNode("player",scene);
  const body=new TransformNode("body",scene);body.parent=avatar;
  const mat=voxelMaterial(scene,"character");
  const torso=new Voxels();
  torso.box(0,.87,0,.45,.54,.28,"#eee3b8");
  torso.box(0,.70,-.03,.40,.23,.33,"#688d89");
  torso.box(0,.89,-.166,.28,.23,.05,"#789e99");
  for(const x of [-.15,.15]) {torso.box(x,1.00,-.16,.07,.28,.05,"#759d96");torso.box(x,.90,-.20,.045,.045,.03,"#e2c88b");}
  torso.box(0,1.29,0,.45,.44,.38,"#e9ba8e");
  torso.box(0,1.45,.025,.47,.20,.39,"#695443");
  torso.box(-.19,1.28,.015,.095,.28,.4,"#695443");
  torso.box(.19,1.34,.03,.095,.23,.37,"#695443");
  for(const x of [-.103,.103]) {
    torso.box(x,1.30,-.196,.055,.069,.025,"#414b41");
    torso.box(x*1.45,1.21,-.20,.075,.033,.025,"#d49678");
  }
  torso.box(0,1.22,-.22,.07,.07,.07,"#ebbf95");
  // Straw hat: stepped silhouette and a warm burnt-orange ribbon.
  const hat=new Voxels().box(0,1.60,0,.80,.10,.64,"#dec386").box(0,1.66,0,.68,.055,.55,"#efdc9d").box(0,1.72,.025,.48,.20,.40,"#d4a76d").box(0,1.78,.025,.47,.09,.41,"#bb7852").box(0,1.89,.025,.46,.15,.40,"#eed59a").box(0,1.98,.025,.36,.06,.31,"#f6df9f").build("farmer-straw-hat",scene,mat);
  const shirt=new Voxels().box(0,.89,0,.46,.40,.29,"#9dbbbb").box(0,.86,-.156,.32,.29,.04,"#7ca1a3").build("farmer-shirt",scene,mat);
  const pack=new Voxels().box(0,.83,.25,.39,.42,.23,"#94a16a").box(0,1.05,.26,.41,.07,.25,"#b4bb86").box(0,.77,.38,.25,.20,.07,"#77895b").box(0,.88,.428,.065,.07,.025,"#d7c38b").build("farmer-backpack",scene,mat);
  for(const mesh of [hat,shirt,pack]){mesh.parent=body;shadow.addShadowCaster(mesh);}pack.setEnabled(false);
  const torsoMesh=torso.build("farmer-torso",scene,mat);torsoMesh.parent=body;shadow.addShadowCaster(torsoMesh);
  const limbs:TransformNode[]=[],elbows:TransformNode[]=[];
  for(const side of [-1,1]) {
    const leg=new TransformNode("leg",scene);leg.parent=body;leg.position.set(side*.12,.58,0);
    const mesh=new Voxels().box(0,-.22,0,.17,.45,.21,"#66837c").box(0,-.48,-.045,.21,.14,.31,"#735b45").build("farmer-boot",scene,mat);
    mesh.parent=leg;shadow.addShadowCaster(mesh);limbs.push(leg);
  }
  for(const side of [-1,1]) {
    const arm=new TransformNode("arm",scene);arm.parent=body;arm.position.set(side*.30,1.05,0);
    const upper=new Voxels().box(0,-.12,0,.17,.25,.22,"#ede1b4").build("farmer-upper-arm",scene,mat);upper.parent=arm;shadow.addShadowCaster(upper);
    const elbow=new TransformNode("farmer-elbow",scene);elbow.parent=arm;elbow.position.y=-.235;
    const forearm=new Voxels().box(0,-.105,0,.15,.23,.18,"#e8b68b").build("farmer-forearm",scene,mat);forearm.parent=elbow;shadow.addShadowCaster(forearm);elbows.push(elbow);limbs.push(arm);
  }
  let phase=0,amount=0,aimWeight=0;
  function animate(time:number,dt:number,moving:boolean,running:boolean,aboard:boolean,action:number,motion:boolean,held:HandItem|null=null,aim:{movementYaw:number}|null=null){
    amount+=((moving?1:0)-amount)*(1-Math.exp(-15*dt));
    const aiming=held==="pistol"&&!aboard&&(!!aim||action>0);
    aimWeight+=((aiming?1:0)-aimWeight)*(1-Math.exp(-22*dt));
    const previousStep=Math.floor(phase/Math.PI);
    if(moving)phase+=dt*(running?16:10);
    const pose=locomotionPose(phase,amount,running,aboard);
    // The torso follows the cursor; feet keep stepping along the travel direction.
    const relative=aiming&&aim?aim.movementYaw-body.rotation.y:0,forward=Math.cos(relative),side=Math.sin(relative);
    body.position.y=motion?pose.bob+Math.sin(time*2)*.008:0;
    body.rotation.x=pose.lean*forward;body.rotation.z=-pose.lean*side;
    limbs[0].rotation.x=pose.leftLeg*forward;limbs[1].rotation.x=pose.rightLeg*forward;
    limbs[0].rotation.z=-pose.leftLeg*side;limbs[1].rotation.z=-pose.rightLeg*side;
    limbs[2].rotation.x=pose.leftArm;limbs[3].rotation.x=pose.rightArm;
    limbs[3].rotation.y=0;limbs[3].rotation.z=0;
    elbows.forEach(e=>e.rotation.x=pose.elbow);
    if(!aboard){
      // Blend the aiming arm over locomotion, compensating for the running lean.
      limbs[3].rotation.x+=(1.24-body.rotation.x-limbs[3].rotation.x)*aimWeight;
      limbs[3].rotation.z=-body.rotation.z*aimWeight;
      elbows[1].rotation.x+=(.20-elbows[1].rotation.x)*aimWeight;
    }
    if(held==="fishingRod"&&!aboard){limbs[3].rotation.x=1.75;elbows[1].rotation.x=.40;}
    if(aboard){body.position.y=-.12;limbs[2].rotation.x=limbs[3].rotation.x=.40+(moving?Math.sin(time*5)*.30:0);}
    if(action>0&&!aboard){
      const progress=Math.max(0,1-action/(held==="pistol"?.22:.43)),swing=Math.sin(progress*Math.PI);
      if(held==="scythe"||held==="sword"){limbs[3].rotation.x=1.05;limbs[3].rotation.y=-.9+progress*1.8;limbs[3].rotation.z=-.22;elbows[1].rotation.x=.30;body.rotation.x-=swing*.06;}
      else if(held==="pistol"){limbs[3].rotation.x=1.24-body.rotation.x+swing*.18;limbs[3].rotation.z=-body.rotation.z;elbows[1].rotation.x=.20;}
      else{limbs[3].rotation.x=swing*1.65;elbows[1].rotation.x=.2;body.rotation.x-=swing*.1;}
    }
    return moving&&!aboard&&Math.floor(phase/Math.PI)!==previousStep;
  }
  function fishPose(stage:string,seconds:number,motion:boolean){
    const charging=stage==="charging",cast=stage==="casting",reel=stage==="reeling",caught=stage==="catching",pulse=motion&&reel?Math.sin(seconds*12)*.07:0;
    // Cock the bamboo behind the head during charge, then sweep forward on release.
    limbs[3].rotation.x=charging?2.85:cast?2.85-Math.min(1,seconds/.65)*1.05:caught?2.45:1.80+pulse;
    elbows[1].rotation.x=charging?.65:.40;limbs[3].rotation.y=0;limbs[3].rotation.z=-.08;
    limbs[2].rotation.x=charging?1.95:1.35+pulse;elbows[0].rotation.x=.75;body.rotation.x=charging?.06:reel?-.04:0;
  }
  return {root:avatar,body,hand:elbows[1],limbs,elbows,animate,fishPose,equip(bag:InventorySnapshot){hat.setEnabled(bag.slots[12]?.id==="hat");shirt.setEnabled(bag.slots[13]?.id==="shirt");pack.setEnabled(bag.backpack);}};
}
