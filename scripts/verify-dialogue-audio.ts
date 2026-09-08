import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GameAudio,SOUND_IDS,synthesizeSound } from "../components/game/audio";

assert(SOUND_IDS.includes("dialogueTick"));
for(const rate of [22050,44100,48000]){
  const variants=[0,1,2].map(variant=>synthesizeSound("dialogueTick",variant,rate));
  for(const samples of variants){
    assert.equal(samples.length,Math.ceil(.04*rate));
    assert(samples.every(Number.isFinite));
    const peak=samples.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
    assert(peak>.001&&peak<.08,`quiet but audible tick peak: ${peak}`);
    assert(Math.abs(samples[0])<1e-6&&Math.abs(samples[samples.length-1])<1e-5,"rounded silent ends");
  }
  assert.notDeepEqual(variants[0],variants[1]);assert.notDeepEqual(variants[1],variants[2]);
  assert.deepEqual(variants[0],synthesizeSound("dialogueTick",0,rate),"deterministic synthesis");
}

class FakeParam {value=0;setTargetAtTime(value:number){this.value=value;}}
class FakeNode {disconnects=0;connect(){}disconnect(){this.disconnects++;}}
class FakeGain extends FakeNode {gain=new FakeParam();}
class FakeSource extends FakeNode {
  buffer:unknown=null;playbackRate=new FakeParam();onended:(()=>void)|null=null;started=false;stopped=false;
  start(){this.started=true;}stop(){this.stopped=true;}finish(){this.onended?.();}
}
class FakeContext {
  static made:FakeContext[]=[];
  state="running";sampleRate=48000;currentTime=0;destination={};sources:FakeSource[]=[];gains:FakeGain[]=[];
  constructor(){FakeContext.made.push(this);}
  createGain(){const gain=new FakeGain();this.gains.push(gain);return gain;}
  createDynamicsCompressor(){return Object.assign(new FakeNode(),{threshold:new FakeParam(),knee:new FakeParam(),ratio:new FakeParam(),attack:new FakeParam(),release:new FakeParam()});}
  createBuffer(_channels:number,length:number){const samples=new Float32Array(length);return {getChannelData:()=>samples};}
  createBufferSource(){const source=new FakeSource();this.sources.push(source);return source;}
  resume(){this.state="running";return Promise.resolve();}
  close(){this.state="closed";return Promise.resolve();}
}
const oldWindow=Object.getOwnPropertyDescriptor(globalThis,"window"),oldDocument=Object.getOwnPropertyDescriptor(globalThis,"document");
const doc={hidden:false};
Object.defineProperty(globalThis,"window",{configurable:true,value:{AudioContext:FakeContext}});
Object.defineProperty(globalThis,"document",{configurable:true,value:doc});
try{
  const audio=new GameAudio();audio.play("dialogueTick");
  assert.equal(FakeContext.made.length,0,"locked playback does not create or queue audio");
  audio.unlock();const context=FakeContext.made[0];
  assert.equal(context.sources.length,0,"unlock never replays skipped ticks");
  audio.play("dialogueTick");audio.play("dialogueTick");audio.play("dialogueTick");
  assert.equal(context.sources.length,3);
  assert.notEqual(context.sources[0].buffer,context.sources[1].buffer);
  audio.play("dialogueTick");assert.equal(context.sources[3].buffer,context.sources[0].buffer,"three variants are cached and cycle");
  assert((context.sources[0].buffer as {getChannelData:()=>Float32Array}).getChannelData().length/context.sampleRate/context.sources[0].playbackRate.value<.05);
  audio.play("coin");const coin=context.sources.at(-1)!;
  audio.stopSound("dialogueTick");
  assert(context.sources.slice(0,4).every(source=>source.stopped&&source.disconnects===1));
  assert(!coin.stopped,"selective tick cancellation leaves other audio untouched");
  coin.finish();assert.equal(coin.disconnects,1,"natural finish disconnects and frees voice");
  for(let i=0;i<24;i++)audio.play("dialogueTick");
  assert.equal(context.sources.filter(source=>source.started&&!source.stopped&&source.disconnects===0).length,10,"global 10-voice cap");
  audio.settings(true,0);assert(context.sources.every(source=>source.stopped||source.disconnects>0));
  let count=context.sources.length;audio.play("dialogueTick");assert.equal(context.sources.length,count,"zero volume is silent");
  audio.settings(false,.55);audio.play("dialogueTick");assert.equal(context.sources.length,count,"disabled audio is silent");
  audio.settings(true,.25);assert.equal(context.gains[0].gain.value,.25,"tick uses the ordinary master volume");
  doc.hidden=true;audio.play("dialogueTick");assert.equal(context.sources.length,count,"hidden documents never play ticks");
  doc.hidden=false;context.state="suspended";audio.play("dialogueTick");assert.equal(context.sources.length,count,"suspended context never queues ticks");
  audio.unlock();audio.play("dialogueTick");assert.equal(context.sources.length,++count);
  audio.dispose();assert.equal(context.state,"closed");assert(context.sources.at(-1)!.stopped);
  audio.play("dialogueTick");audio.unlock();audio.dispose();assert.equal(context.sources.length,count,"dispose is final and idempotent");
}finally{
  if(oldWindow)Object.defineProperty(globalThis,"window",oldWindow);else Reflect.deleteProperty(globalThis,"window");
  if(oldDocument)Object.defineProperty(globalThis,"document",oldDocument);else Reflect.deleteProperty(globalThis,"document");
}

// Guard the engine/model boundary: reveal updates have a separate channel and
// at most one Foley call regardless of how many characters a frame reveals.
const engine=readFileSync("components/game/engine.ts","utf8");
assert.match(engine,/const worldPaused=paused\|\|dialogue\.active/);
assert.match(engine,/if\(!paused&&!document\.hidden&&dialogue\.active\)\{\s*const result=dialogue\.update\(realDt\);\s*if\(result\.blips>0\)audio\.play\("dialogueTick"\);\s*if\(result\.changed\)publishDialogue\(\);/);
assert.match(engine,/audio\.stopSound\("dialogueTick"\);action\(\);publishDialogue\(\)/);
assert.match(engine,/if\(!dialogue\.active\)world\.update/);
assert.match(engine,/if\(dialogue\.active\)\{e\.preventDefault\(\);dialogueAdvance\(\);return;\}/);
console.log("Dialogue audio verified: 40ms soft three-variant ticks, unlock/mute/volume/hidden guards, selective cancellation, voice cap, disposal and independent reveal channel.");
