import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createRiverFish,RIVER_FISH_COUNT } from "../components/game/riverFish";
import { isRiver,onBridge } from "../components/game/geography";

export function verifyRiverFish(){
  const engine=new NullEngine(),scene=new Scene(engine),river=createRiverFish(scene,90125);
  const meshCount=scene.meshes.length,materialCount=scene.materials.length;
  const fadesIn=new Set<number>(),fadesOut=new Set<number>(),directions=new Set<number>();
  const quiet=new Set<number>();
  assert.equal(river.views.length,RIVER_FISH_COUNT);
  river.update(0,true,1);
  for(let frame=1;frame<=3600;frame++){
    const before=river.school.fish.map(f=>({...f}));
    river.update(frame/30,true,1);
    river.views.forEach(({root,body,tail,fish},i)=>{
      assert(Number.isFinite(fish.x+fish.z+fish.yaw));
      assert(fish.opacity>=0&&fish.opacity<=.82);
      if(!fish.active){if(fish.generation>0)quiet.add(i);assert(!root.isEnabled());return;}
      directions.add(Math.sign(fish.speed));
      if(fish.opacity>0&&fish.opacity<.8){
        if(fish.opacity>before[i].opacity)fadesIn.add(i);
        if(fish.opacity<before[i].opacity)fadesOut.add(i);
      }
      const matrix=root.computeWorldMatrix(true);
      if(before[i].active&&before[i].generation===fish.generation){
        const velocity=new Vector3(fish.x-before[i].x,0,fish.z-before[i].z).normalize();
        const head=Vector3.TransformNormal(new Vector3(0,0,-1),matrix).normalize();
        assert(Vector3.Dot(head,velocity)>.999,"River fish swim head-first along the curved channel");
      }
      if(frame%10===0)for(const mesh of [body,tail]){
        assert(!mesh.isPickable&&!mesh.receiveShadows);
        const vertices=mesh.getVerticesData("position")!,world=mesh.computeWorldMatrix(true);
        for(let v=0;v<vertices.length;v+=3){
          const p=Vector3.TransformCoordinates(Vector3.FromArray(vertices,v),world);
          assert(isRiver(p.x,p.z)&&!onBridge(p.x,p.z),"The entire fish stays in water, away from banks and bridges");
          assert(p.y>-.21&&p.y<-.19,"Fish silhouettes sit between the water surface and its foam");
        }
      }
    });
  }
  assert.equal(fadesIn.size,RIVER_FISH_COUNT);assert.equal(fadesOut.size,RIVER_FISH_COUNT);
  assert.equal(quiet.size,RIVER_FISH_COUNT);assert.equal(directions.size,2);
  assert(river.school.fish.every(f=>f.generation>=7),"Every pool slot repeatedly disappears and respawns");
  assert(new Set(river.school.fish.map(f=>f.origin.toFixed(2))).size>8,"Fish do not share one synchronized path");
  assert.equal(scene.meshes.length,meshCount);assert.equal(scene.materials.length,materialCount,"Respawns reuse resources");
  const still=river.school.fish.map(f=>({...f}));
  river.update(121,false,1);river.update(500,false,.2);
  assert.deepEqual(river.school.fish,still,"Motion off freezes both swimming and respawn timers");
  river.update(500+1/30,true,1);
  river.school.fish.forEach((f,i)=>{
    assert.equal(f.generation,still[i].generation,"Resuming does not replay elapsed wall time");
    if(f.active&&still[i].active)assert(Math.abs(f.age-still[i].age-1/30)<1e-8);
  });
  scene.dispose();engine.dispose();
  console.log("River regression passed: random lifetimes, quiet intervals, smooth fades, forward headings, bank/bridge clearance, paused time and fixed mesh pool.");
}
