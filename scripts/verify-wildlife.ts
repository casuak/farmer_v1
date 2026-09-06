import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { createOcean } from "../components/game/ocean";
import { seaHeight } from "../components/game/geography";

export function verifyWildlife(){
  const engine=new NullEngine(),scene=new Scene(engine);
  const light=new DirectionalLight("wildlife-test-sun",new Vector3(-.3,-1,.2),scene);
  const shadow=new ShadowGenerator(64,light),ocean=createOcean(scene,shadow);
  const gulls=scene.transformNodes.filter(n=>n.name.startsWith("seagull-"));
  const swimmers=scene.meshes.filter(n=>n.name==="swimming-fish-shadow");
  const jumpers=scene.meshes.filter(n=>n.name==="leaping-silver-fish");
  const ripples=scene.meshes.filter(n=>n.name==="fish-landing-ripple");
  assert.equal(gulls.length,7);assert.equal(swimmers.length,18);assert.equal(jumpers.length,5);
  const headAxis=new Vector3(0,0,-1),epsilon=.001;
  function checkHeading(nodes:TransformNode[],time:number,flat=false){
    ocean.update(time-epsilon,true);const before=nodes.map(n=>n.position.clone());
    ocean.update(time+epsilon,true);const after=nodes.map(n=>n.position.clone());
    ocean.update(time,true);
    return nodes.map((node,i)=>{
      const velocity=after[i].subtract(before[i]);if(flat)velocity.y=0;
      const forward=Vector3.TransformNormal(headAxis,node.computeWorldMatrix(true)).normalize();
      assert(Vector3.Dot(forward,velocity.normalize())>.999,`${node.name} at ${time}: head follows actual travel, including ascent/descent`);
      return forward;
    });
  }
  try{
    for(const time of [.5,2.8,7,13,21,32,43,52,75,101]){
      checkHeading(gulls,time);checkHeading(swimmers,time,true);
    }
    for(let i=0;i<jumpers.length;i++){
      const period=11+i*1.7,phase=i*3.9,start=period-(phase%period);
      for(const fraction of [.05,.25,.5,.75,.95]){
        const forward=checkHeading([jumpers[i]],start+fraction*1.3)[0];
        assert(jumpers[i].isEnabled());
        if(fraction<=.25)assert(forward.y>0,"Fish emerge head-first");
        if(fraction>=.75)assert(forward.y<0,"Fish dive head-first");
      }
      const lastTime=start+1.3-epsilon;ocean.update(lastTime,true);
      const landing=jumpers[i].position.clone();
      assert(Math.abs(landing.y-seaHeight(landing.x,landing.z,lastTime))<.01,"Fish return to the wave at their actual landing location");
      ocean.update(start+1.3+epsilon,true);
      assert(!jumpers[i].isEnabled());assert(ripples[i].isEnabled());
      assert(Math.hypot(ripples[i].position.x-landing.x,ripples[i].position.z-landing.z)<.01,"Ripple starts where the fish lands");
    }
    ocean.update(4,false);const still=[...gulls,...swimmers].map(n=>({position:n.position.clone(),rotation:n.rotation.clone()}));
    ocean.update(50,false);
    [...gulls,...swimmers].forEach((n,i)=>{assert(n.position.equals(still[i].position));assert(n.rotation.equals(still[i].rotation));});
    assert(jumpers.every(n=>!n.isEnabled())&&ripples.every(n=>!n.isEnabled()));
    console.log("Wildlife regression passed: all gull and swimming headings, head-first fish leaps and dives, wave-aligned landings, ripples and disabled motion.");
  }finally{scene.dispose();engine.dispose();}
}
