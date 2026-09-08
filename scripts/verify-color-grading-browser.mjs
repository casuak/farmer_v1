// Chromium/WebGL regression against the EXISTING Vite preview; starts no game server.
// Usage: node scripts/verify-color-grading-browser.mjs [http://127.0.0.1:5177]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,readFile,writeFile,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177',profile=await mkdtemp(path.join(tmpdir(),'pinebrook-color-'));
const browser=spawn(process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding',...(process.env.CHROME_SOFTWARE_GL?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]),'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,sequence=0;const pending=new Map(),errors=[],screenshots=[];
try{
  await mkdir('.cache',{recursive:true});let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert(port,'Chrome opened its debugging endpoint');
  const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);else if(m.method==='Runtime.consoleAPICalled'&&['warning','error'].includes(m.params.type))console.log('Browser '+m.params.type+':',m.params.args.map(a=>a.value??a.description).join(' '));};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=20000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await evaluate(expression);if(value)return value;await sleep(50);}throw new Error('Timed out waiting: '+expression);};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const open=()=>click('[aria-label="画面设置"]');
  const close=async()=>{await click('[role="dialog"] .dialog-action');await wait(`!document.querySelector('[role="dialog"]')`);};
  const filter=()=>evaluate(`getComputedStyle(document.querySelector('.game-canvas')).filter`);
  const numbers=value=>[...value.matchAll(/\(([\d.]+)\)/g)].map(m=>Number(m[1]));
  const preset=async(label,hour)=>{await open();await evaluate(`Array.from(document.querySelectorAll('.time-presets button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);await wait(`Number(document.querySelector('canvas').dataset.gameHour)===${hour}`);await close();};
  const screenshot=async name=>{const shot=await call('Page.captureScreenshot',{format:'png'}),file=`.cache/color-grading-${name}.png`;await writeFile(file,Buffer.from(shot.data,'base64'));screenshots.push(file);return shot.data;};
  const key=(key,down)=>call('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key,code:'Key'+key.toUpperCase(),windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0)});
  const walk=async(keys,condition)=>{await evaluate(`document.querySelector('.game-canvas').focus()`);try{for(const k of keys)await key(k,true);await wait(condition,15000);}finally{for(const k of keys)await key(k,false);}await sleep(700);};
  const checkHud=async()=>assert(await evaluate(`['.farm','.hud.brand','.hud.calendar','.inventory-dock','.vignette'].every(s=>{let e=document.querySelector(s);if(!e)return false;for(;e;e=e.parentElement)if(getComputedStyle(e).filter!=='none')return false;return true;})`),'Scene grading does not filter HUD elements or their ancestors');
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:2048,height:1083,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});await wait(`document.querySelector('.game-canvas')?.dataset.renderStatus==='ready'`,60000);
  const initialMode=await evaluate(`document.querySelector('canvas').dataset.renderMode`);
  assert(['standard','compatible'].includes(initialMode),'The device must produce a verified visible frame');
  console.log('Initial renderer:',initialMode);
  assert.deepEqual(numbers(await filter()),[1.22,1.1,.98],'Spring grading is enabled by default');await checkHud();
  await click('[aria-label="暂停时间"]');await open();
  for(const label of ['春日动态','背景音乐','游戏音效'])await click(`[role="dialog"] [aria-label="${label}"]`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="春日色彩滤镜"]').getAttribute('aria-checked')`),'true');await close();
  await walk(['w','d'],`Number(document.querySelector('canvas').dataset.playerZ)>-20.1`);
  await walk(['d','s'],`Number(document.querySelector('canvas').dataset.playerX)>-4.2`);
  await preset('正午',12);
  // Hold the same rendered scene while comparing final composited pixels. Engine
  // access is test-only, via the preview's already-loaded module, not a game API.
  await evaluate(`(async()=>{const entry=performance.getEntriesByType('resource').find(e=>e.name.includes('/@babylonjs_core_Engines_engine.js'));if(!entry)throw Error('This test needs the existing Vite preview');const {Engine}=await import(entry.name);window.__colorScene=Engine.LastCreatedScene;window.__colorEngine=window.__colorScene.getEngine();window.__colorLoops=[...window.__colorEngine._activeRenderLoops];})()`);
  await sleep(350);await evaluate(`window.__colorEngine.stopRenderLoop()`);
  const rich=await screenshot('bridge-day');
  await open();await click('[aria-label="春日色彩滤镜"]');await close();assert.equal(await filter(),'none');
  const original=await screenshot('bridge-original');
  const measure=async data=>evaluate(`(async()=>{const img=new Image();img.src='data:image/png;base64,${data}';await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const p=ctx.getImageData(320,260,1400,580).data;let saturation=0,light=0,black=0,clipped=0;for(let i=0;i<p.length;i+=4){const hi=Math.max(p[i],p[i+1],p[i+2]),lo=Math.min(p[i],p[i+1],p[i+2]);saturation+=hi?(hi-lo)/hi:0;light+=p[i]*.2126+p[i+1]*.7152+p[i+2]*.0722;if(hi<8)black++;if(lo>250)clipped++;}const n=p.length/4;return {saturation:saturation/n,luma:light/n,black:black/n,clipped:clipped/n};})()`);
  const before=await measure(original),after=await measure(rich);
  assert(after.saturation>before.saturation*1.10,`Visible color gains saturation: ${JSON.stringify({before,after})}`);
  assert(after.luma>before.luma*.90&&after.luma<before.luma*1.05,'The grade does not simply darken or overexpose the scene');
  assert(after.black<.015&&after.clipped<.01,'Shadows and pale surfaces keep detail');
  await open();await click('[aria-label="春日色彩滤镜"]');await close();assert.deepEqual(numbers(await filter()),[1.22,1.1,.98]);
  await evaluate(`for(const loop of window.__colorLoops)window.__colorEngine.runRenderLoop(loop)`);
  await preset('夜晚',22);assert.deepEqual(numbers(await filter()),[1.08,1.02,1]);await screenshot('bridge-night');await checkHud();
  await preset('清晨',6.5);const dawn=numbers(await filter());assert(dawn[0]>1.08&&dawn[0]<1.22);await screenshot('bridge-dawn');
  await preset('黄昏',18);const dusk=numbers(await filter());assert(dusk[0]>1.08&&dusk[0]<1.22);await screenshot('bridge-dusk');
  await preset('正午',12);
  const standard=await evaluate(`document.querySelector('canvas').dataset.renderMode==='standard'`);
  if(standard){
    await open();await click('[aria-label="高光柔晕"]');await close();
    await wait(`document.querySelector('canvas').dataset.bloomEnabled==='false'`);assert.deepEqual(numbers(await filter()),[1.22,1.1,.98]);await screenshot('bridge-no-bloom');
    // Inject invalid readbacks only until the REAL RenderGuard recovers. Its direct
    // renderer then reads genuine pixels; no production hooks or settings are added.
    await evaluate(`window.__colorReadPixels=window.__colorEngine.readPixels;window.__colorEngine.readPixels=function(...args){return window.__colorScene.postProcessesEnabled?Promise.resolve(new Uint8Array([0,0,0,255])):window.__colorReadPixels.apply(this,args);}`);
    await open();await click('[aria-label="高光柔晕"]');await close();
    await wait(`document.querySelector('canvas').dataset.renderMode==='compatible'`);
    await sleep(1000);await evaluate(`window.__colorEngine.readPixels=window.__colorReadPixels`);
  }else{
    // Some headless GPUs already take the real recovery route during startup.
    // Verify that route without pretending to exercise unsupported bloom passes.
    await open();assert(await evaluate(`document.querySelector('[aria-label="高光柔晕"]').disabled`));await close();
    console.log('SKIP GPU bloom toggle/injected recovery: this device already recovered during startup.');
  }
  await wait(`document.querySelector('canvas').dataset.bloomEnabled==='false'`);
  assert.equal(await evaluate(`document.querySelector('canvas').dataset.renderStatus`),'ready');
  assert(await evaluate(`!window.__colorScene.postProcessesEnabled&&!window.__colorScene.imageProcessingConfiguration.applyByPostProcess`));
  assert.deepEqual(numbers(await filter()),[1.22,1.1,.98]);await screenshot('bridge-compatible');
  await preset('夜晚',22);assert.deepEqual(numbers(await filter()),[1.08,1.02,1]);await screenshot('bridge-compatible-night');
  await preset('正午',12);await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(500);await checkHud();await screenshot('mobile');
  await open();await click('[aria-label="春日色彩滤镜"]');assert.equal(await filter(),'none');await click('[aria-label="春日色彩滤镜"]');await close();
  assert.deepEqual(numbers(await filter()),[1.22,1.1,.98]);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({result:'passed',url,initialMode,bloomToggleAndInjectedRecovery:standard?'passed':'skipped: device recovered at startup',before,after,dawn,dusk,screenshots,checks:'default filter, original-color switch, unfiltered HUD, identical-frame pixel comparison, river/bridge, day/dawn/dusk/night, direct-render output, mobile toggle and no runtime exceptions'}));
}finally{
  if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);
  browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
