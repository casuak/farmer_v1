// Real Chromium/WebGL input on the existing preview; never starts a game server.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177',profile=await mkdtemp(path.join(tmpdir(),'pinebrook-flashlight-'));
const browser=spawn(process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1440,900','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),pending=new Map(),errors=[],screenshots=[];let ws,sequence=0,call,evaluate;
try{
  await mkdir('.cache',{recursive:true});let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert(port,'Chrome debugging endpoint opened');
  const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')console.error('Browser console:',m.params.args.map(a=>a.value??a.description).join(' '));};
  call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=15000)=>{const start=Date.now();while(Date.now()-start<timeout){const v=await evaluate(expression);if(v)return v;await sleep(30);}throw new Error('Timed out waiting: '+expression);};
  const point=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  const click=async(selector,touch=false)=>{const p=await point(selector);if(touch){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:0}]});await sleep(80);await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});}};
  const tap=async key=>{const code=/^[0-9]$/.test(key)?'Digit'+key:key.length===1?'Key'+key.toUpperCase():key;for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:key.length===1?key.toUpperCase().charCodeAt(0):undefined});};
  const focus=()=>evaluate(`document.querySelector('canvas').focus()`);
  const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png'}),file=`.cache/flashlight-${name}.png`;await writeFile(file,Buffer.from(s.data,'base64'));screenshots.push(file);return s.data;};
  const light=`window.__flashScene.getLightByName('held-flashlight')`;
  const state=()=>evaluate(`(()=>{const l=${light};return {enabled:document.querySelector('canvas').dataset.flashlightEnabled==='true',lightEnabled:l.isEnabled(),position:l.position.asArray(),direction:l.direction.asArray(),range:l.range,intensity:l.intensity};})()`);
  // Logical equipped/emitting state is distinct from the permanently enabled shader light.
  const on=()=>wait(`document.querySelector('canvas').dataset.flashlightEnabled==='true'&&${light}.isEnabled()&&${light}.intensity>3`),off=()=>wait(`document.querySelector('canvas').dataset.flashlightEnabled==='false'&&${light}.isEnabled()&&${light}.intensity===0`);
  const close=async()=>{await click('[role="dialog"] .dialog-action');await wait(`!document.querySelector('[role="dialog"]')`);};
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});await wait(`document.querySelector('canvas')?.dataset.renderStatus==='ready'`,60000);
  await evaluate(`(async()=>{const e=performance.getEntriesByType('resource').find(e=>e.name.includes('/@babylonjs_core_Engines_engine.js'));if(!e)throw Error('Requires the existing Vite preview');const {Engine}=await import(e.name);window.__flashScene=Engine.LastCreatedScene;window.__flashEngine=window.__flashScene.getEngine();})()`);
  assert.equal(await evaluate(`document.querySelector('[data-inventory-slot="8"]').dataset.itemId`),'flashlight');await off();
  await focus();await tap('9');await on();const initial=await state();assert(initial.intensity>0&&initial.range>=6);
  const shadow=await evaluate(`(()=>{const l=${light},s=l.getShadowGenerator(),map=s?.getShadowMap();return {type:l.getClassName(),size:map?.getSize().width,casters:map?.renderList.map(m=>m.name),mapReady:!!map,priority:l.renderPriority};})()`);
  assert.equal(shadow.type,'SpotLight');assert(shadow.mapReady&&shadow.size>0&&shadow.size<=512);assert(shadow.casters.length>0&&shadow.casters.length<=24);assert(shadow.casters.some(n=>n.endsWith('-walls')),'Nearby real walls are shadow casters');assert(shadow.priority>0);
  const move=async(x,y)=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none'});await sleep(450);};
  await move(930,430);const right=await state();await move(400,430);const left=await state();
  assert(Math.hypot(...left.direction.map((v,i)=>v-right.direction[i]))>.7,'Mouse aiming changes the actual spotlight direction');assert(left.direction[1]<0,'Beam points slightly down onto the ground');
  await focus();await tap('1');await off();await tap('9');await on();
  // Set midnight through the actual accessible slider and freeze only the clock.
  await click('[aria-label="暂停时间"]');await evaluate(`document.querySelector('[aria-label="当前游戏时刻"] [role="slider"]').focus()`);await tap('Home');await wait(`Number(document.querySelector('canvas').dataset.gameHour)===0`);
  await click('[aria-label="画面设置"]');
  for(const label of ['春日动态','背景音乐','游戏音效'])if(await evaluate(`document.querySelector('[role="switch"][aria-label="${label}"]').getAttribute('aria-checked')==='true'`))await click(`[role="switch"][aria-label="${label}"]`);
  await close();await focus();await tap('9');await move(940,490);await on();await sleep(500);
  // Keep the real render loop, stationary avatar, frozen clock and motion off.
  // Sample ground away from the held mesh; real inventory keys control the light.
  await evaluate(`window.__flashPoints=(()=>{const s=window.__flashScene,l=${light},V=l.position.constructor,M=s.getTransformMatrix().constructor,canvas=document.querySelector('canvas').getBoundingClientRect(),vp=s.activeCamera.viewport.toGlobal(canvas.width,canvas.height),d=l.direction.clone();d.y=0;d.normalize();const out=[];for(const sign of [1,-1])for(const distance of [2.3,3.2,4.1,5]){const p=l.position.add(d.scale(sign*distance));p.y=.03;const screen=V.Project(p,M.Identity(),s.getTransformMatrix(),vp);out.push({side:sign===1?'front':'back',x:screen.x+canvas.left,y:screen.y+canvas.top});}return out;})();`);
  // Runtime owns intensity (including its warm-up/fade); never overwrite it in a probe.
  const render=async enabled=>{await focus();await tap(enabled?'9':'1');await (enabled?on():off());await evaluate(`window.__flashScene.whenReadyAsync()`);await sleep(500);};
  await render(false);const dark=await shot('midnight-off');await render(true);const bright=await shot('midnight-on');
  const measure=async data=>evaluate(`(async()=>{const img=new Image();img.src='data:image/png;base64,${data}';await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return window.__flashPoints.map(p=>{const x=Math.round(p.x)-9,y=Math.round(p.y)-9;if(x<0||y<0||x+18>c.width||y+18>c.height)throw Error('Projected sample outside screenshot');const pixels=ctx.getImageData(x,y,18,18).data;let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722;return {...p,luma:sum/(pixels.length/4)};});})()`);
  const before=await measure(dark),after=await measure(bright),deltas=after.map((p,i)=>({...p,gain:p.luma-before[i].luma}));
  const front=deltas.filter(p=>p.side==='front'),back=deltas.filter(p=>p.side==='back'),frontGain=front.reduce((n,p)=>n+p.gain,0)/front.length,backGain=back.reduce((n,p)=>n+Math.abs(p.gain),0)/back.length;
  assert(frontGain>4,`Spotlight measurably illuminates the forward ground: ${JSON.stringify(deltas)}`);assert(frontGain>backGain*2+2,`Directional beam, not global exposure: ${JSON.stringify({frontGain,backGain})}`);
  // Pause/resume leaves the beam stable rather than blinking or losing its heading.
  await click('[aria-label="操作说明"]');await sleep(180);const frozen=await state();assert(frozen.enabled);await sleep(350);assert.deepEqual(await state(),frozen);await close();await on();
  // Real inventory drop switches off the equipped light and uses the same PNG.
  await click('[data-drop-zone]');await off();const dropped=await wait(`JSON.parse(document.querySelector('canvas').dataset.groundItems).find(i=>i.item==='flashlight')`);assert.equal(dropped.count,1);assert(dropped.airborne);assert.equal(await evaluate(`document.querySelector('[data-inventory-slot="8"]').dataset.itemId`),'');
  await wait(`JSON.parse(document.querySelector('canvas').dataset.groundItems).some(i=>i.id===${dropped.id}&&!i.airborne)`);
  const texture=await evaluate(`(()=>{const m=window.__flashScene.meshes.find(m=>m.metadata?.groundItemId===${dropped.id}),t=m.material.diffuseTexture,img=document.querySelector('[data-pickup-icon="flashlight"] img');return {ready:t.isReady(),url:new URL(t.url,location.href).href,src:img.src};})()`);assert(texture.ready);assert.equal(texture.url,texture.src);await shot('dropped');
  await focus();await tap('e');await wait(`!!document.querySelector('.pack-slot[data-item-id="flashlight"]')`);await wait(`document.querySelector('.pickup-layer').dataset.active==='0'`);await click('.pack-slot[data-item-id="flashlight"]');await on();
  // Real responsive slot selection and touch direction controls: light follows
  // the walking avatar, not the previous desktop mouse target.
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await sleep(300);
  await click('[data-inventory-slot="0"]',true);await off();await click('.pack-slot[data-item-id="flashlight"]',true);await on();
  const hold=async selector=>{const p=await point(selector);await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:0}]});await sleep(360);await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(180);return state();};
  const up=await hold('[aria-label="向上走"]'),side=await hold('[aria-label="向右走"]');assert(up.enabled&&side.enabled);assert(Math.hypot(...up.direction.map((v,i)=>v-side.direction[i]))>.5,'Mobile movement turns the spotlight');
  const follow=await evaluate(`(()=>{const p=window.__flashScene.getTransformNodeByName('player').position,l=${light};return {distance:Math.hypot(p.x-l.position.x,p.z-l.position.z),y:l.position.y-p.y};})()`);assert(follow.distance<1.5&&follow.y>0&&follow.y<2);await shot('mobile');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({result:'passed',url,frontGain,backGain,shadow,screenshots,checks:'slot9 enable/slot1 disable; mouse aim; midnight real forward pixel brightening; stable pause; bounded real wall shadows; drop disables and matching PNG; E once-only pickup; reselect; mobile touch selection and heading/follow; no runtime exceptions'}));
}catch(error){if(call)try{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile('.cache/flashlight-failure.png',Buffer.from(s.data,'base64'));console.error('Flashlight state',await evaluate(`({canvas:{...document.querySelector('canvas')?.dataset},text:document.body.innerText,meshes:window.__flashScene?.meshes.filter(m=>m.name.includes('terrain')||m.name==='farmer-torso'||m.name.includes('roof')).slice(0,15).map(m=>({name:m.name,enabled:m.isEnabled(),visibility:m.visibility,visible:m.isVisible,vertices:m.getTotalVertices(),ready:m.isReady(),material:m.material?.name,position:m.position.asArray()}))})`));}catch{}throw error;
}finally{if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});}
