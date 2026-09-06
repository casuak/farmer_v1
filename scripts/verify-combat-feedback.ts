import assert from "node:assert/strict";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { CombatModel,createCombat } from "../components/game/combat";
import { DAMAGE_NUMBER_COUNT } from "../components/game/damageNumbers";
import { createFarmer } from "../components/game/character";
import { WALK_SPEED,SPRINT_SPEED,movementVector,moveWithCollisions } from "../components/game/movement";

const origin={x:-24,z:12},aim={x:-24,z:2};
function place(model:CombatModel){
  model.slimes.forEach((s,i)=>Object.assign(s,{x:-41,z:32+i*.1,wait:100,flash:0,knockX:0,knockZ:0,hp:3}));
  const slime=model.slimes[0];Object.assign(slime,{x:-24,z:10.8});return slime;
}

export function verifyCombatFeedback(scene:Scene,shadow:ShadowGenerator){
  const coarse=new CombatModel(()=>true,()=>true),fine=new CombatModel(()=>true,()=>true);
  const a=place(coarse),b=place(fine);
  for(const model of [coarse,fine]){assert.equal(model.attack("sword",origin,aim).hits,1);assert.equal(model.takeHits()[0].damage,2);}
  coarse.update(.2);for(let i=0;i<10;i++)fine.update(.02);
  assert(Math.abs(a.z-b.z)<1e-10,"Knockback distance stays consistent across frame rates");
  assert(a.z<10.60&&a.z>10.54&&a.x===origin.x,"Sword knockback is small and points away from the attacker");
  Object.assign(a,{home:{x:-24,z:14.29},knockX:0,knockZ:0,wait:0,travel:1,yaw:Math.PI});const beyondRadius=a.z;coarse.update(.1);
  assert(a.z>beyondRadius,"A slime knocked beyond its wander radius can walk home again");
  const wall=new CombatModel((_,z,r=0)=>z-r>=10,()=>true),blocked=place(wall);blocked.z=10.55;
  wall.attack("sword",origin,aim);wall.update(.25);
  assert(blocked.z>=10.4&&blocked.z<10.55,"A hit cannot push the slime's collision radius through a wall or river bank");
  const edge=new CombatModel(()=>true,()=>true),edgeSlime=place(edge);edgeSlime.x=-45.95;edgeSlime.z=12;
  edge.attack("sword",{x:-44.8,z:12},{x:-48,z:12});edge.update(.25);
  assert(edgeSlime.x>-46,"Knockback keeps enemies inside the playable forest");

  const view=createCombat(scene,shadow,()=>true,()=>true),slime=place(view.model),first=view.views[0],second=view.views[1];
  Object.assign(second.s,{x:-23,z:10.9,hp:1});
  const count=scene.meshes.length;
  assert.equal(view.model.attack("sword",origin,aim).hits,2);view.update(.04,true);
  assert.equal(first.mesh.material!.name,"slime-hit-red");assert(!first.mesh.useVertexColors,"Green vertex colors cannot mute the red flash");
  assert(Math.abs(first.visual.position.x)>.001);assert.equal(first.root.position.x,slime.x,"Shake moves the visual body independently of its collision position");
  assert(second.root.isEnabled()&&second.s.hp===0,"A lethal hit still shows the red impact before the slime disappears");
  const active=view.numbers.labels.filter(n=>n.root.isEnabled());assert.deepEqual(active.map(n=>n.damage),[2,1],"Popups show actual health lost, including a one-health finishing blow");
  assert(active.every(n=>n.digits.filter(m=>m.isEnabled()).length===1));
  const frozen={x:slime.x,z:slime.z,flash:slime.flash,life:active[0].life,y:active[0].root.position.y,shake:first.visual.position.x};
  view.update(0,true);
  assert.deepEqual({x:slime.x,z:slime.z,flash:slime.flash,life:active[0].life,y:active[0].root.position.y,shake:first.visual.position.x},frozen,"Pausing freezes recoil, shake and floating text");
  view.update(.1,true);assert(active[0].root.position.y>frozen.y);
  view.update(.12,true);assert.equal(first.mesh.material!.name,"forest-slime-skin");assert(first.mesh.useVertexColors);assert(!second.root.isEnabled());assert.equal(first.visual.position.x,0);
  for(let i=0;i<3;i++)view.update(.25,true);assert(active.every(n=>!n.root.isEnabled()),"Finished numbers fade out and return to the pool");
  assert(view.model.attack("pistol",origin,slime).fired);let projectileHits=0;for(let i=0;i<3;i++)projectileHits+=view.update(.03,true);
  assert.equal(projectileHits,1);assert.equal(slime.hp,0);assert(view.numbers.labels.some(n=>n.life>0&&n.damage===1));
  for(let i=0;i<2;i++)view.update(.25,false);
  const reduced=view.views[2];Object.assign(reduced.s,{x:-24,z:10.8,hp:3,wait:100});
  view.model.attack("sword",origin,aim);view.update(.03,false);
  const calm=view.numbers.labels.find(n=>n.life>.8)!;const calmY=calm.root.position.y;
  assert(reduced.s.z<10.8,"Reduced decorative motion still preserves gameplay knockback");
  view.update(.03,false);assert.equal(reduced.visual.position.x,0);assert.equal(reduced.visual.rotation.z,0);assert.equal(calm.root.position.y,calmY);
  for(let i=0;i<DAMAGE_NUMBER_COUNT*3;i++)view.numbers.show({x:-24,z:-1,damage:i%2+1,killed:false});
  assert.equal(scene.meshes.length,count,"Repeated hits reuse damage glyphs and impact meshes");assert.equal(view.numbers.labels.length,DAMAGE_NUMBER_COUNT);
  view.numbers.update(1,true);
  console.log("Hit feedback regression passed: red flash and restoration, local shake, actual damage and lethal feedback, floating-text pooling, pause/reduced motion, frame-independent recoil and blocked knockback.");
}

