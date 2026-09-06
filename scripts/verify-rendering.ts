import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ToGammaSpace } from "@babylonjs/core/Maths/math.constants";
import { ExtractHighlightsPostProcess } from "@babylonjs/core/PostProcesses/extractHighlightsPostProcess";
import { BloomMergePostProcess } from "@babylonjs/core/PostProcesses/bloomMergePostProcess";
import { createSpringLighting } from "../components/game/lighting";
import { RenderGuard,hasVisibleFrame } from "../components/game/renderGuard";

export async function verifyRendering(){
  const black=[new Uint8Array([0,0,0,255])],daylight=[new Uint8Array([104,151,92,255])];
  assert(!hasVisibleFrame(black),"Opaque alpha must not make a black framebuffer ready");
  assert(!hasVisibleFrame([]));assert(!hasVisibleFrame([new Uint8Array([3,2,4,255])]));
  assert(hasVisibleFrame([...black,...daylight]),"Scene content may only fill some sampled regions");
  let samples=black,assetsReady=true,ready=0,recoveries=0,errors=0,reads=0;
  const guard=new RenderGuard({
    isReady:()=>assetsReady,
    readFrame:async()=>{reads++;return samples;},
    recover:()=>++recoveries===1,
    onReady:()=>ready++,onError:()=>errors++,
  });
  const step=async()=>{guard.afterFrame(.4);await Promise.resolve();};
  await step();assert.equal(ready,0);assert.equal(recoveries,0);
  samples=daylight;await step();await step();assert.equal(ready,1,"Ready requires consecutive visible frames");
  for(let i=0;i<10;i++)await step();
  const finishedReads=reads;await step();assert.equal(reads,finishedReads,"GPU sampling stops after verification");
  guard.watch();samples=black;
  await step();await step();assert.equal(recoveries,0,"Two transient black frames are tolerated");
  await step();assert.equal(recoveries,1);assert.equal(errors,0);
  samples=daylight;await step();await step();assert.equal(ready,1,"Recovery does not reinitialize the game");
  guard.watch();samples=black;await step();await step();await step();
  assert.equal(errors,1,"An unsuccessful direct-render fallback reaches the error overlay");
  await step();guard.fail("again");assert.equal(errors,1);guard.dispose();

  let resolveFrame!:(value:Uint8Array[])=>void,staleReady=0;
  const stale=new RenderGuard({isReady:()=>true,readFrame:()=>new Promise(resolve=>{resolveFrame=resolve;}),recover:()=>false,onReady:()=>staleReady++,onError:()=>errors++});
  stale.afterFrame(.4);stale.dispose();resolveFrame(daylight);await Promise.resolve();
  assert.equal(staleReady,0,"Unmounted games ignore pending GPU reads");

  let shaderFallbacks=0,shaderErrors=0;
  const stalled=new RenderGuard({isReady:()=>false,readFrame:async()=>daylight,recover:()=>++shaderFallbacks===1,onReady:()=>assert.fail("Uncompiled shaders cannot be ready"),onError:()=>shaderErrors++});
  stalled.afterFrame(21);assert.equal(shaderFallbacks,1);
  stalled.afterFrame(21);assert.equal(shaderErrors,1,"Shader compilation cannot leave an endless loading screen");
  stalled.dispose();

  let readRecoveries=0,readErrors=0;
  const rejected=new RenderGuard({isReady:()=>true,readFrame:()=>Promise.reject(new Error("readPixels failed")),recover:()=>++readRecoveries===1,onReady:()=>assert.fail(),onError:()=>readErrors++});
  rejected.afterFrame(.4);await Promise.resolve();assert.equal(readRecoveries,1);
  rejected.afterFrame(.4);await Promise.resolve();assert.equal(readErrors,1);rejected.dispose();
  let renderErrors=0;
  const exception=new RenderGuard({isReady:()=>false,readFrame:async()=>[],recover:()=>{throw new Error("broken framebuffer");},onReady:()=>assert.fail(),onError:()=>renderErrors++});
  exception.fail("render exception");assert.equal(renderErrors,1,"Even a recovery exception produces a visible error");exception.dispose();

  // Advertise float targets as a driver might. The game must still choose the
  // RGBA8 route; ordinary NullEngine capabilities would miss this regression.
  const engine=new NullEngine();engine.getCaps().textureHalfFloatRender=true;engine.getCaps().textureFloatRender=true;
  const scene=new Scene(engine),camera=new ArcRotateCamera("render-regression",-.7,.7,65,Vector3.Zero(),scene);
  const lighting=createSpringLighting(scene,camera);
  assert.equal(lighting.shadow.getShadowMap()!.getSize().width,Math.min(4096,engine.getCaps().maxTextureSize,engine.getCaps().maxRenderTextureSize),"Shadow allocation respects the device limits");
  assert.equal(lighting.pipeline.serialize()._hdr,false,"Reported float support must not opt into the HDR chain");
  assert(lighting.pipeline.bloomEnabled&&lighting.pipeline.fxaaEnabled);
  assert(camera._postProcesses.some(Boolean),"The standard renderer includes the requested effects");
  const highlights=camera._postProcesses.find(p=>p instanceof ExtractHighlightsPostProcess)!;
  const merge=camera._postProcesses.find(p=>p instanceof BloomMergePostProcess)!;
  assert(highlights&&merge,"Bloom attaches both highlight extraction and compositing to the actual camera");
  const effectiveCutoff=Math.pow(highlights.threshold,ToGammaSpace);
  // Synthetic display-space probes verify extraction, not GPU pixel output.
  const luma=([r,g,b]:number[])=>r*.2126+g*.7152+b*.0722;
  for(const pixel of [[.90,.93,.91],[1,.90,.65],[.96,.87,.88]]){
    assert(luma(pixel)>effectiveCutoff,"Water glints, warm lamps and pale blossoms pass the extraction threshold");
    assert(luma(pixel)*merge.weight*.25>.07,"A nearby quarter-strength blurred highlight produces a visible contribution");
  }
  assert(luma([.48,.69,.33])<effectiveCutoff,"Ordinary grass remains below the bloom threshold");
  for(const exposure of [1.18,1.5,1.18]){
    scene.imageProcessingConfiguration.exposure=exposure;
    highlights.onApplyObservable.notifyObservers(highlights.getEffect());
    assert.equal(highlights._exposure,1,"LDR bloom must not apply the material exposure a second time");
  }
  lighting.setBloom(false);
  assert(!camera._postProcesses.includes(highlights)&&!camera._postProcesses.includes(merge),"Turning bloom off removes its camera passes");
  assert(camera._postProcesses.some(p=>p?.name==="fxaa"),"Bloom off preserves anti-aliasing");
  lighting.setBloom(true);
  assert(camera._postProcesses.includes(highlights)&&camera._postProcesses.includes(merge),"Turning bloom on restores the effect");
  const observers=highlights.onApplyObservable.observers.length;
  lighting.setBloom(false);lighting.setBloom(true);
  assert.equal(highlights.onApplyObservable.observers.length,observers,"Toggling bloom does not accumulate callbacks");
  scene.imageProcessingConfiguration.applyByPostProcess=true;
  assert(lighting.recover());assert(lighting.compatible);
  assert.equal(scene.autoClear,true);assert.equal(scene.postProcessesEnabled,false);
  assert.equal(scene.imageProcessingConfiguration.applyByPostProcess,false);
  assert(scene.imageProcessingConfiguration.toneMappingEnabled&&scene.imageProcessingConfiguration.exposure>1);
  assert.equal(camera._postProcesses.filter(Boolean).length,0,"Direct rendering must not retain a broken camera pass");
  assert(!lighting.recover(),"Recovery is bounded");
  lighting.setBloom(false);lighting.setBloom(true);
  assert.equal(camera._postProcesses.filter(Boolean).length,0,"Settings cannot reattach a disposed pipeline");
  scene.render();scene.dispose();engine.dispose();
  console.log("Rendering regression passed: LDR bloom extraction/exposure, camera effect toggles, RGBA8 path, visible-frame gating, black-frame recovery, bounded readbacks, stale callbacks, timeouts, read failures, exceptions and direct-render cleanup.");
}
