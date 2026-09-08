// Real input on the existing game preview; never starts a replacement server.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177',profile=await mkdtemp(path.join(tmpdir(),'pinebrook-pickups-'));
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
  const wait=async(expression,timeout=15000)=>{const start=Date.now();while(Date.now()-start<timeout){const v=await evaluate(expression);if(v)return v;await sleep(20);}throw new Error('Timed out waiting: '+expression);};
  const key=async(key,down,code=key.length===1?'Key'+key.toUpperCase():key)=>call('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key,code,windowsVirtualKeyCode:key.length===1?key.toUpperCase().charCodeAt(0):undefined});
  const tap=async(k,code)=>{await key(k,true,code);await key(k,false,code);};
  const focus=()=>evaluate(`document.querySelector('canvas').focus()`);
  const click=async(selector,touch=false)=>{
    const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    if(touch){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:0}]});await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    else{await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});}
  };
  const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile(`.cache/${name}.png`,Buffer.from(s.data,'base64'));};
  const drop=async(index,touch=false)=>{const previous=await evaluate(`JSON.parse(document.querySelector('canvas').dataset.groundItems).map(i=>i.id)`);await click(`[data-inventory-slot="${index}"]`,touch);await wait(`document.querySelector('[data-inventory-slot="${index}"]').getAttribute('aria-pressed')==='true'`);await click('[data-drop-zone]',touch);await wait(`document.querySelector('[data-inventory-slot="${index}"]').dataset.itemId===''`);await wait(`JSON.parse(document.querySelector('canvas').dataset.groundItems).some(i=>!${JSON.stringify(previous)}.includes(i.id)&&!i.airborne)`);};
  const idle=`document.querySelector('.pickup-layer').dataset.active==='0'`;
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});await wait(`document.querySelector('canvas')?.dataset.renderStatus==='ready'`,60000);
  assert.equal(await evaluate(`document.querySelectorAll('.pickup-layer').length`),1);assert.equal(await evaluate(`document.querySelectorAll('.pickup-flight').length`),24);
  await evaluate(`window.__pickupFrames=[];window.__pickupGlows=[];window.__observePickups=true;(()=>{function frame(){if(!window.__observePickups)return;const host=document.querySelector('.farm').getBoundingClientRect();for(const f of document.querySelectorAll('.pickup-flight:not([hidden])')){const r=f.getBoundingClientRect();window.__pickupFrames.push({serial:+f.dataset.serial,id:f.dataset.itemId,count:+f.dataset.count,slot:+f.dataset.slot,stage:f.dataset.stage,u:+f.dataset.progress,x:r.left+r.width/2-host.left,y:r.top+r.height/2-host.top,tx:+f.dataset.targetX,ty:+f.dataset.targetY});}for(const s of document.querySelectorAll('[data-pickup-received=true]'))window.__pickupGlows.push(+s.dataset.inventorySlot);if(window.__pickupFrames.length>10000)window.__pickupFrames.splice(0,5000);requestAnimationFrame(frame);}requestAnimationFrame(frame);})()`);
  // Dropped seed stack reuses the real inventory art, with an exact once award.
  await drop(1);await focus();await tap('e');await wait(`document.querySelector('.pickup-flight:not([hidden])')?.dataset.itemId==='seeds'`);
  assert.equal(await evaluate(`document.querySelector('.pickup-flight:not([hidden]) .pickup-flight-count').textContent`),'+24');
  await wait(`Array.from(document.querySelectorAll('.pickup-flight:not([hidden])')).some(f=>+f.dataset.progress>.2)`);await shot('pickup-flight');
  await wait(idle);assert.match(await evaluate(`document.querySelector('[data-inventory-slot="1"]').getAttribute('aria-label')`),/种子 ×24/);
  let frames=await evaluate(`window.__pickupFrames.filter(f=>f.serial===1)`);assert(frames.length>5);assert(frames.some(f=>f.stage==='lift'));assert(frames.some(f=>f.stage==='fly'));
  assert(Math.min(...frames.filter(f=>f.u>.8).map(f=>Math.hypot(f.x-f.tx,f.y-f.ty)))<14,'Item visually reaches its actual destination');
  assert((await evaluate('window.__pickupGlows')).includes(1));
  const serial=await evaluate(`document.querySelector('.pickup-layer').dataset.total`);await tap('e');await sleep(100);assert.equal(await evaluate(`document.querySelector('.pickup-layer').dataset.total`),serial,'Repeated pickup cannot replay a missing item');
  // Inventory rearrangement during a flight follows the moved item, without blocking input.
  await drop(1);await focus();await tap('e');await wait(`document.querySelector('.pickup-layer').dataset.active==='1'`);
  await evaluate(`document.querySelector('[data-inventory-slot="1"]').click();document.querySelector('.pack-actions button').click()`);
  await wait(`document.querySelector('.pack-actions button').getAttribute('aria-pressed')==='true'`);
  await evaluate(`document.querySelector('[data-inventory-slot="8"]').click()`);await wait(`document.querySelector('[data-inventory-slot="8"]').dataset.itemId==='seeds'`);await wait(idle);
  assert((await evaluate('window.__pickupGlows')).includes(8),'Retargeted destination glows');
  // Pause does not finish or lose a flight; resume continues it.
  await drop(8);await focus();await tap('e');await wait(`document.querySelector('.pickup-layer').dataset.active==='1'`);
  await evaluate(`document.querySelector('[aria-label="操作说明"]').click()`);await sleep(120);
  const frozen=await evaluate(`Array.from(document.querySelectorAll('.pickup-flight:not([hidden])')).map(f=>({transform:f.style.transform,u:f.dataset.progress}))`);assert.equal(frozen.length,1);
  await sleep(350);assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.pickup-flight:not([hidden])')).map(f=>({transform:f.style.transform,u:f.dataset.progress}))`),frozen);
  await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);await wait(idle);await sleep(400);
  // Multiple independent ground items animate concurrently from rapid real E presses.
  await drop(0);await drop(2);await focus();await tap('e');await tap('e');await wait(`Number(document.querySelector('.pickup-layer').dataset.active)>=2`);
  assert.equal(await evaluate(`document.querySelectorAll('.pickup-flight').length`),24);await shot('pickup-multiple');await wait(idle);
  // Touch-only pickup on a 390 px screen, with real responsive slot bounds.
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await sleep(300);
  const seedSlot=await evaluate(`document.querySelector('.pack-slot[data-item-id="seeds"]').dataset.inventorySlot`);await drop(Number(seedSlot),true);
  const mobileSerial=Number(await evaluate(`document.querySelector('.pickup-layer').dataset.total`))+1;
  await click('.interact-button',true);await wait(`document.querySelector('.pickup-layer').dataset.active==='1'`);await sleep(220);await shot('pickup-mobile');await wait(idle);
  frames=await evaluate(`window.__pickupFrames.filter(f=>f.serial===${mobileSerial})`);assert(frames.length>3);assert(frames.every(f=>f.tx>0&&f.tx<390&&f.ty>0&&f.ty<844));
  assert(Math.min(...frames.filter(f=>f.u>.8).map(f=>Math.hypot(f.x-f.tx,f.y-f.ty)))<14,'Mobile flight lands on the visible slot');
  // In-game reduced-motion setting replaces the long sweep with local fade + slot feedback.
  await click('[aria-label="画面设置"]',true);await wait(`!!document.querySelector('[role="dialog"]')`);await evaluate(`document.querySelector('[role="switch"][aria-label="春日动态"]').scrollIntoView({block:'center'})`);await sleep(300);await click('[role="switch"][aria-label="春日动态"]',true);
  await wait(`document.querySelector('[role="switch"][aria-label="春日动态"]').getAttribute('aria-checked')==='false'`);await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);await sleep(500);
  const nextSeed=Number(await evaluate(`document.querySelector('.pack-slot[data-item-id="seeds"]').dataset.inventorySlot`));await drop(nextSeed,true);
  const reducedSerial=Number(await evaluate(`document.querySelector('.pickup-layer').dataset.total`))+1;await click('.interact-button',true);await wait(idle);await sleep(100);
  frames=await evaluate(`window.__pickupFrames.filter(f=>f.serial===${reducedSerial})`);assert(frames.length>0&&frames.every(f=>f.stage==='fade'));assert(Math.max(...frames.map(f=>f.x))-Math.min(...frames.map(f=>f.x))<1);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.pickup-layer')).pointerEvents`),'none');assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({result:'passed',url,checks:'real drop/E/touch pickup; matching icon and count; exact slot arrival and glow; no duplicate loot; live retarget; pause/resume; concurrent flights; 390px mobile; reduced motion; fixed 24-node pool; no runtime exceptions',flights:await evaluate(`document.querySelector('.pickup-layer').dataset.total`)}));
}catch(error){
  if(call){try{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile('.cache/pickup-browser-failure.png',Buffer.from(s.data,'base64'));console.error('Pickup state',await evaluate(`({canvas:{...document.querySelector('canvas')?.dataset},layer:{...document.querySelector('.pickup-layer')?.dataset},text:document.body.innerText})`));}catch{}}
  throw error;
}finally{
  if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
