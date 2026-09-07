import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SWORD,SWORD_HOLD_POSE,swordPose } from "./swordMotion";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Voxels,voxelMaterial } from "./voxel";
import { locomotionPose } from "./movement";
import type { HandItem,InventorySnapshot } from "./inventory";
import { MINING_SWING_DURATION,PICKAXE_ID,MINING_HOLD_POSE,miningPose } from "./miningMotion";
import { dodgePose } from "./dodge";

export function createFarmer(scene:Scene,shadow:ShadowGenerator) {
  const avatar=new TransformNode("player",scene);
  const rollRig=new TransformNode("farmer-roll-pivot",scene);rollRig.parent=avatar;rollRig.setPivotPoint(new Vector3(0,.88,0));
  const body=new TransformNode("body",scene);body.parent=rollRig;
  // Upper-body twist is independent of the aim heading and planted feet.
  const torsoTurn=new TransformNode("farmer-torso-turn",scene);torsoTurn.parent=body;torsoTurn.setPivotPoint(new Vector3(0,.72,0));
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
  for(const mesh of [hat,shirt,pack]){mesh.parent=torsoTurn;shadow.addShadowCaster(mesh);}pack.setEnabled(false);
  const torsoMesh=torso.build("farmer-torso",scene,mat);torsoMesh.parent=torsoTurn;shadow.addShadowCaster(torsoMesh);
  const limbs:TransformNode[]=[],elbows:TransformNode[]=[];
  for(const side of [-1,1]) {
    const leg=new TransformNode("leg",scene);leg.parent=body;leg.position.set(side*.12,.58,0);
    const mesh=new Voxels().box(0,-.22,0,.17,.45,.21,"#66837c").box(0,-.48,-.045,.21,.14,.31,"#735b45").build("farmer-boot",scene,mat);
    mesh.parent=leg;shadow.addShadowCaster(mesh);limbs.push(leg);
  }
  for(const side of [-1,1]) {
    const arm=new TransformNode("arm",scene);arm.parent=torsoTurn;arm.position.set(side*.30,1.05,0);
    const upper=new Voxels().box(0,-.12,0,.17,.25,.22,"#ede1b4").build("farmer-upper-arm",scene,mat);upper.parent=arm;shadow.addShadowCaster(upper);
    const elbow=new TransformNode("farmer-elbow",scene);elbow.parent=arm;elbow.position.y=-.235;
    const forearm=new Voxels().box(0,-.105,0,.15,.23,.18,"#e8b68b").build("farmer-forearm",scene,mat);forearm.parent=elbow;shadow.addShadowCaster(forearm);elbows.push(elbow);limbs.push(arm);
  }
  // Pivot at the actual palm, not at the elbow: tools stay inside the gripping hand.
  const hand=new TransformNode("farmer-tool-wrist",scene);hand.parent=elbows[1];hand.setPivotPoint(new Vector3(0,-.20,-.02));
  let phase=0,amount=0,aimWeight=0;
  function animate(time:number,dt:number,moving:boolean,running:boolean,aboard:boolean,action:number,motion:boolean,held:HandItem|null=null,aim:{movementYaw:number}|null=null){
    rollRig.rotation.setAll(0);rollRig.position.setAll(0);body.scaling.setAll(1);
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
    torsoTurn.rotation.setAll(0);hand.rotation.setAll(0);
    limbs[2].rotation.x=pose.leftArm;limbs[3].rotation.x=pose.rightArm;
    limbs[2].rotation.y=limbs[2].rotation.z=0;
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
    if(held==="sword"&&!aboard){
      const cutting=action>0,sword=cutting?swordPose(SWORD.duration-action):SWORD_HOLD_POSE,decor=motion?1:.35;
      const carry=motion&&!cutting?Math.sin(phase)*amount*.045:0;
      limbs[3].rotation.set(sword.shoulderX-body.rotation.x+carry,sword.shoulderY,sword.shoulderZ);
      elbows[1].rotation.x=sword.elbowX-carry*.5;
      hand.rotation.set(sword.wristX,sword.wristY,sword.wristZ);
      torsoTurn.rotation.set(sword.torsoPitch*decor,sword.torsoYaw,sword.lean*.12*decor);
      limbs[2].rotation.x+=sword.supportX*(1-amount);limbs[2].rotation.z=sword.supportZ*(1-amount);
      elbows[0].rotation.x+=(sword.supportElbow-elbows[0].rotation.x)*(1-amount);
      if(cutting){
        body.rotation.x=sword.lean*decor;body.position.y+=sword.weight*decor;
        limbs[3].rotation.x=sword.shoulderX-body.rotation.x;
        limbs[2].rotation.x=sword.supportX;limbs[2].rotation.z=sword.supportZ;elbows[0].rotation.x=sword.supportElbow;
        // Brace and release smoothly so recovery joins the idle stance without a foot snap.
        const brace=Math.sin(Math.PI*Math.min(1,(SWORD.duration-action)/SWORD.duration));
        limbs[0].rotation.x=-.07*brace;limbs[1].rotation.x=.09*brace;limbs[0].rotation.z=-.035*brace;limbs[1].rotation.z=.035*brace;
      }
    }
    if(action>0&&!aboard&&held!=="sword"){
      const duration=held===PICKAXE_ID?MINING_SWING_DURATION:held==="pistol"?.22:.43;
      const progress=Math.max(0,Math.min(1,1-action/duration)),swing=Math.sin(progress*Math.PI);
      if(held===PICKAXE_ID){
        // Two-handed pick swing: coil overhead, drive forward-down onto the rock,
        // rebound off the hit, then settle back to the carry pose. The engine fires
        // the impact at MINING_IMPACT_TIME, which is exactly the impact keyframe.
        const mining=miningPose(progress),reduced=!motion?0.55:1;
        limbs[3].rotation.x=mining.shoulderX;elbows[1].rotation.x=mining.elbowX;
        limbs[3].rotation.y=mining.shoulderY*reduced;limbs[3].rotation.z=mining.shoulderZ*reduced;
        limbs[2].rotation.x=mining.supportX*reduced;limbs[2].rotation.y=0;limbs[2].rotation.z=0;
        elbows[0].rotation.x=.12+(mining.supportElbowX-.12)*reduced;
        // Decorative roll is toned down under reduced motion; the pitch stays so the
        // strike still reads. No persistent transform is left behind once action hits 0.
        body.rotation.x=mining.bodyX;body.rotation.z=mining.bodyZ*reduced;
      }else if(held==="scythe"){limbs[3].rotation.x=1.05;limbs[3].rotation.y=-.9+progress*1.8;limbs[3].rotation.z=-.22;elbows[1].rotation.x=.30;body.rotation.x-=swing*.06;}
      else if(held==="pistol"){limbs[3].rotation.x=1.24-body.rotation.x+swing*.18;limbs[3].rotation.z=-body.rotation.z;elbows[1].rotation.x=.20;}
      else{limbs[3].rotation.x=swing*1.65;elbows[1].rotation.x=.2;body.rotation.x-=swing*.1;}
    }
    if(held===PICKAXE_ID&&action<=0&&!aboard){
      // Carry the pick with the arm bent up so the head rides above the ground while idle
      // or walking; the swing path (miningPose) starts and ends on this same pose.
      limbs[3].rotation.x=MINING_HOLD_POSE.shoulderX;limbs[3].rotation.y=0;limbs[3].rotation.z=0;
      elbows[1].rotation.x=MINING_HOLD_POSE.elbowX;
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
  const rollMeshes=avatar.getChildMeshes();
  function rollPose(progress:number,heading:number,motion:boolean){
    const pose=dodgePose(progress,motion);rollRig.rotation.set(pose.pitch,heading,0);body.rotation.setAll(0);
    body.scaling.set(pose.scaleXZ,pose.scaleY,pose.scaleXZ);body.position.y=.88*(1-pose.scaleY);
    torsoTurn.rotation.setAll(0);hand.rotation.setAll(0);
    for(const arm of [limbs[2],limbs[3]])arm.rotation.set(1.55*pose.tuck,0,0);
    for(const elbow of elbows)elbow.rotation.x=1.45*pose.tuck;
    limbs[0].rotation.set(-.9*pose.tuck,0,-.05);limbs[1].rotation.set(-.9*pose.tuck,0,.05);
    // Ground the real posed silhouette (hat included), rather than rotating around the ankles.
    let bottom=Infinity;
    for(const mesh of rollMeshes)if(mesh.isEnabled()){mesh.computeWorldMatrix(true);bottom=Math.min(bottom,mesh.getBoundingInfo().boundingBox.minimumWorld.y);}
    if(Number.isFinite(bottom))rollRig.position.y+=avatar.position.y+.018+pose.lift-bottom;
  }
  return {root:avatar,body,rollRig,torsoTurn,hand,limbs,elbows,animate,fishPose,rollPose,equip(bag:InventorySnapshot){hat.setEnabled(bag.slots[12]?.id==="hat");shirt.setEnabled(bag.slots[13]?.id==="shirt");pack.setEnabled(bag.backpack);}};
}
