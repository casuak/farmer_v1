import assert from "node:assert/strict";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { FARM_SPAWN } from "../components/game/geography";
import { CombatModel,createCombat,type Hittable,type HitEvent } from "../components/game/combat";
import { PANIC_SECONDS,VILLAGER_HEALTH } from "../components/game/npcs";
import type { buildWorld } from "../components/game/world";

type World=ReturnType<typeof buildWorld>;

export function verifyVillagers(scene:Scene,shadow:ShadowGenerator,w:World){
  const residents=w.residents.residents;
  assert.equal(residents.length,5);
  const r=residents[0];
  assert(r.root.isEnabled(),"Villagers stay visible until hurt; they are never removed");
  // Use the open farm field next to the spawn so the flight path cannot dead-end.
  r.root.position.set(FARM_SPAWN.x,0,FARM_SPAWN.z);
  const player={x:FARM_SPAWN.x,z:FARM_SPAWN.z-2};
  const canWalk=(x:number,z:number,rad=.27)=>w.canWalk(x,z,rad);
  const model=new CombatModel(canWalk,()=>true,[r]);
  assert(model.attack("sword",player,{x:r.root.position.x,z:r.root.position.z}).fired);
  const events=model.takeHits();
  assert.equal(events.length,1);assert.equal(events[0].damage,2);
  assert.equal(r.hp,VILLAGER_HEALTH-2,"A sword swing deals two damage");assert.equal(r.panic,PANIC_SECONDS);assert(r.flash>0);
  assert.equal(r.root.position.x,FARM_SPAWN.x);assert.equal(r.root.position.z,FARM_SPAWN.z,"Knockback and flee are applied by the resident update, not the combat frame");
  const fleeStart=Math.hypot(r.root.position.x-player.x,r.root.position.z-player.z);
  for(let frame=0;frame<60;frame++){
    w.residents.update(1/30,frame/30,true,player);
    assert(w.canWalk(r.root.position.x,r.root.position.z,.18),"A panicking villager never crosses water or fences");
  }
  const fleeEnd=Math.hypot(r.root.position.x-player.x,r.root.position.z-player.z);
  assert(fleeEnd>fleeStart+2,"The hurt villager flees away from the player instead of returning to the route");
  assert(Math.abs(r.limbs[2].rotation.x-Math.PI/2)<.2&&Math.abs(r.limbs[3].rotation.x-Math.PI/2)<.2,"Both hands lunge forward while fleeing");
  assert(r.limbs[2].rotation.z<0&&r.limbs[3].rotation.z>0,"The forward hands spread outward");
  // Panic wears off: arms recover and the villager returns to its patrol.
  for(let frame=0;frame<150;frame++)w.residents.update(1/30,3+frame/30,true,player);
  assert.equal(r.panic,0);assert(Math.abs(r.limbs[2].rotation.x-Math.PI/2)>.4,"The panic pose ends when the villager settles down");
  // Injuries heal slowly, so repeated harassment keeps the panic cycle possible.
  for(let frame=0;frame<Math.ceil(23*30);frame++)w.residents.update(1/30,8+frame/30,false,player);
  assert(r.hp>1,"A recovered villager heals back toward full health");
  const gun=new CombatModel(canWalk,()=>true,[r]),from={x:r.root.position.x,z:r.root.position.z-3,y:.9};
  assert(gun.attack("pistol",from,{x:r.root.position.x,z:r.root.position.z}).fired);
  let victim:Hittable|null=null,event:HitEvent|null=null;
  for(let i=0;i<200&&!victim;i++){gun.update(1/60);victim=gun.takeVictims()[0]??null;event=gun.takeHits()[0]??null;}
  assert(victim===r,"Bullets hurt the same resident object");
  assert.equal(event?.damage,1);assert.equal(event?.killed,false);assert.equal(r.panic,PANIC_SECONDS);
  const finisher=new CombatModel(canWalk,()=>true,[r]);
  finisher.attack("sword",{x:r.root.position.x,z:r.root.position.z-2},{x:r.root.position.x,z:r.root.position.z});
  assert.equal(r.hp,0,"Plenty of hits leave a villager badly hurt but alive");
  assert(r.root.isEnabled(),"A badly hurt villager keeps fleeing; the panic is non-lethal");
  assert(r.lineNow().length>0);
  // The engine wiring drains the victim queue and announces the cry.
  const cries:string[]=[];
  const view=createCombat(scene,shadow,canWalk,()=>true,[r],v=>cries.push(v.name));
  view.update(0,true);
  view.model.attack("sword",{x:r.root.position.x,z:r.root.position.z-2},{x:r.root.position.x,z:r.root.position.z});
  view.update(.05,true);
  assert.deepEqual(cries,[r.name]);
  console.log("Villager panic regression passed: sword and shot wake a resident, red flash plus knockback, both hands thrown forward while fleeing, walkable flight path, panic recovery and slow healing, non-lethal repeated hits and the cry callback.");
}
