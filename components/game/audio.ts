import type { TileKind } from "./farming";

export type SoundId="grass"|"soil"|"stone"|"wood"|"sand"|"hoe"|"seeds"|"water"|"scythe"|"pickup"|"coin"|"select"|"drop"|"paddle";
export const SOUND_IDS:SoundId[]=["grass","soil","stone","wood","sand","hoe","seeds","water","scythe","pickup","coin","select","drop","paddle"];
const durations:Record<SoundId,number>={grass:.23,soil:.20,stone:.17,wood:.21,sand:.27,hoe:.30,seeds:.24,water:.65,scythe:.32,pickup:.22,coin:.32,select:.065,drop:.19,paddle:.46};

export function footstepSurface(kind:TileKind):SoundId{
  if(kind==="bridge"||kind==="dock"||kind==="floor")return "wood";
  if(kind==="path"||kind==="rock")return "stone";
  if(kind==="sand"||kind==="bank")return "sand";
  return kind==="dirt"?"soil":"grass";
}

/** Original procedural Foley, generated locally; no third-party recordings. */
export function synthesizeSound(id:SoundId,variant:number,sampleRate:number):Float32Array{
  const duration=durations[id],samples=new Float32Array(Math.ceil(duration*sampleRate));
  let seed=(id.length*9013+variant*7919+17)>>>0,low=0,body=0,grit=0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
  const tone=(t:number,hz:number,decay:number)=>Math.sin(t*hz*Math.PI*2)*Math.exp(-t*decay);
  const soft=id==="grass"||id==="soil"||id==="sand",step=soft||id==="stone"||id==="wood";
  for(let i=0;i<samples.length;i++){
    const t=i/sampleRate,u=t/duration,white=random();
    low+= (white-low)*(1-Math.exp(-2*Math.PI*1100/sampleRate));
    body+= (white-body)*(1-Math.exp(-2*Math.PI*210/sampleRate));
    if(random()>.986)grit=white;else grit*=Math.exp(-110/sampleRate);
    const attack=Math.min(1,t/.005),tail=Math.min(1,(duration-t)/.018);
    let value=0;
    if(step){
      const heel=Math.exp(-t*(soft?25:42)),scrape=Math.exp(-Math.pow((t-.065)/.052,2));
      const sole=tone(t,(id==="wood"?145:id==="stone"?115:78)+variant*5,38);
      value=(body*2.6+sole*.22)*heel;
      if(id==="wood")value+=tone(t,320+variant*18,44)*.09+low*.18*heel;
      else if(id==="stone")value+=(white-low)*.15*heel+tone(t,540+variant*22,65)*.04;
      else value+=(low*.30+grit*(id==="sand"?.18:.30))*scrape;
    }else if(id==="hoe"||id==="drop"){
      value=(body*3.2+tone(t,id==="hoe"?84:130,32)*.35)*Math.exp(-t*20)+grit*.24*Math.exp(-t*13);
    }else if(id==="water"||id==="paddle"){
      const flow=Math.pow(Math.sin(Math.PI*u),.65),bubbles=Math.sin(2*Math.PI*(620*t+340*t*t));
      value=(low*.47+body*.80+white*.035)*flow;
      value+=bubbles*.035*Math.pow(Math.max(0,Math.sin(t*64)),8)*flow;
      if(id==="paddle")value+=body*1.6*Math.exp(-t*24);
    }else if(id==="scythe"){
      value=(white-low)*.16*Math.pow(Math.sin(Math.PI*u),1.8)+grit*.17*Math.exp(-Math.pow((u-.64)/.18,2));
    }else if(id==="seeds"){
      value=(white-low)*.15*(Math.exp(-t*90)+Math.exp(-Math.pow((t-.07)/.013,2))*.7+Math.exp(-Math.pow((t-.13)/.02,2))*.45);
    }else if(id==="select"){
      value=tone(t,850,95)*.19+low*.12*Math.exp(-t*90);
    }else{
      const second=Math.max(0,t-.07),hz=id==="coin"?1175:660;
      value=tone(t,hz,26)*.13+tone(t,hz*2.01,38)*.045;
      if(t>.07)value+=tone(second,hz*1.5,28)*.12;
    }
    samples[i]=Math.tanh(value)*attack*tail;
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

  step(kind:TileKind,running:boolean){this.play(footstepSurface(kind),running?1.12:.88);}
  private release(voice:Voice){voice.source.onended=null;try{voice.source.stop();}catch{}voice.source.disconnect();voice.gain.disconnect();this.voices.delete(voice);}
  stop(){for(const voice of this.voices)this.release(voice);}
  dispose(){
    if(this.disposed)return;this.disposed=true;this.stop();this.buffers.clear();
    this.master?.disconnect();this.compressor?.disconnect();
    if(this.context)void this.context.close().catch(()=>{});
    this.context=null;this.master=null;this.compressor=null;
  }
}
