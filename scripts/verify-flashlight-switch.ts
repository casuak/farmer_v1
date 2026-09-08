import assert from "node:assert/strict";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { createFlashlight,FLASHLIGHT } from "../components/game/flashlight";

const engine=new NullEngine(),scene=new Scene(engine);
const camera=new FreeCamera("camera",new Vector3(0,4,8),scene);camera.setTarget(Vector3.Zero());scene.activeCamera=camera;
for(let i=0;i<9;i++)new PointLight(`existing-${i}`,new Vector3(i,3,0),scene);
const material=new StandardMaterial("receiver",scene);material.maxSimultaneousLights=8;
const ground=MeshBuilder.CreateGround("ground",{width:20,height:20},scene);ground.material=material;ground.receiveShadows=true;
const caster=MeshBuilder.CreateBox("tree-trunk",{size:1},scene);caster.position.set(0,1,-3);caster.material=material;
const hand=new TransformNode("hand",scene),tip=new TransformNode("tip",scene);tip.parent=hand;hand.position.set(0,1,0);
const flashlight=createFlashlight(scene,tip,[caster]),map=flashlight.shadow.getShadowMap()!,player=Vector3.Zero();
const update=(dt=1/60)=>flashlight.update("flashlight",0,player,false,false,dt);
const off=()=>flashlight.select(null,false,false);
const dark=()=>assert.equal(flashlight.light.intensity,0);
const bounded=()=>assert(flashlight.light.intensity>=0&&flashlight.light.intensity<=FLASHLIGHT.intensity);
assert(flashlight.light.isEnabled());assert(!flashlight.active);dark();
assert.equal(ground.lightSources[0],flashlight.light,"Existing meshes get setup-only priority resync");
const late=MeshBuilder.CreateBox("late-receiver",{size:.1},scene);late.material=material;
assert.equal(late.lightSources[0],flashlight.light,"New meshes inherit stable priority order");
const order=ground.lightSources.slice(),budget=order.slice(0,material.maxSimultaneousLights);
let dirty=0,resync=0,toggles=0,renders=0;
const markDirty=ground._markSubMeshesAsLightDirty.bind(ground),sync=ground._resyncLightSources.bind(ground),setEnabled=flashlight.light.setEnabled.bind(flashlight.light);
ground._markSubMeshesAsLightDirty=(...args)=>{dirty++;return markDirty(...args);};
ground._resyncLightSources=()=>{resync++;return sync();};
flashlight.light.setEnabled=(value)=>{toggles++;return setEnabled(value);};
map.onAfterUnbindObservable.add(()=>{renders++;});
// Allow asynchronous shader imports to settle using actual Scene renders.
async function render(){scene.render();await new Promise<void>(resolve=>setImmediate(resolve));}
for(let i=0;i<12;i++)await render();
assert(renders<=1,"Idle map clears at most once, not every frame");
const initialRenders=renders;for(let i=0;i<12;i++)await render();assert.equal(renders,initialRenders);
const allocations={meshes:scene.meshes.length,lights:scene.lights.length,textures:scene.textures.length};
const oldPosition=flashlight.light.position.clone();hand.position.set(2,1,0);
flashlight.select("flashlight",false,false);assert(flashlight.active);dark();assert(!flashlight.shadowReady);
for(const dt of [0,-1,NaN,Infinity]){update(dt);dark();assert(flashlight.light.position.equals(oldPosition),"0dt publish cannot consume old hand pose");}
// Public readiness checks fire onAfterRender too, but have never bound a map.
map.isReadyForRendering();assert(!flashlight.shadowReady);dark();
off();update(0);off();await render();assert(!flashlight.active);dark();assert(!flashlight.shadowReady);
// A real current pose, and THEN an actual map render, are both required.
update();dark();assert.equal(flashlight.light.position.x,2);assert(!flashlight.shadowReady);
for(let i=0;i<8;i++){update();dark();} // time alone cannot fabricate a ready map
for(let i=0;i<80&&!flashlight.shadowReady;i++){await render();dark();}
assert(flashlight.shadowReady,"Current generation becomes ready only after a real map render");
let previous=0;
for(let i=0;i<12;i++){update();bounded();assert(flashlight.light.intensity>=previous);previous=flashlight.light.intensity;await render();}
assert.equal(flashlight.light.intensity,FLASHLIGHT.intensity);
// Stable light has no ambient pulse, and paused updates freeze fade and pose.
for(let i=0;i<40;i++){update();assert.equal(flashlight.light.intensity,FLASHLIGHT.intensity);await render();}
const litPosition=flashlight.light.position.clone();hand.position.x=3;
for(let i=0;i<20;i++){update(0);assert(flashlight.light.position.equals(litPosition));assert.equal(flashlight.light.intensity,FLASHLIGHT.intensity);await render();}
assert.equal(map.refreshRate,0);const pausedRenders=renders;for(let i=0;i<10;i++)await render();assert.equal(renders,pausedRenders);
// Cancel partial fade, switch repeatedly, and reject a previous generation's map.
off();dark();assert.equal(map.renderList!.length,0);assert.equal(map.refreshRate,0);
for(let i=0;i<20;i++){
  update(0);dark();assert(!flashlight.shadowReady);off();dark();
}
update();dark();assert(!flashlight.shadowReady);await render();assert(flashlight.shadowReady);
update();assert(flashlight.light.intensity>0&&flashlight.light.intensity<FLASHLIGHT.intensity);
const partial=flashlight.light.intensity;for(let i=0;i<10;i++){update(0);await render();assert.equal(flashlight.light.intensity,partial);}
off();dark();hand.position.x=-2;update(0);dark();assert(!flashlight.shadowReady);await render();assert(!flashlight.shadowReady,"Idle clear cannot ready an unprepared activation");
update();dark();assert.equal(flashlight.light.position.x,-2);await render();assert(flashlight.shadowReady);update(10);bounded();assert(flashlight.light.intensity<FLASHLIGHT.intensity,"Long delta cannot skip the short switch ramp");
// Selection, boat, roll and hidden tip cancel immediately without light toggles.
flashlight.update("flashlight",0,player,true,false,0);assert(!flashlight.active);dark();
flashlight.update("flashlight",0,player,false,true,0);assert(!flashlight.active);dark();
tip.setEnabled(false);update();assert(!flashlight.active);dark();tip.setEnabled(true);
// Even bound render callbacks cannot declare an unfinished caster shader ready.
const isReady=map.customIsReadyFunction!;map.customIsReadyFunction=()=>false;
update();await render();assert(!flashlight.shadowReady);update();dark();map.customIsReadyFunction=isReady;
for(let i=0;i<30&&!flashlight.shadowReady;i++)await render();assert(flashlight.shadowReady);update();bounded();
off();for(let i=0;i<4;i++)await render();const idleRenders=renders;for(let i=0;i<20;i++)await render();assert.equal(renders,idleRenders);
assert.equal(dirty,0,"Switching never dirties receiving material light defines");assert.equal(resync,0,"No per-frame mesh light reordering");assert.equal(toggles,0,"No light setEnabled, even at cancellation");
assert.deepEqual(ground.lightSources,order);assert.deepEqual(ground.lightSources.slice(0,material.maxSimultaneousLights),budget);
assert.deepEqual({meshes:scene.meshes.length,lights:scene.lights.length,textures:scene.textures.length},allocations);
assert(flashlight.shadow.usePoissonSampling&&!flashlight.shadow.usePercentageCloserFiltering);
flashlight.dispose();flashlight.dispose();update();assert(!flashlight.active);assert(!scene.lights.includes(flashlight.light));assert(!scene.textures.includes(map));
console.log(JSON.stringify({result:"passed",checks:"stable enabled/light budget and zero material dirties; cancellation/rapid switches; old pose/0dt/nonfinite dt; real rendered generation + shader readiness gate; monotonic bounded .12s fade; pause freeze/no pulse; idle map cost; Poisson; disposal",note:"NullEngine verifies state/ordering, not GPU pixel output."}));
scene.dispose();engine.dispose();
