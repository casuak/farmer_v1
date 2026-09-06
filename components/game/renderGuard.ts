type RenderGuardOptions={
  isReady:()=>boolean;
  readFrame:()=>Promise<Uint8Array[]>;
  recover:()=>boolean;
  onReady:()=>void;
  onError:(reason:string)=>void;
};

// Even at night the world has readable blue ambient light. Alpha alone (opaque
// black) is not evidence of a rendered frame; sample the final framebuffer RGB.
export function hasVisibleFrame(samples:readonly Uint8Array[]):boolean {
  return samples.some(pixels=>{
    for(let i=0;i+3<pixels.length;i+=4)if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>12)return true;
    return false;
  });
}

/** Bounded first-frame validation, repeated after resizing or changing effects. */
export class RenderGuard {
  private elapsed=0;
  private nextCheck=.25;
  private darkFrames=0;
  private visibleFrames=0;
  private announced=false;
  private watching=true;
  private pending=false;
  private stopped=false;
  private generation=0;

  constructor(private readonly options:RenderGuardOptions){}

  watch(){
    if(this.stopped)return;
    this.generation++;this.elapsed=0;this.nextCheck=.25;
    this.darkFrames=0;this.visibleFrames=0;this.pending=false;this.watching=true;
  }

  fail(reason:string){
    if(this.stopped)return;
    this.generation++;this.pending=false;
    try{
      if(this.options.recover()){this.watch();return;}
    }catch{
      // A failed recovery must still reach the visible error overlay.
    }
    this.stopped=true;this.options.onError(reason);
  }

  afterFrame(dt:number){
    if(this.stopped||!this.watching)return;
    this.elapsed+=Math.max(0,dt);
    // Shader compilation and framebuffer reads must not hide the game forever.
    if(this.elapsed>20){this.fail("画面未能完成渲染，请重新进入农场。");return;}
    if(this.pending||this.elapsed<this.nextCheck)return;
    this.nextCheck=this.elapsed+.35;
    if(!this.options.isReady())return;
    const generation=this.generation;this.pending=true;
    let frame:Promise<Uint8Array[]>;
    // Invoke readPixels in the render callback, before the browser is allowed
    // to clear a canvas created with preserveDrawingBuffer: false.
    try{frame=this.options.readFrame();}
    catch{this.fail("无法读取游戏画面，请重新进入农场。");return;}
    void frame.then(samples=>{
      if(this.stopped||generation!==this.generation)return;
      this.pending=false;
      if(hasVisibleFrame(samples)){
        this.darkFrames=0;this.visibleFrames++;
        if(this.visibleFrames>=2&&!this.announced){this.announced=true;this.options.onReady();}
        // Stop GPU readbacks after a short startup window. Changes re-arm them.
        if(this.visibleFrames>=6)this.watching=false;
      }else{
        this.visibleFrames=0;
        if(++this.darkFrames>=3)this.fail("画面输出异常，请重新进入农场。");
      }
    },()=>{
      if(!this.stopped&&generation===this.generation)this.fail("无法读取游戏画面，请重新进入农场。");
    });
  }

  dispose(){this.stopped=true;this.generation++;}
}
