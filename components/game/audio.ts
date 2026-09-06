import type { TileKind } from "./farming";

export type SoundId="grass"|"soil"|"stone"|"wood"|"sand"|"hoe"|"seeds"|"water"|"scythe"|"pickup"|"coin"|"select"|"drop"|"paddle"|"pistol"|"sword"|"slime"|"startled"|"cast"|"splash"|"bite"|"reel"|"fishCatch"|"fishEscape";
export const SOUND_IDS:SoundId[]=["grass","soil","stone","wood","sand","hoe","seeds","water","scythe","pickup","coin","select","drop","paddle","pistol","sword","slime","startled","cast","splash","bite","reel","fishCatch","fishEscape"];
const durations:Record<SoundId,number>={grass:.30,soil:.26,stone:.23,wood:.26,sand:.32,hoe:.34,seeds:.28,water:.70,scythe:.38,pickup:.28,coin:.35,select:.11,drop:.25,paddle:.52,pistol:.24,sword:.33,slime:.30,startled:.34,cast:.4,splash:.48,bite:.5,reel:.25,fishCatch:.65,fishEscape:.4};

export function footstepSurface(kind:TileKind):SoundId{
  if(kind==="bridge"||kind==="dock"||kind==="floor")return "wood";
  if(kind==="path"||kind==="rock")return "stone";
  if(kind==="sand"||kind==="bank")return "sand";
  return kind==="dirt"?"soil":"grass";
}

/** Original procedural Foley, generated locally; no third-party recordings. */
export function synthesizeSound(id:SoundId,variant:number,sampleRate:number):Float32Array{
  const duration=durations[id],samples=new Float32Array(Math.ceil(duration*sampleRate));
  let seed=(id.length*9013+variant*7919+17)>>>0,low=0,body=0,filtered=0,filtered2=0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
  const tone=(t:number,hz:number,decay:number)=>Math.sin(t*hz*Math.PI*2)*Math.exp(-t*decay);
  const soft=id==="grass"||id==="soil"||id==="sand",step=soft||id==="stone"||id==="wood";
  for(let i=0;i<samples.length;i++){
    const t=i/sampleRate,u=t/duration,white=random();
    low+= (white-low)*(1-Math.exp(-2*Math.PI*1100/sampleRate));
    body+= (white-body)*(1-Math.exp(-2*Math.PI*210/sampleRate));
    const attack=.5-.5*Math.cos(Math.PI*Math.min(1,t/(step?.032:.018))),tail=Math.min(1,(duration-t)/.05);
    let value=0;
    if(step){
      const heel=Math.exp(-Math.pow((t-.045)/.04,2)),scrape=Math.exp(-Math.pow((t-.115-variant*.008)/.075,2));
      // Rounded, filtered friction with no impulse train or synthetic bass kick.
      value=body*.65*heel+low*(soft?.28:.12)*scrape;
      if(id==="wood")value+=tone(t,230+variant*12,32)*.028*heel;
      if(id==="stone")value+=low*.15*heel;
    }else if(id==="hoe"||id==="drop"){
      value=(body*.85+low*.16)*Math.exp(-Math.pow((t-.06)/.06,2))+low*.10*Math.exp(-t*12);
    }else if(id==="water"||id==="paddle"){
      const flow=Math.pow(Math.sin(Math.PI*u),.65),bubbles=Math.sin(2*Math.PI*(620*t+340*t*t));
      value=(low*.26+body*.35)*flow;
      value+=bubbles*.035*Math.pow(Math.max(0,Math.sin(t*64)),8)*flow;
      if(id==="paddle")value+=body*.3*Math.exp(-t*24);
    }else if(id==="scythe"||id==="sword"){
      value=low*.32*Math.pow(Math.sin(Math.PI*u),2.2);
    }else if(id==="pistol"){
      value=(body*.95+low*.35)*Math.exp(-t*24)+tone(t,370,45)*.04;
    }else if(id==="slime"){
      value=Math.sin(2*Math.PI*(190*t-180*t*t))*.10*Math.pow(Math.sin(Math.PI*u),2)+body*.15;
    }else if(id==="startled"){
      // A quick, wobbly squeak: a startled villager's cry, no sample.
      const wobble=Math.sin(2*Math.PI*(23*t));
      value=tone(t,620+wobble*120+480*t,7)*.30*Math.pow(Math.sin(Math.PI*u),1.2);
      value+=tone(t,1240+wobble*200,14)*.09*Math.pow(Math.sin(Math.PI*u),2);
    }else if(id==="cast"){
      value=low*.35*Math.pow(Math.sin(Math.PI*u),2)+tone(t,420,16)*.035;
    }else if(id==="splash"){
      value=(low*.4+body*.55)*Math.pow(Math.sin(Math.PI*u),1.3)+tone(t,720-420*u,10)*.05;
    }else if(id==="bite"){
      value=tone(t,880,9)*.18+(t>.12?tone(t-.12,1320,12)*.13:0);
    }else if(id==="reel"){
      value=low*.16*Math.pow(Math.max(0,Math.sin(t*125)),4)+tone(t,540,15)*.045;
    }else if(id==="fishCatch"){
      for(let note=0;note<3;note++){const age=t-note*.12;if(age>=0)value+=tone(age,[660,880,1320][note],9)*.12*Math.min(1,age/.015);}
    }else if(id==="fishEscape"){
      value=Math.sin(2*Math.PI*(600*t-380*t*t))*.10*Math.pow(Math.sin(Math.PI*u),2);
    }else if(id==="seeds"){
      value=low*.23*Math.pow(Math.sin(Math.PI*u),2);
    }else if(id==="select"){
      value=tone(t,620,45)*.07;
    }else{
      const second=Math.max(0,t-.07),hz=id==="coin"?1175:660;
      value=tone(t,hz,20)*.055;
      if(t>.07)value+=tone(second,hz*1.5,24)*.035*Math.min(1,second/.02);
    }
    const cutoff=step?900:2100,alpha=1-Math.exp(-2*Math.PI*cutoff/sampleRate);
    filtered+=(value-filtered)*alpha;filtered2+=(filtered-filtered2)*alpha;
    samples[i]=filtered2*attack*tail*.7;
  }
  return samples;
}

