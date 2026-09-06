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
  const wait=async(expression,timeout=20000)=>{const start=Date.now();while(Date.now()-start<timeout){const v=await evaluate(expression);if(v)return v;await sleep(60);}throw new Error('Timed out waiting: '+expression);};
  const key=async(key,down,code=key.length===1?'Key'+key.toUpperCase():key)=>call('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key,code,windowsVirtualKeyCode:key===' '?32:key.length===1?key.toUpperCase().charCodeAt(0):undefined});
  const click=async(x,y)=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});};
  const screenshot=async name=>{const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(`.cache/${name}.png`,Buffer.from(shot.data,'base64'));};
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});await wait(`document.querySelector('.game-canvas')?.dataset.renderStatus==='ready'`,60000);
  assert.match(await evaluate(`document.querySelector('[data-inventory-slot="6"]').getAttribute('aria-label')`),/竹钓竿/);
  await key('7',true,'Digit7');await key('7',false,'Digit7');await wait(`!!document.querySelector('.fishing-panel')`);
  await screenshot('fishing-initial');
  // Walk east from the farm to the stream (camera-relative D+S = world +X).
  await evaluate(`document.querySelector('.game-canvas').focus()`);
  await key('d',true);await key('s',true);
  await wait(`Number(document.querySelector('canvas').dataset.playerX)>-8`,14000);
  await key('d',false);await key('s',false);await sleep(800);
  const player=await evaluate(`({x:Number(document.querySelector('canvas').dataset.playerX),z:Number(document.querySelector('canvas').dataset.playerZ)})`);
  console.log('River bank',player);
  const target={x:-4.5,z:player.z},scale=900/(2*15.8/1.4),dx=target.x-player.x,dz=target.z-(player.z+1.4);
  const pointer={x:720+(dx+dz)*Math.SQRT1_2*scale,y:450+(dx-dz)*.5*scale+.2*Math.SQRT1_2*scale};
  await click(pointer.x,pointer.y);
  await wait(`document.querySelector('.fishing-panel')?.dataset.fishingPhase==='waiting'`);
  await screenshot('fishing-waiting');
  // Opening the help modal must freeze waiting, and close must resume, not reset.
  await evaluate(`document.querySelector('[aria-label="操作说明"]').click()`);await sleep(700);
  assert.equal(await evaluate(`document.querySelector('.fishing-panel').dataset.fishingPhase`),'waiting');
  await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);
  await wait(`document.querySelector('.fishing-panel')?.dataset.fishingPhase==='bite'`,10000);
  await key(' ',true,'Space');await wait(`document.querySelector('.fishing-panel')?.dataset.fishingPhase==='reeling'`);await key(' ',false,'Space');
  await screenshot('fishing-reeling');
  // Only legitimate press/release input follows the rendered bar; no catch state is injected.
  let held=false;const start=Date.now();let caught=false;
  while(Date.now()-start<35000){
    const data=await evaluate(`(()=>{const panel=document.querySelector('.fishing-panel');if(panel.dataset.fishingPhase!=='reeling')return {phase:panel.dataset.fishingPhase};const f=document.querySelector('.fishing-fish-marker'),b=document.querySelector('.fishing-green-bar');return {phase:'reeling',fish:parseFloat(f.style.bottom),bar:parseFloat(b.style.bottom)+parseFloat(b.style.height)/2};})()`);
    if(data.phase==='catching'){caught=true;break;}if(data.phase==='escaped'||data.phase==='idle')break;
    const next=data.fish>data.bar;if(next!==held){held=next;await key(' ',held,'Space');}await sleep(45);
  }
  await key(' ',false,'Space');assert(caught,'Tracking the fish through real input succeeds');
  await screenshot('fishing-jump');
  await wait(`document.querySelector('.fishing-catch-flight')&&!document.querySelector('.fishing-catch-flight').hidden`,5000);
  await screenshot('fishing-flight');
  await wait(`document.querySelector('.fishing-panel')?.dataset.fishingPhase==='idle'`);
  const fishSlots=await evaluate(`Array.from(document.querySelectorAll('.pack-slot')).map(e=>e.getAttribute('aria-label')).filter(s=>/鲤鱼|河鲈/.test(s))`);
  assert.equal(fishSlots.length,1);assert.match(fishSlots[0],/×1/);await screenshot('fishing-inventory');
  // Mobile layout: the reel card must remain above the real inventory, in the viewport.
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(400);
  await screenshot('fishing-mobile');
  assert(await evaluate(`(()=>{const p=document.querySelector('.fishing-panel').getBoundingClientRect();return p.left>=0&&p.right<=innerWidth&&p.bottom<document.querySelector('.inventory-dock').getBoundingClientRect().top})()`),'Mobile fishing panel clears the inventory');
  // A second cast exercises the actual touch hold/release button and small-height layout.
  await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const touch=async down=>{const p=await evaluate(`(()=>{const r=document.querySelector('.fishing-hold').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchTouchEvent',{type:down?'touchStart':'touchEnd',touchPoints:down?[{x:p.x,y:p.y,id:0}]:[]});};
  await wait(`!document.querySelector('.fishing-hold').disabled`);await touch(true);await touch(false);
  await wait(`document.querySelector('.fishing-panel')?.dataset.fishingPhase==='bite'`);await touch(true);
  await wait(`document.querySelector('.fishing-panel')?.dataset.fishingPhase==='reeling'`);await sleep(100);
  assert.equal(await evaluate(`document.querySelector('.fishing-hold').dataset.held`),'true');
  const raised=await evaluate(`parseFloat(document.querySelector('.fishing-green-bar').style.bottom)`);await touch(false);await sleep(160);
  assert.equal(await evaluate(`document.querySelector('.fishing-hold').dataset.held`),'false');
  assert((await evaluate(`parseFloat(document.querySelector('.fishing-green-bar').style.bottom)`))<raised,'Touch release sinks the green bar');
  await screenshot('fishing-mobile-reeling');
  await evaluate(`document.querySelector('[aria-label="操作说明"]').click()`);await sleep(100);
  const frozen=await evaluate(`document.querySelector('.fishing-green-bar').style.bottom`);await sleep(500);
  assert.equal(await evaluate(`document.querySelector('.fishing-green-bar').style.bottom`),frozen,'Reeling freezes while a modal is open');
  await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);
  for(const [width,height] of [[390,600],[800,450]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<640});await sleep(160);
    await screenshot(`fishing-${width}x${height}`);
    const bounds=await evaluate(`(()=>{const p=document.querySelector('.fishing-panel').getBoundingClientRect(),i=document.querySelector('.inventory-dock').getBoundingClientRect();return {left:p.left,right:p.right,bottom:p.bottom,inventoryTop:i.top,inventoryLeft:i.left,inventoryRight:i.right};})()`);
    assert(bounds.left>=0&&bounds.right<=width&&(bounds.bottom<bounds.inventoryTop||bounds.left>=bounds.inventoryRight||bounds.right<=bounds.inventoryLeft),`${width}x${height}: reeling clears inventory ${JSON.stringify(bounds)}`);
  }
  await evaluate(`document.querySelector('.fishing-cancel').click()`);await wait(`document.querySelector('.fishing-panel').dataset.fishingPhase==='idle'`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.pack-slot')).map(e=>e.getAttribute('aria-label')).filter(s=>/鲤鱼|河鲈/.test(s)).join()`),fishSlots.join(),'Cancelling a new cast gives no extra fish');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({result:'passed',url,fishSlots,checks:'initial rod, real WebGL cast/bite/reel/catch, waiting/reeling modal pause, fish sprite jump and inventory flight, one award, touch hold/release/cancel, mobile and landscape bounds, no runtime exceptions'}));
}finally{
  if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);
  browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
