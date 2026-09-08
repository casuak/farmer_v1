import assert from "node:assert/strict";
import { springSceneFilter } from "../components/game/colorGrading";

const values=(hour:number)=>[...springSceneFilter(hour).matchAll(/\(([\d.]+)\)/g)].map(m=>Number(m[1]));
assert.equal(springSceneFilter(12),"saturate(1.220) contrast(1.100) brightness(0.980)");
assert.equal(springSceneFilter(0),"saturate(1.080) contrast(1.020) brightness(1.000)");
assert.deepEqual(values(12),values(8),"The whole sunlit day uses a consistent grade");
assert.deepEqual(values(0),values(24),"Midnight has no filter discontinuity");
assert.equal(springSceneFilter(NaN),springSceneFilter(8));
assert.equal(springSceneFilter(Infinity),springSceneFilter(8));
for(let hour=-24;hour<=48;hour+=.05){
  const [saturation,contrast,brightness]=values(hour);
  assert(saturation>=1.08&&saturation<=1.22);
  assert(contrast>=1.02&&contrast<=1.10);
  assert(brightness>=.98&&brightness<=1);
  assert.equal(springSceneFilter(hour,false),"none","Disabling the filter restores the original rendered color");
  assert.equal(springSceneFilter(hour),springSceneFilter(hour+24),"The grade wraps with the solar clock");
  const next=values(hour+.01);
  assert([saturation,contrast,brightness].every((n,i)=>Math.abs(n-next[i])<=.003),"Dawn and dusk change smoothly, not at a time-of-day label boundary");
}
assert(values(6.5)[0]>values(0)[0]&&values(6.5)[0]<values(12)[0],"Twilight blends day and night strength");
console.log("Color grading regression passed: daytime palette, readable night, smooth solar transitions, midnight wrap, invalid time and original-color toggle.");
