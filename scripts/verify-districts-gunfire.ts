import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { buildWorld } from "../components/game/world";
import { REGIONS,GARDEN,FOREST_CLEARINGS,regionId,inForest } from "../components/game/geography";
import { CombatModel,BULLET_SPEED } from "../components/game/combat";
import { createFarmer } from "../components/game/character";
import { createHeldTools } from "../components/game/farmView";
import { createGunfire,createBulletTrails,TRACER_LENGTH } from "../components/game/gunfire";

export function verifyDistrictsAndGunfire(scene:Scene,world:ReturnType<typeof buildWorld>,shadow:ShadowGenerator){
  const areas=Object.fromEntries(REGIONS.map(r=>[r.id,0]));
  for(const tile of world.tiles)areas[regionId({x:tile.x+.5,z:tile.z+.5})]++;
  for(const region of REGIONS){assert(areas[region.id]>=1000,`${region.label} occupies a substantial part of the map`);assert.equal(regionId(region),region.id);}
  assert(world.tiles.filter(t=>t.kind==="dirt"&&t.x>=GARDEN.x&&t.x<GARDEN.x+GARDEN.w&&t.z>=GARDEN.z&&t.z<GARDEN.z+GARDEN.d).length>=100,"The expanded kitchen garden offers at least one hundred usable cells");
  for(const c of FOREST_CLEARINGS)assert(world.canWalk(c.x,c.z,.6),"Forest glades retain open combat space");
  assert(world.obstacles.filter(o=>o.kind==="tree"&&inForest(o.x,o.z)).length>=18,"Forest groves are present around the clearings");
  assert.equal(BULLET_SPEED,18*2);
  const ballistic=new CombatModel(()=>true,()=>true);ballistic.slimes.splice(0);ballistic.attack("pistol",{x:0,z:0},{x:20,z:0});ballistic.update(.1);
  const shot=ballistic.shots[0];assert(Math.abs(shot.x-3.6)<1e-8&&shot.z===0,"Projectile travel actually doubles");
  const trails=createBulletTrails(scene,ballistic.shots);trails.update(.1);const tracer=trails.views[0];
  assert(tracer.root.isEnabled()&&tracer.tail.isEnabled());assert.equal(tracer.tail.scaling.z,TRACER_LENGTH);
  const head=Vector3.TransformNormal(new Vector3(0,0,-1),tracer.root.computeWorldMatrix(true)).normalize();assert(head.x>.999,"The tracer points along the shot, with its taper behind it");
  const materialCount=scene.materials.length,meshCount=scene.meshes.length;
  ballistic.update(.25);trails.update(.25);assert(!shot.active&&!tracer.root.isEnabled());
  const blocked=new CombatModel(()=>true,(a,b)=>!(a.x<=1.1&&b.x>1.1));blocked.slimes.splice(0);
  const blockedTrails=createBulletTrails(scene,blocked.shots);blocked.attack("pistol",{x:0,z:0},{x:10,z:0});blocked.update(.25);blockedTrails.update(.25);
  assert(!blocked.shots[0].active&&blocked.shots[0].x<=1.1,"Fast projectiles still stop at a thin wall");
  assert(blockedTrails.views[0].root.isEnabled(),"A first-frame hit retains a short visible tracer");
  const before=blockedTrails.views[0].life;blockedTrails.update(0);assert.equal(blockedTrails.views[0].life,before);blockedTrails.update(.11);assert(!blockedTrails.views[0].root.isEnabled());
  const wallMuzzle=new CombatModel(()=>true,(a,b)=>!(a.x<=.3&&b.x>.3));wallMuzzle.attack("pistol",{x:0,z:0},{x:10,z:0},{x:.7,y:1,z:0});assert(wallMuzzle.shots.every(s=>!s.active),"A barrel extending through an obstacle cannot spawn bullets on the far side");
  for(let i=0;i<20;i++){ballistic.update(.25);ballistic.update(.25);ballistic.attack("pistol",{x:0,z:0},{x:20,z:0});ballistic.update(.1);trails.update(.1);}
  assert.equal(scene.meshes.length,meshCount+16);assert.equal(scene.materials.length,materialCount+2,"Flight and impact reuse their original meshes and materials");
  const farmer=createFarmer(scene,shadow),tools=createHeldTools(scene,farmer.hand,shadow),fire=createGunfire(scene,tools.muzzle);tools.select("pistol");
  for(const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]){
    farmer.body.rotation.y=yaw;farmer.animate(0,.1,true,true,false,.22,true,"pistol",{movementYaw:yaw+Math.PI/2});
    tools.muzzle.computeWorldMatrix(true);const muzzle=tools.muzzle.getAbsolutePosition();
    const facing=new Vector3(-Math.sin(yaw),0,-Math.cos(yaw));assert(Vector3.Dot(muzzle.subtract(farmer.root.position),facing)>.6,"The running gun's muzzle stays in front of the character");
    fire.fire();fire.update(1/60,true);assert(fire.flash.isEnabled());assert.equal(fire.flash.parent,tools.muzzle);
    const opacity=fire.flash.visibility;fire.update(0,true);assert.equal(fire.flash.visibility,opacity);fire.update(.11,true);assert(!fire.flash.isEnabled());
  }
  fire.fire();fire.update(.016,false);assert(fire.flash.isEnabled()&&fire.smoke.every(p=>!p.mesh.isEnabled()),"Motion off preserves essential muzzle feedback while suppressing drifting smoke");
  fire.update(.2,false);tools.select(null);
  console.log("District and gunfire regression passed:",JSON.stringify({areas,checks:"large four-region layout, open glades, larger garden, 36 tiles/s, muzzle attachment, visible first-frame hits, thin-wall collision, pause and effect pooling"}));
}
