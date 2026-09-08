import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { buildWorld } from "../components/game/world";
import type { createSpringLighting } from "../components/game/lighting";
import { DayNightClock,DAY_SECONDS,MAX_TIME_SCALE,MIN_TIME_SCALE,TIME_SCALES,formatClock,solarAt } from "../components/game/dayNight";
import { projectMapPoint } from "../components/game/mapProjection";
import { hasVisibleFrame } from "../components/game/renderGuard";

export function verifyDaylight(scene:Scene,camera:Camera,world:ReturnType<typeof buildWorld>,lighting:ReturnType<typeof createSpringLighting>){
  const clock=new DayNightClock();clock.update(DAY_SECONDS);
  assert.deepEqual(clock.snapshot(),{day:2,minutes:480},"One real-time cycle advances the calendar by one day");
  clock.setHour(23.5);clock.update(30);assert.deepEqual(clock.snapshot(),{day:3,minutes:42});assert.equal(formatClock(clock.snapshot().minutes),"00:42");
  const paused=clock.snapshot();clock.update(90,0);assert.deepEqual(clock.snapshot(),paused);
  for(const scale of TIME_SCALES){const c=new DayNightClock();c.update(1,scale);assert(Math.abs(c.snapshot().minutes-480-2.4*scale)<.00001);}
  const day=clock.snapshot().day;clock.setHour(12);assert.equal(clock.snapshot().day,day,"Scrubbing time does not change the calendar day");
  clock.update(NaN);clock.setHour(Infinity);assert.equal(clock.hour,12);
  for(const scale of [MIN_TIME_SCALE,MAX_TIME_SCALE,2.5,.75,12]){
    const c=new DayNightClock();c.update(1,scale);assert(Math.abs(c.snapshot().minutes-480-2.4*scale)<.00001,`Arbitrary typed speed ${scale}× maps to real clock advance`);
  }
  const bounded=new DayNightClock();bounded.update(1,100);assert(Math.abs(bounded.snapshot().minutes-480-2.4*MAX_TIME_SCALE)<.00001,"The engine caps speed at the documented maximum");
  assert.deepEqual(solarAt(0),solarAt(24),"Midnight is continuous");

  // Compare the map to Babylon's actual camera rotation, not another map formula.
  const view=camera.getViewMatrix(true);
  for(const [x,z] of [[0,1],[1,0],[-48,-40],[48,40],[-8,7],[37,0]]){
    const p=Vector3.TransformNormal(new Vector3(x,0,z),view),map=projectMapPoint(x,z);
    assert(Math.abs(p.x-map.x)<.00001&&Math.abs(-p.y-map.y)<.00001,"Map and game camera share the same projected axes");
  }
  assert(projectMapPoint(0,1).x>0&&projectMapPoint(0,1).y<0,"North points up-right");

  const target={x:12,z:20};
  function shadowTip(hour:number){
    lighting.update(hour,target);const d=lighting.sun.direction;
    return new Vector3(d.x*2/-d.y,0,d.z*2/-d.y);
  }
  const morning=shadowTip(8),noon=shadowTip(12),evening=shadowTip(16);
  assert(morning.x<0&&evening.x>0,"Sun movement reverses the east-west shadow direction");
  assert(noon.length()<morning.length()&&noon.length()<evening.length(),"Noon shadows shorten");
  for(let hour=0;hour<24;hour+=.25){
    const solar=lighting.update(hour,target);
    assert([lighting.sun.position.x,lighting.sun.position.y,lighting.sun.position.z,lighting.sun.direction.x,lighting.sun.direction.y,lighting.sun.direction.z].every(Number.isFinite));
    assert(solar.daylight>=0&&solar.daylight<=1);
    assert(lighting.sun.position.y>10,"Low-angle sunlight keeps a stable shadow projection");
  }
  const night=lighting.update(0,target);world.update(4,true,undefined,true,0,night);
  assert.equal(lighting.sun.intensity,0);assert(scene.fogColor.b>scene.fogColor.r);
  assert(hasVisibleFrame([new Uint8Array([scene.clearColor.r*255,scene.clearColor.g*255,scene.clearColor.b*255,255])]),"The blue night palette is not classified as a black-screen failure");
  assert(scene.getMeshByName("town-evening-lanterns")!.isEnabled());
  for(const name of ["flowing-spring-water","tidal-waves-and-sunlight"]){
    const data=scene.getMaterialByName(name)!.serialize();
    assert.equal(data.floats.daylight,0);assert.equal(data.floats.sunStrength,0,"Water must not retain noon sun highlights at night");
  }
  const daylight=lighting.update(8,target);world.update(4,true,undefined,true,0,daylight);
  assert(!scene.getMeshByName("town-evening-lanterns")!.isEnabled());
  console.log("Daylight regression passed: camera-matched map axes, time speeds/pause/rollover, sun trajectory, shadow direction/length, readable night and synchronized water/lanterns.");
}
