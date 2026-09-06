import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { buildWorld } from "../components/game/world";
import type { createSpringLighting } from "../components/game/lighting";
import { solarAt } from "../components/game/dayNight";
import { surfaceKind } from "../components/game/geography";
import { SHADOW_MAP_SIZE } from "../components/game/stableShadows";
import { streetLightPower,ACTIVE_STREET_LIGHTS } from "../components/game/streetLights";

export function verifyShadowAndLamps(scene:Scene,world:ReturnType<typeof buildWorld>,lighting:ReturnType<typeof createSpringLighting>){
  assert.equal(lighting.shadow.getShadowMap()!.getSize().width,SHADOW_MAP_SIZE,"Desktop shadows use the finer 4096-pixel raster");
  assert.notEqual(lighting.shadow.filter,ShadowGenerator.FILTER_PCSS,"The shadow filter must not use a rotating random kernel");
  assert(!lighting.shadow.enableSoftTransparentShadow);
  lighting.update(8,{x:0,z:0});const origin=lighting.sun.position.clone();
  lighting.update(8,{x:.001,z:-.001});assert(Vector3.Distance(origin,lighting.sun.position)<1e-10,"Sub-texel camera easing does not move the shadow raster");
  const point=new Vector3(4,0,3);let first:Vector3|null=null;
  for(let i=0;i<80;i++){
    lighting.update(8,{x:-3.5+i*.013,z:2+i*.007});scene.incrementRenderId();
    const projected=Vector3.TransformCoordinates(point,lighting.shadow.getTransformMatrix());
    if(!first)first=projected;
    const x=(projected.x-first.x)*SHADOW_MAP_SIZE/2,y=(projected.y-first.y)*SHADOW_MAP_SIZE/2;
    assert(Math.abs(x-Math.round(x))<.0004&&Math.abs(y-Math.round(y))<.0004,"A world point moves only by whole shadow texels while the camera pans");
  }
  lighting.update(8,{x:0,z:0});scene.incrementRenderId();const morning=Array.from(lighting.shadow.getTransformMatrix().m);
  lighting.update(16,{x:0,z:0});scene.incrementRenderId();const afternoon=Array.from(lighting.shadow.getTransformMatrix().m);
  assert(morning.some((v,i)=>Math.abs(v-afternoon[i])>.001),"Stabilization preserves the moving sun and changing shadows");

  const street=world.streetLights;
  assert.equal(street.fixtures.length,14);assert.equal(street.slots.length,ACTIVE_STREET_LIGHTS);
  assert(lighting.shadow.getShadowMap()!.renderList!.includes(street.postMesh));
  for(const f of street.fixtures){
    assert(!world.roomAt(f),`${f.id}: lamp stays outdoors`);
    assert(!world.canWalk(f.x,f.z),`${f.id}: base participates in collisions`);
    const overlap=world.obstacles.filter(o=>!(o.x===f.x&&o.z===f.z&&o.w===.46)&&Math.abs(o.x-f.x)<o.w/2+.24&&Math.abs(o.z-f.z)<o.d/2+.24);
    assert.equal(overlap.length,0,`${f.id}: lamp is clear of trees, furniture and walls`);
  }
  const positions=street.pools.getVerticesData("position")!;
  for(let i=0;i<positions.length;i+=12){
    const kind=surfaceKind(positions[i]+.5,positions[i+2]+.5);
    assert(kind!=="sea"&&kind!=="water","Ground light pools are clipped off water");
  }
  for(const hour of [8,12,16]){
    street.update(hour,0,{x:-3.5,z:-3.5});
    assert(!street.glow.isEnabled()&&!street.pools.isEnabled());
    assert(street.slots.every(s=>!s.light.isEnabled()&&s.light.intensity===0),"Lights are off by day");
  }
  assert(streetLightPower(17.1)<streetLightPower(17.5)&&streetLightPower(17.5)<streetLightPower(18));
  assert(streetLightPower(6.5)<streetLightPower(6)&&streetLightPower(6)<streetLightPower(5.5));
  assert.equal(streetLightPower(0),streetLightPower(24));
  const meshCount=scene.meshes.length,lightCount=scene.lights.length;
  for(const focus of [{x:-3.5,z:-3.5},{x:-26,z:-8},{x:37,z:0},{x:1,z:22}]){
    world.update(10,false,undefined,true,0,solarAt(22),focus);
    assert(street.glow.isEnabled()&&street.pools.isEnabled(),"Lamp switching also works with ambient motion disabled");
    assert.equal(street.slots.filter(s=>s.light.isEnabled()).length,ACTIVE_STREET_LIGHTS);
    for(const slot of street.slots){
      assert(slot.fixture&&slot.light.intensity>0);assert(!slot.light.shadowEnabled,"Street lights add no extra unstable shadow maps");
      assert.equal(slot.light.position.x,slot.fixture.x);assert.equal(slot.light.position.z,slot.fixture.z);
      assert(slot.light.canAffectMesh(scene.getMeshByName("farmer-torso")!));
      assert(!slot.light.canAffectMesh(scene.getMeshByName("home-interior")!),"Street lights do not leak through house walls");
    }
  }
  for(let i=0;i<80;i++)street.update(22,1/60,{x:-26,z:-13});
  assert.equal(scene.meshes.length,meshCount);assert.equal(scene.lights.length,lightCount,"Walking reuses the same bounded light pool");
  assert((scene.getMeshByName("farmer-torso")!.material as StandardMaterial).maxSimultaneousLights>=7,"Actors have light slots for nearby lamps as well as sunlight");
  world.update(10,true,undefined,true,0,lighting.update(8,{x:0,z:0}));
  console.log("Shadow/lamp regression passed: stable shadow texel alignment, continuous sun direction, 14 clear lamp sites, collision/routes, dusk/dawn fades, ground pools, bounded actor lighting and interior isolation.");
}
