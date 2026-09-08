// Real pointer/touch input against the existing preview. Never starts a server.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177',profile=await mkdtemp(path.join(tmpdir(),'pinebrook-inventory-drops-'));
const browser=spawn(process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1440,900','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),pending=new Map(),errors=[],failedImages=[];let ws,sequence=0,evaluate,call;
try{
  await mkdir('.cache',{recursive:true});let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert(port,'Chrome debugging endpoint opened');
  const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);else if(m.method==='Network.responseReceived'&&m.params.response.url.includes('/items/')&&m.params.response.status>=400)failedImages.push(m.params.response.url);};
  call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=15000)=>{const start=Date.now();while(Date.now()-start<timeout){const v=await evaluate(expression);if(v)return v;await sleep(20);}throw new Error('Timed out waiting: '+expression);};
  const point=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  const mouse=(type,p)=>call('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:type==='mouseMoved'?0:1});
  const click=async(selector,touch=false)=>{const p=await point(selector);if(touch){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:0}]});await sleep(80);await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await mouse('mousePressed',p);await mouse('mouseReleased',p);}};
  const tap=async k=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:'Key'+k.toUpperCase(),windowsVirtualKeyCode:k.toUpperCase().charCodeAt(0)});await call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code:'Key'+k.toUpperCase(),windowsVirtualKeyCode:k.toUpperCase().charCodeAt(0)});};
  const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile(`.cache/${name}.png`,Buffer.from(s.data,'base64'));};
  const seedSlot=()=>evaluate(`Number(document.querySelector('.pack-slot[data-item-id="seeds"]').dataset.inventorySlot)`);
  const seedCount=()=>evaluate(`Number(document.querySelector('.pack-slot[data-item-id="seeds"] .slot-count')?.textContent??0)`);
  const grounds=`JSON.parse(document.querySelector('canvas').dataset.groundItems)`;
  const drop=async(index,{touch=false,cancel=false,button=false}={})=>{
    const before=await evaluate(`${grounds}.map(i=>i.id)`);
    if(button){await click(`[data-inventory-slot="${index}"]`);await click('[data-drop-zone]');}
    else{
      const from=await point(`[data-inventory-slot="${index}"]`),to=await evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.left+r.width*.46,y:r.top+r.height*.39};})()`);
      if(touch)await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...from,id:0}]});else await mouse('mousePressed',from);
      for(let i=1;i<=5;i++){const p={x:from.x+(to.x-from.x)*i/5,y:from.y+(to.y-from.y)*i/5};if(touch)await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,id:0}]});else await mouse('mouseMoved',p);}
      await wait(`!!document.querySelector('.inventory-drag-ghost')`);
      if(touch)await call('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
      else if(cancel){await mouse('mouseMoved',await point('[aria-label="操作说明"]'));await mouse('mouseReleased',await point('[aria-label="操作说明"]'));}
      else await mouse('mouseReleased',to);
    }
    await wait(`!document.querySelector('.inventory-drag-ghost')`);
    if(cancel){assert.deepEqual(await evaluate(`${grounds}.map(i=>i.id)`),before);return null;}
    await wait(`document.querySelector('[data-inventory-slot="${index}"]').dataset.itemId===''`);
    return wait(`${grounds}.find(i=>!${JSON.stringify(before)}.includes(i.id))`);
  };
  const land=async id=>{await wait(`${grounds}.some(i=>i.id===${id}&&!i.airborne)`);await wait(`window.__dropFrames.some(f=>f.id===${id}&&!f.airborne)`);};
  const pickup=async touch=>{if(touch){await wait(`!document.querySelector('.interact-button').disabled&&document.querySelector('.interact-button').textContent.includes('种子')`);await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await click('.interact-button',true);}else{await evaluate(`document.querySelector('canvas').focus()`);await tap('e');}await wait(`!!document.querySelector('.pack-slot[data-item-id="seeds"]')`);assert.equal(await seedCount(),24);await wait(`document.querySelector('.pickup-layer').dataset.active==='0'`);};
  await call('Runtime.enable');await call('Network.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});await wait(`document.querySelector('canvas')?.dataset.renderStatus==='ready'`,60000);
  await evaluate(`(async()=>{const entry=performance.getEntriesByType('resource').find(e=>e.name.includes('/@babylonjs_core_Engines_engine.js'));if(!entry)throw Error('Requires existing Vite preview');const {Engine}=await import(entry.name);window.__dropScene=Engine.LastCreatedScene;window.__dropFrames=[];window.__observeDrops=true;function frame(){if(!window.__observeDrops)return;const scene=window.__dropScene,body=scene.getTransformNodeByName('body'),avatar=scene.getTransformNodeByName('player');for(const mesh of scene.meshes.filter(m=>m.metadata?.groundItemId)){window.__dropFrames.push({id:mesh.metadata.groundItemId,item:mesh.metadata.itemId,airborne:mesh.metadata.airborne,x:mesh.position.x,y:mesh.position.y,z:mesh.position.z,player:{x:avatar.position.x,y:avatar.position.y,z:avatar.position.z},yaw:body.rotation.y,bodyY:body.position.y});}if(window.__dropFrames.length>30000)window.__dropFrames.splice(0,10000);requestAnimationFrame(frame);}requestAnimationFrame(frame);})()`);
  await wait(`Array.from(document.querySelectorAll('.pickup-icon-library img')).length===23&&Array.from(document.querySelectorAll('.pickup-icon-library img')).every(i=>i.complete&&i.naturalWidth>0)`);
  // Mouse cancellation outside a valid drop area changes neither stack nor world.
  await drop(await seedSlot(),{cancel:true});assert.equal(await seedCount(),24);
  const first=await drop(await seedSlot());assert(first.airborne,'Real pointer drag creates an airborne pile');
  await evaluate(`document.querySelector('canvas').focus()`);await tap('e');assert.equal(await seedCount(),0,'E cannot award an airborne stack');
  await shot('inventory-drop-flight');await land(first.id);
  const frames=await evaluate(`window.__dropFrames.filter(f=>f.id===${first.id})`);assert(frames.length>4);
  const start=frames[0];assert(Math.hypot(start.x-start.player.x,start.z-start.player.z)<.35,'Drop starts at body X/Z');assert(start.y>start.player.y+.7,'Drop starts at chest height');assert(frames.some(f=>f.y>start.y+.05),'Visible upward pop');
  assert(frames.some(f=>!f.airborne));assert(Math.max(...frames.map(f=>f.y))>frames.at(-1).y+.4);
  const art=await evaluate(`(()=>{const m=window.__dropScene.meshes.find(m=>m.metadata?.groundItemId===${first.id}),t=m.material.diffuseTexture,img=document.querySelector('[data-pickup-icon="seeds"] img');return {texture:new URL(t.url,location.href).href,src:img.src,ready:t.isReady(),alpha:t.hasAlpha,billboard:m.billboardMode};})()`);
  assert.equal(art.texture,art.src);assert(art.ready&&art.alpha&&art.billboard);await shot('inventory-drop-landed');await pickup(false);
  // Drop same stack again via explicit UI button, then re-drop by pointer: new IDs and fresh arcs.
  const second=await drop(await seedSlot(),{button:true});assert(second.airborne);assert.notEqual(second.id,first.id);await land(second.id);await pickup(false);
  const third=await drop(await seedSlot());assert(third.airborne);assert.notEqual(third.id,second.id);
  await click('[aria-label="操作说明"]');await wait(`!!document.querySelector('[role="dialog"]')`);await sleep(100);
  const frozen=await evaluate(`window.__dropScene.meshes.find(m=>m.metadata?.groundItemId===${third.id})?.position.asArray()`);assert(frozen);assert(await evaluate(`window.__dropScene.meshes.find(m=>m.metadata?.groundItemId===${third.id})?.metadata.airborne`));
  await sleep(450);assert.deepEqual(await evaluate(`window.__dropScene.meshes.find(m=>m.metadata?.groundItemId===${third.id})?.position.asArray()`),frozen,'Pause freezes ground flight');
  await click('[role="dialog"] .dialog-action');await land(third.id);await pickup(false);
  // Two different drops coexist in flight, without merging/restarting the first.
  const a=await drop(0),b=await drop(2);assert.notEqual(a.id,b.id);assert(await evaluate(`${grounds}.filter(i=>[${a.id},${b.id}].includes(i.id)).length===2`));await land(a.id);await land(b.id);
  await evaluate(`document.querySelector('canvas').focus()`);await tap('e');await tap('e');await wait(`!${grounds}.some(i=>[${a.id},${b.id}].includes(i.id))`);await wait(`document.querySelector('.pickup-layer').dataset.active==='0'`);
  // Real touch pointer capture, cancel, and scene release on a narrow mobile viewport.
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await sleep(300);
  const mobile=await drop(await seedSlot(),{touch:true});assert(mobile.airborne);await shot('inventory-drop-mobile-flight');await land(mobile.id);await pickup(true);
  // Keep the injected OS-cancel case last: Chromium CDP touchCancel suppresses
  // the next synthetic tap's click, unlike the normal drag/drop sequence above.
  await drop(await seedSlot(),{touch:true,cancel:true});assert.equal(await seedCount(),24);
  const materials=await evaluate(`window.__dropScene.materials.filter(m=>m.name.startsWith('item-sprite-')).map(m=>{const id=m.name.slice('item-sprite-'.length),img=document.querySelector('[data-pickup-icon="'+id+'"] img'),t=m.diffuseTexture;return {id,ready:t.isReady(),texture:new URL(t.url,location.href).href,src:img.src};})`);
  assert(materials.length>=5);for(const m of materials){assert(m.ready,`${m.id} texture ready`);assert.equal(m.texture,m.src,`${m.id} inventory and ground use identical PNG`);}
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(failedImages.length,0,failedImages.join('\n'));
  console.log(JSON.stringify({result:'passed',url,checks:'real mouse scene drag; body-height upward pop; E blocked airborne; exact 24-stack return; new flight on repeated/button drops; pause/resume; independent drops; mouse cancellation; mobile touch drag/cancel; matching inventory/ground PNG URL and ready alpha billboard; all 23 icons loaded; no runtime exceptions',screenshots:['inventory-drop-flight','inventory-drop-landed','inventory-drop-mobile-flight']}));
}catch(error){
  if(call){try{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile('.cache/inventory-drop-browser-failure.png',Buffer.from(s.data,'base64'));console.error('Drop state',await evaluate(`({canvas:{...document.querySelector('canvas')?.dataset},text:document.body.innerText})`));}catch{}}
  throw error;
}finally{
  if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
