import assert from "node:assert/strict";
import { GameAudio,SOUND_IDS,synthesizeSound,footstepSurface } from "../components/game/audio";

export function verifyAudio(){
  for(const sampleRate of [44100,48000])for(const id of SOUND_IDS)for(const variant of [0,1,2]){
    const samples=synthesizeSound(id,variant,sampleRate);let peak=0,power=0;
    for(const value of samples){assert(Number.isFinite(value));peak=Math.max(peak,Math.abs(value));power+=value*value;}
    assert(samples.length>=sampleRate*.04&&samples.length<sampleRate,"Effects are short and bounded (dialogue ticks are exactly 40ms)");
    const rms=Math.sqrt(power/samples.length);
    assert(peak<.24&&rms>.003&&rms<.045,`${id}: quiet but audible, without strong peaks`);
    if(["grass","soil","stone","wood","sand"].includes(id)){
      let differences=0;for(let i=1;i<samples.length;i++)differences+=(samples[i]-samples[i-1])**2;
      assert(Math.sqrt(differences/power)<.085,"Footsteps exclude the sharp transients that sound like firecrackers");
      assert(peak<.14&&rms<.03,"Running uses a restrained footstep source instead of a bass impact");
    }
    assert(samples[0]===0);assert(Math.abs(samples.at(-1)!)<.002,"Fade avoids a click at the end");
  }
  assert.equal(footstepSurface("bridge"),"wood");assert.equal(footstepSurface("floor"),"wood");
  assert.equal(footstepSurface("sand"),"sand");assert.equal(footstepSurface("path"),"stone");assert.equal(footstepSurface("dirt"),"soil");
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,"window"),oldDocument=Object.getOwnPropertyDescriptor(globalThis,"document");
  const state={created:0,playing:0,starts:0,closed:0,buffers:0,hidden:false};
  const param=()=>({value:0,setTargetAtTime(value:number){this.value=value;}});
  class Node {connect(){}disconnect(){}}
  let pendingResume=false;
  class Context {
    state="suspended";sampleRate=44100;currentTime=0;destination=new Node();
    constructor(){state.created++;}
    resume(){if(pendingResume)return new Promise<void>(()=>{});this.state="running";return Promise.resolve();}
    close(){this.state="closed";state.closed++;return Promise.resolve();}
    createGain(){return Object.assign(new Node(),{gain:param()});}
    createDynamicsCompressor(){return Object.assign(new Node(),{threshold:param(),knee:param(),ratio:param(),attack:param(),release:param()});}
    createBuffer(_channels:number,length:number){state.buffers++;const data=new Float32Array(length);return {getChannelData:()=>data};}
    createBufferSource(){return Object.assign(new Node(),{buffer:null,playbackRate:param(),onended:null,start(){state.starts++;state.playing++;},stop(){state.playing--;}});}
  }
  Object.defineProperty(globalThis,"window",{value:{AudioContext:Context},configurable:true});
  Object.defineProperty(globalThis,"document",{value:{get hidden(){return state.hidden;}},configurable:true});
  const sound=new GameAudio();
  try{
    sound.play("grass");assert.equal(state.created,0,"Loading a game must not start audio");
    sound.settings(false,.55);sound.unlock();assert.equal(state.created,0,"Muted games do not acquire audio");
    sound.settings(true,.55);sound.unlock();sound.unlock();assert.equal(state.created,1,"One context is shared across gestures");
    for(let i=0;i<30;i++)sound.play("grass");assert.equal(state.playing,10,"Rapid input has a bounded voice pool");assert.equal(state.buffers,3,"Footstep variations reuse their buffers");
    sound.stop();assert.equal(state.playing,0,"Pause or lost focus stops active sounds");
    const starts=state.starts;sound.settings(false,.55);sound.play("coin");sound.settings(true,0);sound.play("coin");
    sound.settings(true,.55);state.hidden=true;sound.play("grass");assert.equal(state.starts,starts,"Muted, zero-volume and background effects are silent");
    state.hidden=false;sound.play("coin");assert.equal(state.playing,1);
    sound.dispose();assert.equal(state.playing,0);assert.equal(state.closed,1);sound.unlock();sound.play("coin");assert.equal(state.created,1);
    const retry=new GameAudio();pendingResume=true;retry.unlock();const before=state.starts;retry.play("bossAlert");assert.equal(state.starts,before);
    pendingResume=false;retry.unlock();retry.play("bossAlert");assert.equal(state.starts,before+1,"A pending modifier-key resume cannot block the next activated input");retry.dispose();
  }finally{
    sound.dispose();
    if(oldWindow)Object.defineProperty(globalThis,"window",oldWindow);else Reflect.deleteProperty(globalThis,"window");
    if(oldDocument)Object.defineProperty(globalThis,"document",oldDocument);else Reflect.deleteProperty(globalThis,"document");
  }
  console.log("Audio regression passed: bounded signals, terrain sounds, gesture unlock, mute/volume/background gating, voice reuse and cleanup.");
}
