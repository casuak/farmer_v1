import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { Light } from "@babylonjs/core/Lights/light";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Ray } from "@babylonjs/core/Culling/ray";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { HandItem } from "./inventory";

export const FLASHLIGHT={
  range:12,intensity:4.2,angle:Math.PI/2,exponent:20,downward:.24,
  shadowSize:512,maxCasters:24,maxCasterVertices:48000,casterRefresh:.15,switchFade:.12,
  // Model points along local -Y, as do the other tools held in the palm.
  tip:{x:0,y:-.37,z:0},
  shoulderX:1.08,elbowX:Math.PI/2-Math.atan(.24)-1.08,
} as const;

export function flashlightDirection(yaw:number,out=new Vector3()){
  return out.set(-Math.sin(yaw),-FLASHLIGHT.downward,-Math.cos(yaw)).normalize();
}
export function flashlightActive(hand:HandItem|null,aboard:boolean,rolling:boolean,tipVisible=true){
  return hand==="flashlight"&&!aboard&&!rolling&&tipVisible;
}
function boundsDistanceSquared(mesh:AbstractMesh,position:Vector3){
  const {minimumWorld:min,maximumWorld:max}=mesh.getBoundingInfo().boundingBox;
  const dx=Math.max(min.x-position.x,0,position.x-max.x),dy=Math.max(min.y-position.y,0,position.y-max.y),dz=Math.max(min.z-position.z,0,position.z-max.z);
  return dx*dx+dy*dy+dz*dz;
}
const wall=(mesh:AbstractMesh)=>mesh.name.endsWith("-walls");

/** One real light, one small local shadow map, and no per-frame meshes/textures.
 * Building meshes have a real doorway. Keep faded camera-occluder walls casting
 * solid shadows; never use the world-wide combined grass/prop batches here.
 */
