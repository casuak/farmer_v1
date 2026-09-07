import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DODGE,DodgeModel } from "../components/game/dodge";
import { WALK_SPEED,SPRINT_SPEED } from "../components/game/movement";
import { createFarmer } from "../components/game/character";
import { createHeldTools } from "../components/game/farmView";
import { BeachBossModel,BOSS,PlayerHealth } from "../components/game/beachBoss";
const close=(a:number,b:number,e=.0001)=>assert(Math.abs(a-b)<e,`${a} != ${b}`);
assert.equal(WALK_SPEED,6);assert.equal(SPRINT_SPEED,9);
const roll=new DodgeModel(),p={x:0,z:0};assert(roll.begin({x:1,z:0},0));assert(!roll.begin({x:0,z:1},1));assert(!roll.invulnerable);
roll.update(.03,p,()=>true);assert(roll.invulnerable);const paused={...p,...roll.snapshot()};roll.update(0,p,()=>true);assert.deepEqual({...p,...roll.snapshot()},paused);
for(let i=0;i<80;i++)roll.update(.01,p,()=>true);close(p.x,DODGE.distance);close(p.z,0);assert(!roll.active&&!roll.invulnerable);assert(!roll.begin({x:1,z:0},0));
for(let i=0;i<150;i++)roll.update(.01,p,()=>true);assert(roll.snapshot().ready);assert(roll.begin({x:0,z:0},Math.PI/2));close(roll.direction.x,-1);roll.cancel();assert(!roll.invulnerable&&!roll.snapshot().ready);
roll.reset();assert(roll.snapshot().ready);
const wallRoll=new DodgeModel(),wall={x:0,z:0};wallRoll.begin({x:1,z:0},0);for(let i=0;i<60;i++)wallRoll.update(.01,wall,x=>x<.6);assert(wall.x<.6,"Roll cannot tunnel through a thin wall");
for(const dt of [1/30,1/60,1/120]){const d=new DodgeModel(),point={x:0,z:0};d.begin({x:1,z:1},0);for(let t=0;t<.6;t+=dt)d.update(dt,point,()=>true);close(Math.hypot(point.x,point.z),DODGE.distance);}
const engine=new NullEngine(),scene=new Scene(engine),light=new DirectionalLight("sun",new Vector3(0,-1,0),scene),shadow=new ShadowGenerator(512,light),farmer=createFarmer(scene,shadow),tools=createHeldTools(scene,farmer.hand,shadow);tools.select(null);
for(const motion of [true,false])for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2])for(let i=1;i<48;i++){
  farmer.animate(0,1/60,false,false,false,0,motion,null);farmer.rollPose(i/48,heading,motion);
  let bottom=Infinity;for(const mesh of farmer.root.getChildMeshes())if(mesh.isEnabled()){mesh.computeWorldMatrix(true);bottom=Math.min(bottom,mesh.getBoundingInfo().boundingBox.minimumWorld.y);}
  assert(bottom>=.012,`Roll silhouette never falls through ground (${bottom})`);assert(Number.isFinite(farmer.rollRig.rotation.x));
  if(!motion)assert(Math.abs(farmer.rollRig.rotation.x)<.3,"Reduced motion is a crouch dash, no full rotation");
}
farmer.animate(0,1/60,false,false,false,0,true,"sword");assert(farmer.rollRig.rotation.equalsWithEpsilon(Vector3.Zero()));assert(farmer.rollRig.position.equalsWithEpsilon(Vector3.Zero()));assert(farmer.body.scaling.equalsWithEpsilon(Vector3.One()));
// Dodge covers only its timing window, not its full cooldown, against actual boss attack events.
const boss=new BeachBossModel(()=>true,()=>true),player={x:22,z:-21},health=new PlayerHealth(),evade=new DodgeModel();
for(let i=0;i<500&&boss.phase!=="charge";i++)boss.update(.01,player);assert.equal(boss.phase,"charge");boss.takeEvents();
evade.begin({x:0,z:1},0);let avoided=0;
for(let i=0;i<60;i++){evade.update(.01,player,()=>true);boss.update(.01,player);for(const e of boss.takeEvents())if(e.type==="playerHit"){if(evade.invulnerable)avoided++;else health.hurt(e.damage);}}
assert(avoided>0,"Timed roll actually overlaps and avoids a boss hit");assert.equal(health.hp,5);
const tankBoss=new BeachBossModel(()=>true,()=>true),tank={x:22,z:-21},hp=new PlayerHealth();
for(let i=0;i<400;i++){tankBoss.update(.01,tank);for(const e of tankBoss.takeEvents())if(e.type==="playerHit")hp.hurt(e.damage);hp.update(.01,true);}assert(hp.hp<=3,"Unavoided charge now removes two hearts");
console.log(JSON.stringify({result:"passed",checks:"3x sprint; direction/facing roll; 4.1m integrated distance; .48s tumble and 2.2s cooldown; short invulnerability; collisions; pause/reset; every-heading geometry; reduced motion; real charge dodge vs standing damage",bossHp:BOSS.maxHp}));scene.dispose();engine.dispose();
