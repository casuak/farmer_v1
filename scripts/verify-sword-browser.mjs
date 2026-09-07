// Real input and frame telemetry on the existing preview; no new game server.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177',profile=await mkdtemp(path.join(tmpdir(),'pinebrook-sword-'));
const browser=spawn(process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1440,900','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),pending=new Map(),errors=[];let ws,sequence=0,evaluate,call;
try{
  await mkdir('.cache',{recursive:true});let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert(port,'Chrome debugging endpoint opened');
  const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
  call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=15000)=>{const start=Date.now();while(Date.now()-start<timeout){const v=await evaluate(expression);if(v)return v;await sleep(12);}throw new Error('Timed out waiting: '+expression);};
  const key=async(key,down,code=key.length===1?'Key'+key.toUpperCase():key)=>call('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key,code,windowsVirtualKeyCode:key===' '?32:key.length===1?key.toUpperCase().charCodeAt(0):undefined});
  const tap=async(k,code)=>{await key(k,true,code);await key(k,false,code);};
  const focus=()=>evaluate(`document.querySelector('canvas').focus()`);
  const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile(`.cache/${name}.png`,Buffer.from(s.data,'base64'));};
  const blade=()=>evaluate(`JSON.parse(document.querySelector('canvas').dataset.swordBlade)`);
  const click=async(p,touch=false)=>{if(touch){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:0}]});await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});}};
  const idle=`document.querySelector('canvas').dataset.swordPhase==='idle'`;
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.__swordAudio=[];const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){window.__swordAudio.push({phase:document.querySelector('canvas')?.dataset.swordPhase,time:+document.querySelector('canvas')?.dataset.swordTime});return start.apply(this,args);};`});
  await call('Page.navigate',{url});await wait(`document.querySelector('canvas')?.dataset.renderStatus==='ready'`,60000);await tap('6','Digit6');await wait(`document.querySelector('canvas').dataset.selectedTool==='sword'`);await sleep(200);
  let b=await blade();assert(b.tip[1]-b.base[1]>.45);assert(b.tip[1]>1.3);await shot('sword-upward-guard');
  await evaluate(`window.__swordFrames=[];window.__recordSword=true;(()=>{function frame(){if(!window.__recordSword)return;const d=document.querySelector('canvas')?.dataset;if(d?.swordBlade)window.__swordFrames.push({phase:d.swordPhase,time:+d.swordTime,...JSON.parse(d.swordBlade)});if(window.__swordFrames.length>10000)window.__swordFrames.splice(0,5000);requestAnimationFrame(frame);}requestAnimationFrame(frame);})()`);
  // Walk and run with the raised guard; arm no longer swings the blade into the terrain.
  await focus();await tap('Shift');for(const k of ['d','s'])await key(k,true);await sleep(180);for(const k of ['d','s'])await key(k,false);await sleep(250);
  b=await blade();assert(b.tip[1]-b.base[1]>.4);await tap('Shift');for(const k of ['w','d'])await key(k,true);await sleep(200);for(const k of ['w','d'])await key(k,false);await sleep(400);
  b=await blade();assert(b.tip[1]-b.base[1]>.4);await shot('sword-running-guard');
  await evaluate(`window.__swordFrames=[];window.__swordAudio=[]`);await focus();await tap('f','KeyF');
  await wait(`document.querySelector('canvas').dataset.swordPhase==='windup'`);await shot('sword-windup');
  await wait(`document.querySelector('canvas').dataset.swordPhase==='cut'`);await shot('sword-cut');await wait(idle);await sleep(200);
  let frames=await evaluate('window.__swordFrames'),audio=await evaluate('window.__swordAudio');
  for(const phase of ['windup','cut','recover','idle'])assert(frames.some(f=>f.phase===phase),phase);
  assert(frames.some(f=>f.trail));assert(frames.filter(f=>f.phase==='windup').every(f=>!f.trail));assert(frames.filter(f=>f.time>.45).every(f=>!f.trail));
  assert(audio.some(a=>a.time>=.09&&a.time<.3),'Whoosh occurs in the cutting phase, not on the initial input');
  assert(frames.some(f=>f.torso<-.1)&&frames.some(f=>f.torso>.2),'Torso loads then rotates through');
  assert(frames.every(f=>f.tip[1]>.50),'Sword tip never hits the ground');b=await blade();assert.equal(b.torso,0);assert(b.tip[1]-b.base[1]>.45);await shot('sword-recovered');
  // Spam cannot restart the animation mid-cut.
  await evaluate(`window.__swordFrames=[]`);await click({x:870,y:430});await tap('f','KeyF');await tap('f','KeyF');await wait(idle);await sleep(150);
  frames=await evaluate('window.__swordFrames');let restarts=0;for(let i=1;i<frames.length;i++)if(frames[i].time+.05<frames[i-1].time)restarts++;assert(restarts<=1);
  // Unequipping or opening a panel during anticipation cancels the pending hit/afterimage.
  await focus();await tap('f','KeyF');await tap('5','Digit5');await wait(`document.querySelector('canvas').dataset.selectedTool==='pistol'&&document.querySelector('canvas').dataset.swordPhase==='idle'`);assert.equal(await evaluate(`document.querySelector('canvas').dataset.swordBlade`),undefined);
  await sleep(750);await tap('6','Digit6');await focus();await tap('f','KeyF');await evaluate(`document.querySelector('[aria-label="操作说明"]').click()`);await sleep(200);assert(await evaluate(idle));
  await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);await sleep(600);b=await blade();assert(b.tip[1]-b.base[1]>.45);
  // Real touch on mobile triggers the same cut and returns to the same guard.
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await sleep(300);
  await evaluate(`window.__swordFrames=[]`);await click({x:225,y:350},true);await wait(`document.querySelector('canvas').dataset.swordPhase==='cut'`);await shot('sword-mobile-cut');await wait(idle);await sleep(150);await shot('sword-mobile-guard');
  frames=await evaluate('window.__swordFrames');assert(frames.some(f=>f.trail));b=await blade();assert(b.tip[1]-b.base[1]>.45);
  await evaluate(`document.querySelector('[aria-label="画面设置"]').click()`);await sleep(150);await evaluate(`document.querySelector('[role="switch"][aria-label="春日动态"]').click()`);await wait(`document.querySelector('[role="switch"][aria-label="春日动态"]').getAttribute('aria-checked')==='false'`);await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);await sleep(550);
  await evaluate(`window.__swordFrames=[]`);await click({x:225,y:350},true);await wait(`document.querySelector('canvas').dataset.swordPhase==='cut'`);await wait(idle);frames=await evaluate('window.__swordFrames');assert(frames.every(f=>!f.trail));assert(frames.some(f=>f.phase==='recover'));
  assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({result:'passed',url,checks:'upward guard on idle/walk/run; windup/cut/recovery; actual blade trail; torso loading and follow-through; delayed whoosh; no ground contact; spam guard; switch/panel cancel; mobile touch; reduced motion; no runtime exceptions'}));
}catch(error){
  if(call){try{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile('.cache/sword-browser-failure.png',Buffer.from(s.data,'base64'));console.error('Sword state',await evaluate(`({canvas:{...document.querySelector('canvas')?.dataset},text:document.body.innerText})`));}catch{}}
  throw error;
}finally{if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});}
