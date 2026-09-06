import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Voxels,voxelMaterial } from "./voxel";
import { locomotionPose } from "./movement";

export function createFarmer(scene:Scene,shadow:ShadowGenerator) {
  const avatar=new TransformNode("player",scene);
  const body=new TransformNode("body",scene);body.parent=avatar;
  const mat=voxelMaterial(scene,"character");
  const torso=new Voxels();
  torso.box(0,.87,0,.45,.54,.28,"#eee3b8");
  torso.box(0,.70,-.03,.40,.23,.33,"#688d89");
  torso.box(0,.89,-.166,.28,.23,.05,"#789e99");
  for(const x of [-.15,.15]) {torso.box(x,1.00,-.16,.07,.28,.05,"#759d96");torso.box(x,.90,-.20,.045,.045,.03,"#e2c88b");}
  torso.box(0,.77,.19,.28,.32,.14,"#b18753");
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
  torso.box(0,1.60,0,.80,.10,.64,"#dec386");
  torso.box(0,1.66,0,.68,.055,.55,"#efdc9d");
  torso.box(0,1.72,.025,.48,.20,.40,"#d4a76d");
  torso.box(0,1.78,.025,.47,.09,.41,"#bb7852");
  torso.box(0,1.89,.025,.46,.15,.40,"#eed59a");
  torso.box(0,1.98,.025,.36,.06,.31,"#f6df9f");
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
  let phase=0,amount=0;
  function animate(time:number,dt:number,moving:boolean,running:boolean,aboard:boolean,action:number,motion:boolean){
    amount+=((moving?1:0)-amount)*(1-Math.exp(-15*dt));
    const previousStep=Math.floor(phase/Math.PI);
    if(moving)phase+=dt*(running?16:10);
    const pose=locomotionPose(phase,amount,running,aboard);
    body.position.y=motion?pose.bob+Math.sin(time*2)*.008:0;
    body.rotation.x=pose.lean;
    limbs[0].rotation.x=pose.leftLeg;limbs[1].rotation.x=pose.rightLeg;
    limbs[2].rotation.x=pose.leftArm;limbs[3].rotation.x=pose.rightArm;
    elbows.forEach(e=>e.rotation.x=pose.elbow);
    if(aboard){body.position.y=-.12;limbs[2].rotation.x=limbs[3].rotation.x=.40+(moving?Math.sin(time*5)*.30:0);}
    if(action>0&&!aboard){const swing=Math.sin((1-action/.43)*Math.PI);limbs[3].rotation.x=swing*1.65;elbows[1].rotation.x=.2;body.rotation.x-=swing*.1;}
    return moving&&!aboard&&Math.floor(phase/Math.PI)!==previousStep;
  }
  return {root:avatar,body,hand:elbows[1],limbs,elbows,animate};
}