export function createFlashlight(scene:Scene,tip:TransformNode,staticCasters:readonly AbstractMesh[]){
  const light=new SpotLight("held-flashlight",Vector3.Zero(),flashlightDirection(0),FLASHLIGHT.angle,FLASHLIGHT.exponent,scene);
  light.diffuse=Color3.FromHexString("#fff0cf");light.specular=Color3.FromHexString("#ffe7bd").scale(.25);
  // Babylon's StandardMaterial ignores GLTF falloff / innerAngle (PBR only).
  // Its real shader uses linear range decay * cos(angle)^exponent. A broad
  // 90-degree outer cone with exponent 20 fades to <.001 at the cutoff,
  // giving a warm soft beam without a visible hard disk or custom shaders.
  light.falloffType=Light.FALLOFF_STANDARD;
  // Always registered: selection changes uniforms, never LIGHT/SHADOW defines.
  light.intensity=0;light.range=FLASHLIGHT.range;
  light.renderPriority=100;
  // renderPriority sorts scene.lights only. Existing meshes still have the new
  // light appended (outside their eight-light budget) until this ONE setup sync.
  for(const mesh of scene.meshes)mesh._resyncLightSources();
  light.shadowMinZ=.035;light.shadowMaxZ=FLASHLIGHT.range;
  const caps=scene.getEngine().getCaps(),size=Math.max(1,Math.min(FLASHLIGHT.shadowSize,caps.maxTextureSize,caps.maxRenderTextureSize));
  const shadow=new ShadowGenerator(size,light);
  // Keep the local spot map color-sampled. A second depth-comparison PCF map
  // alongside the sun's PCF map causes WebGL INVALID_OPERATION on Chrome/ANGLE
  // and silently drops the shared voxel draws despite successful shader compile.
  // Four-tap Poisson uses the ordinary sampler path and the same 512px budget.
  shadow.usePoissonSampling=true;
  shadow.bias=.0003;shadow.normalBias=.012;shadow.setDarkness(0);
  shadow.transparencyShadow=true;shadow.enableSoftTransparentShadow=false;
  const candidates=staticCasters.filter(m=>m.metadata?.tileKind==="building"||m.name==="tree-trunk"||m.name.startsWith("ore-rock-"));
  for(const mesh of candidates)mesh.computeWorldMatrix(true);
  const walls=candidates.filter(wall),chest=new Vector3(),segment=new Vector3(),ray=new Ray(chest,segment,0);
  const map=shadow.getShadowMap()!;
  // One empty initialization clear, then no idle shadow draws. Do not disable
  // light/shadowEnabled: that would churn every receiving material's defines.
  map.renderList=[];map.refreshRate=0;
  let disposed=false,active=false,blocked=false,refresh=Infinity,fade=0;
  let generation=0,preparedGeneration=-1,readyGeneration=-1,renderGeneration=-1,inMapRender=false;
  // Babylon also raises onAfterRender during isReadyForRendering checks! Only
  // an actual bound map, with all caster shaders ready, can satisfy this gate.
  const bindMap=map.onBeforeBindObservable.add(()=>{inMapRender=true;renderGeneration=preparedGeneration;});
  const beforeMap=map.onBeforeRenderObservable.add(()=>{
    if(!inMapRender||renderGeneration!==generation||readyGeneration===generation||!active||blocked)return;
    // Check in the map's render pass, not the main material's draw-wrapper pass.
    if(!(map.renderList??[]).every(mesh=>map.customIsReadyFunction?.(mesh,map.refreshRate,true)??mesh.isReady(true)))renderGeneration=-1;
  });
  const afterMap=map.onAfterRenderObservable.add(()=>{
    if(inMapRender&&active&&!blocked&&renderGeneration===generation)readyGeneration=generation;
  });
  const unbindMap=map.onAfterUnbindObservable.add(()=>{inMapRender=false;});
  function idleMap(){
    if(map.refreshRate!==0)map.refreshRate=0;
    if(map.renderList?.length)map.renderList=[];
    refresh=Infinity;
  }
  function restart(){generation++;preparedGeneration=readyGeneration=-1;fade=0;light.intensity=0;}
  /** Selection-only publish: no old hand pose, shadow work, or fade advancement. */
  function select(hand:HandItem|null,aboard:boolean,rolling:boolean){
    if(disposed)return;
    const next=flashlightActive(hand,aboard,rolling,tip.isEnabled());
    if(next===active)return;
    active=next;blocked=false;restart();idleMap();
  }
  function refreshCasters(){
    const nearby=candidates.filter(m=>!m.isDisposed()&&m.isEnabled()&&boundsDistanceSquared(m,light.position)<=FLASHLIGHT.range**2);
    nearby.sort((a,b)=>Number(wall(b))-Number(wall(a))||boundsDistanceSquared(a,light.position)-boundsDistanceSquared(b,light.position));
    const list:AbstractMesh[]=[];let vertices=0;
    for(const mesh of nearby){
      const count=mesh.getTotalVertices();
      if(list.length>=FLASHLIGHT.maxCasters)break;
      if(vertices+count>FLASHLIGHT.maxCasterVertices)continue;
      list.push(mesh);vertices+=count;
    }
    map.renderList=list;refresh=0;
  }
  function update(hand:HandItem|null,yaw:number,player:{x:number;y:number;z:number},aboard:boolean,rolling:boolean,dt:number){
    if(disposed)return;
    select(hand,aboard,rolling);
    if(!active)return;
    // dt=0 means paused or a public state publish, not a freshly animated hand.
    // Freeze an established beam; a newly selected beam stays completely dark.
    if(!Number.isFinite(dt)||dt<=0){if(map.refreshRate!==0)map.refreshRate=0;return;}
    tip.computeWorldMatrix(true);light.position.copyFrom(tip.getAbsolutePosition());flashlightDirection(yaw,light.direction);
    // A carried hand can cross the collision plane before the player's feet.
    // Do not allow an emitter poking through a solid wall to illuminate its far side.
    chest.set(player.x,player.y+1.0,player.z);light.position.subtractToRef(chest,segment);
    ray.length=segment.length();segment.normalize();
    const nextBlocked=walls.some(m=>!m.isDisposed()&&m.isEnabled()&&ray.intersectsMesh(m,false).hit);
    if(nextBlocked!==blocked){blocked=nextBlocked;restart();}
    if(blocked){idleMap();return;}
    light.range=FLASHLIGHT.range;
    // If the user disables all scene shadows, conservatively shorten the light
    // before nearby forward walls instead of leaking through whole buildings.
    if(!scene.shadowsEnabled)for(const mesh of walls){
      if(mesh.isDisposed()||!mesh.isEnabled())continue;
      const box=mesh.getBoundingInfo().boundingBox,center=box.centerWorld;
      const dx=center.x-light.position.x,dz=center.z-light.position.z,radius=box.extendSizeWorld.length();
      if(dx*light.direction.x+dz*light.direction.z+radius<0)continue;
      light.range=Math.min(light.range,Math.max(.05,Math.sqrt(boundsDistanceSquared(mesh,light.position))));
    }
    refresh+=dt;
    if(refresh>=FLASHLIGHT.casterRefresh)refreshCasters();
    preparedGeneration=generation;
    if(map.refreshRate!==1)map.refreshRate=1;
    // The first current-pose map renders at zero intensity. Subsequent updates
    // fade once, in simulation time only; normal aiming never restarts the fade.
    if(scene.shadowsEnabled&&readyGeneration!==generation){light.intensity=0;return;}
    fade=Math.min(FLASHLIGHT.switchFade,fade+Math.min(dt,.045));
    light.intensity=FLASHLIGHT.intensity*(fade/FLASHLIGHT.switchFade);
  }
  return {light,shadow,select,update,get active(){return active;},get shadowReady(){return readyGeneration===generation;},dispose(){
    if(disposed)return;disposed=true;active=false;light.intensity=0;
    map.onBeforeBindObservable.remove(bindMap);map.onBeforeRenderObservable.remove(beforeMap);map.onAfterRenderObservable.remove(afterMap);map.onAfterUnbindObservable.remove(unbindMap);
    shadow.dispose();light.dispose();
  }};
}
