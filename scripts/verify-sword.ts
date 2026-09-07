import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createFarmer } from "../components/game/character";
import { createHeldTools } from "../components/game/farmView";
import { SWORD,SWORD_HOLD_POSE,SwordSwing,swordPose } from "../components/game/swordMotion";
import { createSwordTrail } from "../components/game/swordTrail";
import { CombatModel,SLIME_HEALTH } from "../components/game/combat";
import type { HandItem } from "../components/game/inventory";

const close=(a:number,b:number,epsilon=1e-5)=>assert(Math.abs(a-b)<epsilon,`${a} ~= ${b}`);
const swing=new SwordSwing();assert(!swing.active);assert(swing.begin(.4));assert(!swing.begin(1));close(swing.heading,.4);
let impacts=0,whooshes=0;
for(let i=0;i<100;i++){
  const previous=swing.elapsed,event=swing.update(.01);impacts+=Number(event.impact);whooshes+=Number(event.whoosh);
  if(event.impact){assert(previous<SWORD.impact&&swing.elapsed>=SWORD.impact);assert.equal(whooshes,1);}
}
assert.equal(impacts,1);assert.equal(whooshes,1);assert(!swing.active);assert(swing.begin(0));swing.update(.04);const paused=swing.elapsed;assert.deepEqual(swing.update(0),{impact:false,whoosh:false});close(swing.elapsed,paused);swing.cancel();assert(!swing.update(1).impact);
assert(swing.begin(0));const before=swing.elapsed;swing.update(Infinity);close(swing.elapsed,before);swing.update(99);assert(swing.elapsed<=.045,"Slow frames cannot skip the whole visible stroke");swing.cancel();
assert.deepEqual(swordPose(0),SWORD_HOLD_POSE);assert.deepEqual(swordPose(SWORD.duration),SWORD_HOLD_POSE);
const v=(t:number)=>(swordPose(t+.00001).shoulderY-swordPose(t-.00001).shoulderY)/.00002;
assert(v(SWORD.impact)>1,"Blade keeps its velocity through contact, not a stop-motion pose");assert(Math.abs(v(SWORD.windup))<.1);assert(Math.abs(v(SWORD.duration))<.1);