export function verifyMovingShooting(scene:Scene,shadow:ShadowGenerator){
  const steady=createFarmer(scene,shadow),firing=createFarmer(scene,shadow);
  for(const running of [false,true])for(const movementYaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
    const combat=new CombatModel(()=>true,()=>true);place(combat);
    const walking={x:0,z:0},shooting={x:0,z:0},speed=running?SPRINT_SPEED:WALK_SPEED;
    let action=0,maxRecoil=0,shots=0;const stepsA:number[]=[],stepsB:number[]=[];
    // Convert a travel direction to the game's fixed diagonal camera controls.
    const dx=-Math.sin(movementYaw),dz=-Math.cos(movementYaw),right=(dx+dz)*Math.SQRT1_2,up=(dz-dx)*Math.SQRT1_2;
    for(let frame=0;frame<60;frame++){
      combat.update(1/60);action=Math.max(0,action-1/60);
      if(frame%24===0){assert(combat.attack("pistol",shooting,{x:shooting.x,z:shooting.z-10}).fired);action=.22;shots++;assert(!combat.attack("pistol",shooting,{x:shooting.x,z:shooting.z-10}).fired);}
      const normal=movementVector(right,up,0,"pistol"),armed=movementVector(right,up,action,"pistol");
      moveWithCollisions(walking,normal.x*speed/60,normal.z*speed/60,()=>true);
      moveWithCollisions(shooting,armed.x*speed/60,armed.z*speed/60,()=>true);
      if(steady.animate(frame/60,1/60,true,running,false,0,true,"pistol",{movementYaw}))stepsA.push(frame);
      if(firing.animate(frame/60,1/60,true,running,false,action,true,"pistol",{movementYaw}))stepsB.push(frame);
      for(let i=0;i<2;i++)assert.deepEqual(firing.limbs[i].rotation.asArray(),steady.limbs[i].rotation.asArray(),"Firing overlays recoil without replacing the current leg animation");
      assert.equal(firing.body.position.y,steady.body.position.y);assert.equal(firing.body.rotation.y,0,"Travel does not turn the torso away from its aim");
      if(frame>15)maxRecoil=Math.max(maxRecoil,firing.limbs[3].rotation.x-steady.limbs[3].rotation.x);
    }
    assert.equal(shots,3);assert.deepEqual(shooting,walking);assert(Math.abs(Math.hypot(shooting.x,shooting.z)-speed)<1e-8,"Moving fire preserves the full walking or running speed");
    assert.deepEqual(stepsB,stepsA,"Shots cannot restart or interrupt footstep cadence");assert(stepsB.length>=3);assert(maxRecoil>.1,"The gun has its own recoil layered over a steady aim pose");
    if(Math.abs(Math.sin(movementYaw))>.9)assert(Math.abs(firing.limbs[0].rotation.x)<1e-8&&Math.abs(firing.limbs[0].rotation.z)>.01,"Sideways movement uses lateral steps");
  }
  const p={x:0,z:0},input=movementVector(1,1,.15,"pistol");moveWithCollisions(p,input.x*12,input.z*12,(_,z)=>z<1);
  assert(p.z<1,"Running fire still respects movement collisions");
  assert.deepEqual(movementVector(1,0,.15,"hoe"),{x:0,z:0},"Farming keeps its existing planted action pose");
  firing.animate(3,.1,false,true,true,0,true,"pistol");assert.equal(Math.abs(firing.limbs[0].rotation.z),0);assert.equal(Math.abs(firing.body.rotation.z),0,"Boarding clears lateral aiming lean");
  console.log("Moving shooting regression passed: walk/run speed, forward/back/side steps, separate recoil, continuous footfalls, cooldown and obstacle collision.");
}
