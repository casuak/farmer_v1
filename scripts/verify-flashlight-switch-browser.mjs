// Existing Vite preview only. Disposable real Chrome/CDP, real keys, no runtime edits.
// node scripts/verify-flashlight-switch-browser.mjs [http://127.0.0.1:5177]
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177';
const profile=await mkdtemp(path.join(tmpdir(),'pinebrook-flashlight-switch-'));
const browser=spawn(process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1440,900','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),pending=new Map(),errors=[],consoleErrors=[],screenshots=[],scenarios=[];
let ws,sequence=0,call,evaluate,device,before;
const reportPath='.cache/flashlight-switch-report.json';
try{
  await mkdir('.cache',{recursive:true});let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert(port,'Chrome CDP opened');
  const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')consoleErrors.push(m.params.args.map(a=>a.value??a.description).join(' '));};
  call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},60000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=60000)=>{const start=Date.now();while(Date.now()-start<timeout){const v=await evaluate(expression);if(v)return v;await sleep(50);}throw new Error('Timed out waiting: '+expression);};
  const click=async selector=>{const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});};
  const tap=async key=>{for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key,code:/^[0-9]$/.test(key)?'Digit'+key:key,windowsVirtualKeyCode:key==='Home'?36:key.charCodeAt(0)});};
  const focus=()=>evaluate(`document.querySelector('canvas').focus()`);
  const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png'}),file=`.cache/flashlight-switch-${name}.png`;await writeFile(file,Buffer.from(s.data,'base64'));screenshots.push(file);};
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});await wait(`document.querySelector('canvas')?.dataset.renderStatus==='ready'`);
  await evaluate(`(async()=>{const entry=performance.getEntriesByType('resource').find(e=>e.name.includes('/@babylonjs_core_Engines_engine.js'));if(!entry)throw Error('Requires existing Vite preview');const {Engine}=await import(entry.name);window.__fsScene=Engine.LastCreatedScene;window.__fsConfig=(await import('/components/game/flashlight.ts')).FLASHLIGHT;window.__fsHome=(await import('/components/game/geography.ts')).BUILDINGS.find(b=>b.id==='home');})()`);
  before=await evaluate(`(()=>{const s=window.__fsScene,l=s.getLightByName('held-flashlight');return {logical:document.querySelector('canvas').dataset.flashlightEnabled,enabled:l.isEnabled(),intensity:l.intensity,lights:s.lights.map(l=>({name:l.name,enabled:l.isEnabled(),intensity:l.intensity}))};})()`);
  assert.equal(before.logical,'false');assert(before.enabled);assert.equal(before.intensity,0);
  if(await evaluate(`!!document.querySelector('[aria-label="暂停时间"]')`))await click('[aria-label="暂停时间"]');
  await evaluate(`document.querySelector('[aria-label="当前游戏时刻"] [role="slider"]').focus()`);await tap('Home');await wait(`Number(document.querySelector('canvas').dataset.gameHour)===0`);
  await click('[aria-label="画面设置"]');
  for(const label of ['春日动态','背景音乐','游戏音效'])if(await evaluate(`document.querySelector('[role="switch"][aria-label="${label}"]')?.getAttribute('aria-checked')==='true'`))await click(`[role="switch"][aria-label="${label}"]`);
  await click('[role="dialog"] .dialog-action');await wait(`!document.querySelector('[role="dialog"]')`);await focus();
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:940,y:490,button:'none'});
  // Wait for night lights, settings shaders, camera and held pose to settle BEFORE reference capture.
  await evaluate(`window.__fsScene.whenReadyAsync()`);await sleep(2500);
  device=await evaluate(`(()=>{const e=window.__fsScene.getEngine(),g=e._gl,d=g.getExtension('WEBGL_debug_renderer_info');return {version:g.getParameter(g.VERSION),renderer:g.getParameter(g.RENDERER),unmaskedRenderer:d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):null,width:e.getRenderWidth(),height:e.getRenderHeight(),maxIntensity:window.__fsConfig.intensity,switchFade:window.__fsConfig.switchFade};})()`);
  // Observer samples the actual completed main framebuffer, before browser swap. Small fixed
  // 3x3 blocks cover a screen-wide grid and projected ground behind the beam; no full readback.
  // Keep identities as live JS references/WeakMap ids, not effect names or shader-source equality.
  const install=async()=>evaluate(`(()=>{
    const s=window.__fsScene,e=s.getEngine(),gl=e._gl,l=s.getLightByName('held-flashlight'),w=e.getRenderWidth(),h=e.getRenderHeight();
    const ids=new WeakMap();let next=1;const id=o=>{if(!o)return null;if(!ids.has(o))ids.set(o,next++);return ids.get(o);};
    const materials=s.meshes.filter(m=>m.isEnabled()&&m.isVisible&&m.visibility>0&&m.subMeshes?.some(sm=>sm.effect)&&(/terrain|ground|floor|walls|tree-trunk/.test(m.name)));
    if(materials.length<3)throw Error('Insufficient rendered world-material samples');
    const signatures=()=>materials.map(m=>({name:m.name,mesh:id(m),material:id(m.material),effects:m.subMeshes.map(sm=>id(sm.effect)),lights:m.lightSources.map(id),lightNames:m.lightSources.map(l=>l.name)}));
    const points=[];for(const fy of [.2,.4,.6,.8])for(const fx of [.15,.3,.5,.7,.85])points.push({region:'global',x:Math.round(w*fx),y:Math.round(h*fy)});
    const p=s.getTransformNodeByName('player').position,yaw=s.getTransformNodeByName('body').rotation.y,V=p.constructor,M=s.getTransformMatrix().constructor,vp=s.activeCamera.viewport.toGlobal(w,h);
    // Use the settled real avatar yaw, including before the first-ever flashlight pose.
    const d=new V(-Math.sin(yaw),0,-Math.cos(yaw)),right=new V(-d.z,0,d.x);
    for(const distance of [2.3,3.5,4.8])for(const side of [-1,0,1]){const world=p.subtract(d.scale(distance)).add(right.scale(side*.65));world.y=.04;const screen=V.Project(world,M.Identity(),s.getTransformMatrix(),vp);if(screen.x>4&&screen.y>4&&screen.x<w-4&&screen.y<h-4)points.push({region:'back',x:Math.round(screen.x),y:Math.round(h-screen.y),world:world.asArray()});}
    if(points.filter(p=>p.region==='back').length<3)throw Error('Insufficient back-region samples');
    const bytes=new Uint8Array(36),frames=[],baseline=signatures();let phase='baseline';
    const observer=s.onAfterRenderObservable.add(()=>{const values=points.map(p=>{gl.readPixels(p.x-1,p.y-1,3,3,gl.RGBA,gl.UNSIGNED_BYTE,bytes);let sum=0;for(let i=0;i<36;i+=4)sum+=bytes[i]*.2126+bytes[i+1]*.7152+bytes[i+2]*.0722;return sum/9;});
      const signature=signatures(),changed=signature.filter((m,i)=>JSON.stringify(m)!==JSON.stringify(baseline[i]));
      frames.push({n:frames.length,t:performance.now(),phase,logical:document.querySelector('canvas').dataset.flashlightEnabled,enabled:l.isEnabled(),intensity:l.intensity,shadowReady:document.querySelector('canvas').dataset.flashlightShadowReady,shadowsEnabled:s.shadowsEnabled,position:l.position.asArray(),direction:l.direction.asArray(),lights:s.lights.filter(x=>x!==l).map(x=>({name:x.name,intensity:x.intensity,enabled:x.isEnabled()})),values,changed,gl:gl.getError(),lost:gl.isContextLost(),hour:Number(document.querySelector('canvas').dataset.gameHour)});
    });window.__fsProbe={frames,points,baseline,observer,setPhase:p=>phase=p};return {points,materials:baseline};
  })()`);
  const frameWait=async count=>{const n=await evaluate(`window.__fsProbe.frames.length`);await wait(`window.__fsProbe.frames.length>=${n+count}`);};
  const phase=label=>evaluate(`window.__fsProbe.setPhase(${JSON.stringify(label)})`);
  const key=async(k,label)=>{await phase(label);await focus();await tap(k);};
  const stop=()=>evaluate(`(()=>{const p=window.__fsProbe;window.__fsScene.onAfterRenderObservable.remove(p.observer);return {points:p.points,materials:p.baseline,frames:p.frames};})()`);
  const analyze=(name,data)=>{
    const f=data.frames;assert(f.length>=50,`${name}: enough completed frames`);assert(f.every(x=>x.enabled),`${name}: physical light never unregisters`);assert(f.every(x=>x.gl===0&&!x.lost),`${name}: every-frame GL clean`);assert(f.every(x=>x.hour===0),`${name}: frozen midnight`);
    assert(f.every(x=>x.changed.length===0),`${name}: material effect identity and ordered lightSources stable: ${JSON.stringify(f.find(x=>x.changed.length))}`);
    const external=JSON.stringify(f[0].lights);assert(f.every(x=>JSON.stringify(x.lights)===external),`${name}: sun/street/ambient intensities unchanged`);
    const max=device.maxIntensity;assert(f.every(x=>x.intensity>=0&&x.intensity<=max+1e-6),`${name}: no intensity overshoot`);assert(f.some(x=>x.intensity>0&&x.intensity<max),`${name}: sampled real intermediate forward spotlight intensity`);
    assert(f.filter(x=>x.logical==='false').every(x=>x.intensity===0),`${name}: logical off is zero intensity`);
    assert(f.filter(x=>x.shadowsEnabled&&x.intensity>0).every(x=>x.shadowReady==='true'),`${name}: positive intensity only after a warmed current-pose shadow map`);
    assert(f.filter(x=>x.intensity>0).every(x=>x.position.every(Number.isFinite)&&x.direction.every(Number.isFinite)&&x.direction[1]<0),`${name}: real forward/downward spotlight pose`);
    const drops=[];for(let i=1;i<f.length;i++)if(f[i].logical==='true'&&f[i-1].logical==='true'&&f[i].intensity+1e-6<f[i-1].intensity)drops.push([i,f[i-1].intensity,f[i].intensity]);assert.equal(drops.length,0,`${name}: on ramp is monotonic: ${JSON.stringify(drops)}`);
    const maxIntensityRise=Math.max(...f.slice(1).map((x,i)=>x.intensity-f[i].intensity));
    assert(maxIntensityRise<=max*.045/device.switchFade+1e-5,`${name}: each real frame respects the capped fade step: ${maxIntensityRise}`);
    const base=f.filter(x=>x.phase==='baseline'),reference=data.points.map((_,i)=>base.reduce((n,x)=>n+x.values[i],0)/base.length);
    const backIndices=data.points.map((p,i)=>p.region==='back'?i:-1).filter(i=>i>=0),globalIndices=data.points.map((p,i)=>p.region==='global'?i:-1).filter(i=>i>=0);
    const mean=(x,indices)=>indices.reduce((n,i)=>n+x[i],0)/indices.length;
    const backRef=mean(reference,backIndices),globalRef=mean(reference,globalIndices);
    assert(globalRef>1&&backRef>1,`${name}: valid nonblack framebuffer samples`);
    const metrics=f.map(x=>({n:x.n,phase:x.phase,backDelta:mean(x.values,backIndices)-backRef,globalDelta:mean(x.values,globalIndices)-globalRef,globalMean:mean(x.values,globalIndices)}));
    // 8/255 absolute regional tolerance allows tiny shadow/quantization changes but rejects
    // one-frame global brightness jumps. Global beam contribution may legitimately rise.
    const maxBackDeviation=Math.max(...metrics.map(x=>Math.abs(x.backDelta)));
    assert(maxBackDeviation<=8,`${name}: non-beam back region stable (8/255): ${maxBackDeviation}`);
    const globalSteps=metrics.slice(1).map((x,i)=>Math.abs(x.globalMean-metrics[i].globalMean)),maxGlobalStep=Math.max(...globalSteps);
    assert(maxGlobalStep<=12,`${name}: no single-frame global flash/black frame (12/255): ${maxGlobalStep}`);
    assert(metrics.every(x=>x.globalMean>=globalRef*.55),`${name}: no whole-frame black dropout`);
    return {name,result:'passed',frameCount:f.length,backRef,globalRef,maxBackDeviation,maxGlobalStep,maxIntensityRise,phaseCounts:Object.fromEntries([...new Set(f.map(x=>x.phase))].map(p=>[p,f.filter(x=>x.phase===p).length])),...data};
  };
  const run=async(name,full)=>{
    await install();await frameWait(12);
    await key('9','first-on');await wait(`window.__fsScene.getLightByName('held-flashlight').intensity>=${device.maxIntensity-1e-6}`);await frameWait(12);await shot(name);
    await key('1','first-off');await frameWait(12);await shot(name+'-off');
    for(let i=0;i<(full?8:3);i++){await key('9',`reopen-${i}`);await wait(`window.__fsScene.getLightByName('held-flashlight').intensity>=${device.maxIntensity-1e-6}`);await frameWait(3);await key('1',`close-${i}`);await frameWait(3);}
    for(let i=0;i<(full?16:6);i++){await key('9',`rapid-on-${i}`);await frameWait(1);await key('1',`rapid-off-${i}`);await frameWait(1);}
    await key('9','final-on');await wait(`window.__fsScene.getLightByName('held-flashlight').intensity>=${device.maxIntensity-1e-6}`);await frameWait(8);await key('1','final-off');await frameWait(8);
    const data=await stop();const raw={name,...data};scenarios.push(raw);Object.assign(raw,analyze(name,data));
  };
  await run('night',true);
  // Re-baseline after real room/camera/cutaway changes, never attribute those changes to keys.
  await evaluate(`(()=>{const b=window.__fsHome,p=window.__fsScene.getTransformNodeByName('player');p.position.x=b.x;p.position.z=b.z-b.d/2+1.2;})()`);await wait(`window.__fsScene.getMeshByName('home-roof').visibility<.03`);await sleep(3000);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:940,y:490,button:'none'});await sleep(500);await run('interior',false);
  await click('[aria-label="画面设置"]');
  const shadowLabel=await evaluate(`Array.from(document.querySelectorAll('[role="switch"]')).map(x=>x.getAttribute('aria-label')).find(x=>x?.includes('阴影'))`);assert(shadowLabel,'Real shadow setting found');
  if(await evaluate(`document.querySelector('[role="switch"][aria-label="${shadowLabel}"]').getAttribute('aria-checked')==='true'`))await click(`[role="switch"][aria-label="${shadowLabel}"]`);
  await click('[role="dialog"] .dialog-action');await focus();await evaluate(`window.__fsScene.whenReadyAsync()`);await sleep(2000);assert.equal(await evaluate(`window.__fsScene.shadowsEnabled`),false);await run('shadows-off',false);
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(consoleErrors.length,0,consoleErrors.join('\n'));
  const report={result:'passed',url,device,before,scenarios,screenshots,errors,consoleErrors,limits:'Single local Chrome/WebGL renderer, sparse completed-frame readPixels; regional tolerances 8/255 back and 12/255 global step. Not an exhaustive pixel sweep or cross-device GPU guarantee.'};
  await writeFile(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,scenarios:scenarios.map(({frames,materials,points,...summary})=>summary),reportPath}));
}catch(error){if(evaluate)try{if(await evaluate(`!!window.__fsProbe`)){const data=await evaluate(`(()=>{const p=window.__fsProbe;window.__fsScene.onAfterRenderObservable.remove(p.observer);return {points:p.points,materials:p.baseline,frames:p.frames};})()`);if(!scenarios.some(s=>s.frames.length===data.frames.length))scenarios.push({name:'failure-active-probe',...data});}const s=await call('Page.captureScreenshot',{format:'png'});await writeFile('.cache/flashlight-switch-failure.png',Buffer.from(s.data,'base64'));}catch{}await writeFile(reportPath,JSON.stringify({result:'failed',error:String(error),url,device,before,scenarios,screenshots,errors,consoleErrors},null,2));throw error;
}finally{if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});}