const engine=new NullEngine(),scene=new Scene(engine),light=new DirectionalLight("sun",new Vector3(0,-1,0),scene),shadow=new ShadowGenerator(512,light);
const farmer=createFarmer(scene,shadow),tools=createHeldTools(scene,farmer.hand,shadow),trail=createSwordTrail(scene,tools.swordBase,tools.swordTip);tools.select("sword");
const blade=()=>{tools.swordBase.computeWorldMatrix(true);tools.swordTip.computeWorldMatrix(true);return {base:tools.swordBase.getAbsolutePosition().clone(),tip:tools.swordTip.getAbsolutePosition().clone()};};
const animate=(elapsed:number|null,motion=true)=>{farmer.animate(0,1/60,false,false,false,elapsed===null?0:Math.max(0,SWORD.duration-elapsed),motion,"sword");return blade();};
const initial=animate(null),direction=initial.tip.subtract(initial.base);
assert(direction.y>.45&&direction.z<-.10&&direction.x>.30,"Default guard points diagonally up and forward/outside the torso");
assert(initial.base.y>.8&&initial.tip.y>1.35);assert(Math.abs(direction.y/Math.hypot(direction.x,direction.z))<1.8,"Diagonal, not vertical, carry");
const yaw=-.7,dx=direction.x*Math.cos(yaw)+direction.z*Math.sin(yaw),dz=-direction.x*Math.sin(yaw)+direction.z*Math.cos(yaw);
const screenX=(dx+dz)*Math.SQRT1_2,screenUp=direction.y*Math.SQRT1_2-(dx-dz)*.5;
assert(screenX>.3&&screenUp>.25&&screenUp/screenX>.65,"Initial 45-degree camera must show a clear rising blade, not a foreshortened horizontal stub");
for(const motion of [true,false]){
  let minY=Infinity,minUp=Infinity;
  for(const run of [false,true])for(let f=0;f<200;f++){
    farmer.animate(f/60,1/60,true,run,false,0,motion,"sword");const b=blade();minY=Math.min(minY,b.tip.y);minUp=Math.min(minUp,b.tip.y-b.base.y);
  }
  assert(minY>1.1&&minUp>.4,"Walk/run keep the blade raised and safely clear of ground");
  for(let f=0;f<150;f++)farmer.animate(0,1/60,false,false,false,0,motion,"sword");
  const load=animate(SWORD.windup,motion),contact=animate(SWORD.impact,motion),end=animate(SWORD.cutEnd,motion);
  assert(load.tip.x>.8&&load.tip.y>1.7,"Anticipation raises blade to right shoulder");
  assert(contact.tip.z<-1.35&&contact.tip.y>.60&&contact.tip.y<1.0,"Contact reaches chest-height through the forward target");
  assert(end.tip.x<-.7&&end.tip.y>.55,"Blade follows through across front, not into the ground");
  for(let i=0;i<=120;i++){
    const b=animate(i/120*SWORD.duration,motion);assert(b.base.y>.65&&b.tip.y>.55,"Every sampled frame clears ground and legs");
    close(Vector3.Distance(b.tip,b.base),.76,1e-5);
    // Wrist rotates around the palm. The tool-root grip never detaches from the hand.
    const actual=Vector3.TransformCoordinates(new Vector3(0,-.20,-.02),farmer.hand.computeWorldMatrix(true));
    const palm=Vector3.TransformCoordinates(new Vector3(0,-.20,-.02),farmer.elbows[1].computeWorldMatrix(true));
    close(Vector3.Distance(actual,palm),0,1e-5);
  }
  const settled=animate(null,motion);close(Vector3.Distance(initial.base,settled.base),0);close(Vector3.Distance(initial.tip,settled.tip),0);
  assert(farmer.torsoTurn.rotation.equalsWithEpsilon(Vector3.Zero()));
}
// Neutral rig transform must remain unchanged for every other tool and for sailing.
for(const held of ["hoe","seeds","water","scythe","pistol","fishingRod","pickaxe",null] as (HandItem|null)[]){
  animate(.22);farmer.animate(1,1/60,false,false,false,0,true,held);
  assert(farmer.hand.rotation.equalsWithEpsilon(Vector3.Zero()));assert(farmer.torsoTurn.rotation.equalsWithEpsilon(Vector3.Zero()));close(farmer.limbs[2].rotation.z,0);
}
animate(.22);farmer.animate(0,.1,false,false,true,0,true,"sword");assert(farmer.hand.rotation.equalsWithEpsilon(Vector3.Zero()));assert(farmer.torsoTurn.rotation.equalsWithEpsilon(Vector3.Zero()));
// World-space actual blade afterimage: no anticipation/recovery crescent, no mesh allocation per hit.
const meshCount=scene.meshes.length;
for(let round=0;round<3;round++){
  trail.clear();
  for(let i=0;i<60;i++){
    const elapsed=i/100;animate(elapsed);trail.update(elapsed,.01,true);
    if(elapsed<SWORD.windup)assert(!trail.mesh.isEnabled());
    if(elapsed>.15&&elapsed<.3)assert(trail.mesh.isEnabled());
    if(elapsed>.43)assert(!trail.mesh.isEnabled());
  }
}
assert.equal(scene.meshes.length,meshCount);trail.clear();animate(.17);trail.update(.17,.016,true);animate(.19);trail.update(.19,.016,true);assert(trail.mesh.isEnabled());
const vertices=Array.from(trail.mesh.getVerticesData("position")!);trail.update(.19,0,true);assert.deepEqual(Array.from(trail.mesh.getVerticesData("position")!),vertices);trail.update(.2,.016,false);assert(!trail.mesh.isEnabled());
// Engine-style delayed hit: still the existing two damage, once, and aim stays locked.
const model=new CombatModel(()=>true,()=>true),origin={x:-24,z:12};model.slimes.forEach(s=>Object.assign(s,{x:-40,z:30,wait:100}));Object.assign(model.slimes[0],{x:-24,z:10.7});
const timed=new SwordSwing();timed.begin(0);let damageFrame=-1;
for(let i=0;i<70;i++){const event=timed.update(.01);if(event.impact){damageFrame=i;model.attack("sword",origin,{x:origin.x-Math.sin(timed.heading)*2,z:origin.z-Math.cos(timed.heading)*2});}if(i<20)assert.equal(model.slimes[0].hp,SLIME_HEALTH);model.update(.01);}
assert(damageFrame>=20);assert.equal(model.slimes[0].hp,SLIME_HEALTH-2);assert.equal(model.takeHits().length,1);
console.log(JSON.stringify({result:"passed",carry:{base:initial.base.asArray(),tip:initial.tip.asArray()},checks:"45-degree upward guard; walk/run clearance; palm-centered wrist; C1 windup/cut/recovery; forward contact + follow-through; all-tool/boat reset; real blade ribbon/pause/reduced-motion/pool; delayed once-only hit and cancellation"}));
scene.dispose();engine.dispose();