type Voice={source:AudioBufferSourceNode;gain:GainNode};
/** Audio is unlocked by a real input gesture and never queues sounds while locked. */
export class GameAudio {
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private compressor:DynamicsCompressorNode|null=null;
  private buffers=new Map<string,AudioBuffer>();
  private voices=new Set<Voice>();
  private variants=new Map<SoundId,number>();
  private enabled=true;private volume=.55;private disposed=false;private unavailable=false;
  private resuming=false;

  unlock(){
    if(this.disposed||this.unavailable||!this.enabled)return;
    try{
      if(!this.context){
        const Audio=window.AudioContext??(window as Window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
        if(!Audio){this.unavailable=true;return;}
        const context=this.context=new Audio({latencyHint:"interactive"});
        this.master=context.createGain();this.master.gain.value=this.volume;
        this.compressor=context.createDynamicsCompressor();
        this.compressor.threshold.value=-12;this.compressor.knee.value=12;this.compressor.ratio.value=3;
        this.compressor.attack.value=.003;this.compressor.release.value=.12;
        this.master.connect(this.compressor);this.compressor.connect(context.destination);
      }
      if(this.context.state!=="running"&&!this.resuming){
        this.resuming=true;
        void this.context.resume().catch(()=>{}).finally(()=>{this.resuming=false;});
      }
    }catch{this.unavailable=true;}
  }

  settings(enabled:boolean,volume:number){
    this.enabled=enabled;this.volume=Number.isFinite(volume)?Math.max(0,Math.min(1,volume)):.55;
    if(this.master&&this.context)this.master.gain.setTargetAtTime(enabled?this.volume:0,this.context.currentTime,.015);
    if(!enabled||this.volume===0)this.stop();
  }

  play(id:SoundId,gain=1){
    const context=this.context;
    if(this.disposed||!this.enabled||this.volume===0||!context||context.state!=="running"||document.hidden)return;
    try{
      const variant=(this.variants.get(id)??0)%3;this.variants.set(id,variant+1);
      const key=id+variant;let buffer=this.buffers.get(key);
      if(!buffer){
        const samples=synthesizeSound(id,variant,context.sampleRate);
        buffer=context.createBuffer(1,samples.length,context.sampleRate);buffer.getChannelData(0).set(samples);this.buffers.set(key,buffer);
      }
      // Bound simultaneous voices; even rapid inventory input cannot pile up.
      if(this.voices.size>=10)this.release(this.voices.values().next().value!);
      const source=context.createBufferSource(),level=context.createGain(),voice={source,gain:level};
      source.buffer=buffer;source.playbackRate.value=.96+Math.random()*.08;
      level.gain.value=gain;source.connect(level);level.connect(this.master!);
      this.voices.add(voice);source.onended=()=>{source.disconnect();level.disconnect();this.voices.delete(voice);};
      source.start();
    }catch{/* Sound failure never interrupts movement or rendering. */}
  }

  step(kind:TileKind,running:boolean){this.play(footstepSurface(kind),running?.80:.65);}
  private release(voice:Voice){voice.source.onended=null;try{voice.source.stop();}catch{}voice.source.disconnect();voice.gain.disconnect();this.voices.delete(voice);}
  stop(){for(const voice of this.voices)this.release(voice);}
  dispose(){
    if(this.disposed)return;this.disposed=true;this.stop();this.buffers.clear();
    this.master?.disconnect();this.compressor?.disconnect();
    if(this.context)void this.context.close().catch(()=>{});
    this.context=null;this.master=null;this.compressor=null;
  }
}
