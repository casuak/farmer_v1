// Real Chromium/WebGL smoke test against the EXISTING preview; starts no game server.
// Usage: node scripts/verify-fishing-browser.mjs [http://127.0.0.1:5177]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,rm,writeFile,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177',profile=await mkdtemp(path.join(tmpdir(),'pinebrook-fishing-'));
const chrome=process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1440,900','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,sequence=0;const pending=new Map(),errors=[];
try{
  await mkdir('.cache',{recursive:true});
  const {readFile}=await import('node:fs/promises');let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert(port,'Chrome opened debugging endpoint');
  const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=20000)=>{const start=Date.now();while(Date.now()-start<timeout){const v=await evaluate(expression);if(v)return v;await sleep(35);}throw new Error('Timed out waiting: '+expression);};
  const key=async(key,down,code=key.length===1?'Key'+key.toUpperCase():key)=>call('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key,code,windowsVirtualKeyCode:key===' '?32:key.length===1?key.toUpperCase().charCodeAt(0):undefined});
  const space=down=>key(' ',down,'Space');
  const phase=name=>`document.querySelector('canvas')?.dataset.fishingPhase==='${name}'`;
  const noPanel=async()=>assert.equal(await evaluate(`document.querySelectorAll('.fishing-panel').length`),0,'No hint panel may obscure the water before hooking');
  const cancel=async()=>{await key('Escape',true);await key('Escape',false);await wait(phase('idle'));};
  const screenshot=async name=>{const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(`.cache/${name}.png`,Buffer.from(shot.data,'base64'));};
  const landPoint=async()=>evaluate(`document.querySelector('canvas').dataset.fishingSpot.split(',').map(Number)`);
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});await wait(`document.querySelector('.game-canvas')?.dataset.renderStatus==='ready'`,60000);
  assert.match(await evaluate(`document.querySelector('[data-inventory-slot="6"]').getAttribute('aria-label')`),/竹钓竿/);
  await key('7',true,'Digit7');await key('7',false,'Digit7');await noPanel();await screenshot('fishing-initial');
  // Walk east from the farm to the stream (camera-relative D+S = world +X).
  await evaluate(`document.querySelector('.game-canvas').focus()`);await key('d',true);await key('s',true);
  await wait(`Number(document.querySelector('canvas').dataset.playerX)>-8`,14000);
  await key('d',false);await key('s',false);await sleep(600);
  const player=await evaluate(`({x:Number(document.querySelector('canvas').dataset.playerX),z:Number(document.querySelector('canvas').dataset.playerZ)})`);
  console.log('River bank',player);
  // Pausing a held wind-up must not accidentally throw when focus/key capture is lost.
  await space(true);await wait(phase('charging'));await noPanel();
  await evaluate(`document.querySelector('[aria-label="操作说明"]').click()`);await wait(phase('idle'));await space(false);
  assert(await evaluate(`document.querySelector('.fishing-charge').hidden`),'Opening a dialog cancels the pending cast');
  await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);await sleep(100);await noPanel();
  await evaluate(`document.querySelector('.game-canvas').focus()`);
  // Short charge and full charge must produce genuinely different world positions.
  await space(true);await wait(phase('charging'));await wait(`Number(document.querySelector('.fishing-charge').dataset.power)>.17`);await space(false);await wait(phase('casting'));
  const low=await landPoint();await cancel();await noPanel();
  await space(true);await wait(phase('charging'));
  await wait(`Number(document.querySelector('.fishing-charge').dataset.power)>.9`);
  await wait(`Number(document.querySelector('.fishing-charge').dataset.power)<.25`);
  assert.equal(await evaluate(`document.querySelector('canvas').dataset.fishingPhase`),'charging','Holding through a whole oscillation never throws automatically');
  // A mouse release must not release an unrelated held Space gesture.
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:710,y:470,button:'left',clickCount:1});
  assert.equal(await evaluate(`document.querySelector('canvas').dataset.fishingPhase`),'charging');
  await wait(`Number(document.querySelector('.fishing-charge').dataset.power)>.75`);await screenshot('fishing-charging');
  await wait(`Number(document.querySelector('.fishing-charge').dataset.power)>.88`);await space(false);await wait(phase('casting'));
  const high=await landPoint(),lowDistance=Math.hypot(low[0]-player.x,low[1]-player.z),highDistance=Math.hypot(high[0]-player.x,high[1]-player.z);
  assert(highDistance>lowDistance+.7,`Stronger power throws farther: ${lowDistance} -> ${highDistance}`);
  await noPanel();await wait(phase('waiting'));await screenshot('fishing-waiting');
  assert(await evaluate(`document.querySelector('.fishing-charge').hidden&&document.querySelector('.fishing-water-bite').hidden`),'Only float and line remain while waiting');
  await space(true);await space(false);assert(await evaluate(phase('waiting')),'Early presses cannot skip the bite');
  await evaluate(`document.querySelector('[aria-label="操作说明"]').click()`);await sleep(650);assert(await evaluate(phase('waiting')));
  await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);
  await wait(`!document.querySelector('.fishing-water-bite').hidden`,10000);await noPanel();await screenshot('fishing-water-bite');
  await evaluate(`document.querySelector('.game-canvas').focus()`);await space(true);await wait(`document.querySelector('.fishing-panel')?.dataset.fishingPhase==='reeling'`);await space(false);
  assert(await evaluate(`document.querySelector('.fishing-water-bite').hidden`));await screenshot('fishing-reeling');
  // Only legitimate press/release input follows the rendered bar; no state is injected.
  let held=false;const start=Date.now();let caught=false;
  while(Date.now()-start<35000){
    const data=await evaluate(`(()=>{const phase=document.querySelector('canvas').dataset.fishingPhase;if(phase!=='reeling')return {phase};const f=document.querySelector('.fishing-fish-marker'),b=document.querySelector('.fishing-green-bar');return {phase,fish:parseFloat(f.style.bottom),bar:parseFloat(b.style.bottom)+parseFloat(b.style.height)/2};})()`);
    if(data.phase==='catching'){caught=true;break;}if(data.phase==='escaped'||data.phase==='idle')break;
    const next=data.fish>data.bar;if(next!==held){held=next;await space(held);}await sleep(35);
  }
  await space(false);assert(caught,'Tracking fish through real input succeeds');await screenshot('fishing-jump');
  await wait(`!document.querySelector('.fishing-catch-flight').hidden`,5000);await screenshot('fishing-flight');await wait(phase('idle'));await noPanel();
  const fishSlots=await evaluate(`Array.from(document.querySelectorAll('.pack-slot')).map(e=>e.getAttribute('aria-label')).filter(s=>/鲤鱼|河鲈/.test(s))`);
  assert.equal(fishSlots.length,1);assert.match(fishSlots[0],/×1/);await screenshot('fishing-inventory');
  // Real touch long-press on water charges; there is deliberately no pre-hook button/panel.
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await sleep(400);
  const scale=844/(26/1.4),dx=-4.5-player.x,dz=-1.4,water={x:195+(dx+dz)*Math.SQRT1_2*scale,y:422+(dx-dz)*.5*scale+.2*Math.SQRT1_2*scale};
  const touch=async(down,p=water)=>call('Input.dispatchTouchEvent',{type:down?'touchStart':'touchEnd',touchPoints:down?[{x:p.x,y:p.y,id:0}]:[]});
  const holdButton=()=>evaluate(`(()=>{const r=document.querySelector('.fishing-hold').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await noPanel();await screenshot('fishing-mobile');
  await touch(true);await wait(phase('charging'));await call('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await wait(phase('idle'));assert(await evaluate(`document.querySelector('.fishing-charge').hidden`),'Touch cancellation never fires the rod');
  await touch(true);await wait(phase('charging'));await wait(`Number(document.querySelector('.fishing-charge').dataset.power)>.5`);await screenshot('fishing-mobile-charging');await touch(false);
  await wait(phase('waiting'));await noPanel();await wait(`!document.querySelector('.fishing-water-bite').hidden`);await touch(true);await wait(`!!document.querySelector('.fishing-hold')`);await touch(false);
  await touch(true,await holdButton());await sleep(100);assert.equal(await evaluate(`document.querySelector('.fishing-hold').dataset.held`),'true');
  const raised=await evaluate(`parseFloat(document.querySelector('.fishing-green-bar').style.bottom)`);await touch(false);await sleep(150);
  assert.equal(await evaluate(`document.querySelector('.fishing-hold').dataset.held`),'false');assert((await evaluate(`parseFloat(document.querySelector('.fishing-green-bar').style.bottom)`))<raised);
  await screenshot('fishing-mobile-reeling');
  await evaluate(`document.querySelector('[aria-label="操作说明"]').click()`);await sleep(100);
  const frozen=await evaluate(`document.querySelector('.fishing-green-bar').style.bottom`);await sleep(500);assert.equal(await evaluate(`document.querySelector('.fishing-green-bar').style.bottom`),frozen);
  await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);
  for(const [width,height] of [[390,600],[800,450]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<640});await sleep(120);await screenshot(`fishing-${width}x${height}`);
    const b=await evaluate(`(()=>{const p=document.querySelector('.fishing-panel').getBoundingClientRect(),i=document.querySelector('.inventory-dock').getBoundingClientRect();return {left:p.left,right:p.right,bottom:p.bottom,inventoryTop:i.top,inventoryLeft:i.left,inventoryRight:i.right};})()`);
    assert(b.left>=0&&b.right<=width&&(b.bottom<b.inventoryTop||b.left>=b.inventoryRight||b.right<=b.inventoryLeft),`${width}x${height} layout: ${JSON.stringify(b)}`);
  }
  await evaluate(`document.querySelector('.fishing-cancel').click()`);await wait(phase('idle'));await noPanel();
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.pack-slot')).map(e=>e.getAttribute('aria-label')).filter(s=>/鲤鱼|河鲈/.test(s)).join()`),fishSlots.join(),'Cancelling gives no extra fish');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({result:'passed',url,fishSlots,lowDistance,highDistance,checks:'no pre-hook panel; hold/oscillate/release casting; stronger power lands farther; pause cancels wind-up; input-source isolation; water exclamation -> Space fight; original catch flight; touch charge/hook/reel; responsive layouts; no runtime exceptions'}));
}finally{
  if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);
  browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
