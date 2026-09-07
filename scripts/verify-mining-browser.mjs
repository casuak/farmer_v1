// Real Chromium/WebGL input against the existing preview; never starts a game server.
// Usage: node scripts/verify-mining-browser.mjs [http://127.0.0.1:5177]
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177',profile=await mkdtemp(path.join(tmpdir(),'pinebrook-mining-'));
const browser=spawn(process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1440,900','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws,sequence=0,evaluate,call;
const pending=new Map(),errors=[];
try{
  await mkdir('.cache',{recursive:true});let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert(port,'Chromium debugging endpoint opened');
  const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
  call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=15000)=>{const start=Date.now();while(Date.now()-start<timeout){const v=await evaluate(expression);if(v)return v;await sleep(40);}throw new Error('Timed out waiting: '+expression);};
  const key=async(key,down,code=key.length===1?'Key'+key.toUpperCase():key)=>call('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key,code,windowsVirtualKeyCode:key===' '?32:key.length===1?key.toUpperCase().charCodeAt(0):undefined});
  const tap=async(k,code)=>{await key(k,true,code);await key(k,false,code);};
  const focus=()=>evaluate(`document.querySelector('.game-canvas').focus()`);
  const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile(`.cache/${name}.png`,Buffer.from(s.data,'base64'));};
  const nodes=()=>evaluate(`JSON.parse(document.querySelector('canvas').dataset.miningNodes)`);
  const health=async id=>(await nodes()).find(n=>n.id===id).health;
  const busy=`document.querySelector('canvas').dataset.miningActive==='true'`,idle=`document.querySelector('canvas').dataset.miningActive==='false'`;
  const player=()=>evaluate(`({x:Number(document.querySelector('canvas').dataset.playerX),z:Number(document.querySelector('canvas').dataset.playerZ)})`);
  const move=async(keys,condition)=>{await focus();for(const k of keys)await key(k,true);try{await wait(condition);}finally{for(const k of keys)await key(k,false);}await sleep(400);};
  const click=async p=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.__audioStarts=0;const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){window.__audioStarts++;return start.apply(this,args);};`});
  await call('Page.navigate',{url});await wait(`document.querySelector('.game-canvas')?.dataset.renderStatus==='ready'`,60000);
  assert.match(await evaluate(`document.querySelector('[data-inventory-slot="7"]').getAttribute('aria-label')`),/矿镐/);
  assert.equal((await nodes()).length,12);await tap('8','Digit8');await tap('Shift');await focus();await tap('f','KeyF');await sleep(850);
  assert((await nodes()).every(n=>n.health>0),'Empty swing at farm cannot damage remote deposits');await shot('mining-initial');
  // Camera relative D+S = east; W+D = north. The north-south trail at x=-20 is open.
  await move(['d','s'],`Number(document.querySelector('canvas').dataset.playerX)>-20.2`);
  await move(['w','d'],`Number(document.querySelector('canvas').dataset.playerZ)>7.8`);
  await move(['w','a'],`Number(document.querySelector('canvas').dataset.playerX)<-21.9`);
  console.log('Approach',await player());await wait(`document.querySelector('.interact-button').textContent.includes('铜矿脉')`);
  const p=await player(),scale=900/(31.6/1.4),target={x:720+(-23.3-p.x+8-p.z-1.4)*Math.SQRT1_2*scale,y:450+((-23.3-p.x)-(8-p.z-1.4))*.5*scale-.65*Math.SQRT1_2*scale};
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...target});await wait(`document.querySelector('.mining-inspector')?.dataset.oreId==='copper-trail'`);await shot('mining-ore-hover');
  // Wrong tool gives help, never secretly harvests/tills the deposit.
  await tap('1','Digit1');await click(target);await sleep(500);assert.equal(await health('copper-trail'),3);
  await tap('8','Digit8');await click(target);await wait(busy);await evaluate(`document.querySelector('[aria-label="操作说明"]').click()`);await wait(idle);await sleep(500);
  assert.equal(await health('copper-trail'),3,'Opening a panel before contact cancels damage');
  await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);await sleep(650);await focus();
  // Switching tools before contact cancels a held gesture, with no restart on returning.
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...target,button:'left',clickCount:1});await wait(busy);await tap('1','Digit1');await wait(idle);
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:1150,y:750,button:'left',clickCount:1});await tap('8','Digit8');await sleep(900);assert.equal(await health('copper-trail'),3);
  // A quick tap finishes this single stroke, but release prevents any subsequent swing.
  await click(target);await wait(busy);await shot('mining-windup');await wait(idle);await sleep(850);
  assert.equal(await health('copper-trail'),2);assert.equal(await evaluate(`document.querySelector('canvas').dataset.miningHolding`),'false');
  // One continuous mouse press now completes both remaining strikes; no repeat click.
  const otherBefore=(await nodes()).filter(n=>n.id!=='copper-trail').map(n=>n.health);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...target,button:'left',clickCount:1});await wait(busy);
  await wait(`JSON.parse(document.querySelector('canvas').dataset.miningNodes).find(n=>n.id==='copper-trail').health===1`);await shot('mining-held');
  await wait(`JSON.parse(document.querySelector('canvas').dataset.groundItems).some(i=>i.item==='copperOre'&&i.airborne)`);
  const piles=await evaluate(`JSON.parse(document.querySelector('canvas').dataset.groundItems).filter(i=>['copperOre','stone'].includes(i.item))`);
  assert.equal(piles.length,2);assert.equal(piles.find(i=>i.item==='copperOre').count,3);assert.equal(piles.find(i=>i.item==='stone').count,2);
  assert.equal(await evaluate(`document.querySelectorAll('.pack-slot .item-copperOre').length`),0,'Broken mineral has not instantly entered bag');
  assert.equal(await evaluate(`document.querySelector('.pickup-layer').dataset.active`),'0','No fake inventory flight before ground pickup');
  await shot('mining-loot-pop');await wait(idle);
  // Pause while the piles are still flying; world flight timers and positions must freeze.
  await evaluate(`document.querySelector('[aria-label="操作说明"]').click()`);await sleep(300);
  const frozenDrops=await evaluate(`document.querySelector('canvas').dataset.groundItems`);await sleep(450);assert.equal(await evaluate(`document.querySelector('canvas').dataset.groundItems`),frozenDrops);
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:1150,y:750,button:'left',clickCount:1});
  await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);await sleep(650);await focus();
  await wait(`JSON.parse(document.querySelector('canvas').dataset.groundItems).filter(i=>['copperOre','stone'].includes(i.item)).every(i=>!i.airborne)`);
  await sleep(500);assert.equal(await health('copper-trail'),0);assert.deepEqual((await nodes()).filter(n=>n.id!=='copper-trail').map(n=>n.health),otherBefore);
  assert.equal(await evaluate(`document.querySelectorAll('.pack-slot .item-copperOre').length`),0,'Landed loot remains on ground until manually picked up');await shot('mining-loot-ground');
  const labels=()=>evaluate(`Array.from(document.querySelectorAll('.pack-slot')).map(e=>e.getAttribute('aria-label'))`);
  await tap('e');await wait(`document.querySelector('.pickup-layer').dataset.active==='1'`);await shot('mining-pickup-flight');await tap('e');
  await wait(`!!document.querySelector('.pack-slot .item-copperOre')&&!!document.querySelector('.pack-slot .item-stone')`);
  assert((await labels()).some(l=>/铜矿石 ×3/.test(l)));assert((await labels()).some(l=>/石料 ×2/.test(l)));await shot('mining-collected');
  await click(target);await sleep(850);assert((await labels()).some(l=>/铜矿石 ×3/.test(l)),'Depleted deposits cannot duplicate loot');
  // Drop and E pickup really round-trip the ore via existing inventory actions.
  const oreSlot=await evaluate(`document.querySelector('.item-copperOre').closest('[data-inventory-slot]').dataset.inventorySlot`);
  await evaluate(`document.querySelector('[data-inventory-slot="${oreSlot}"]').click()`);await wait(`document.querySelector('[data-inventory-slot="${oreSlot}"]').getAttribute('aria-pressed')==='true'`);
  await evaluate(`document.querySelector('[data-drop-zone]').click()`);
  await wait(`document.querySelector('.interact-button').textContent.includes('拾取铜矿石')`);await focus();await tap('e');await wait(`!!document.querySelector('.item-copperOre')`);
  assert((await labels()).some(l=>/铜矿石 ×3/.test(l)));
  assert((await evaluate('window.__audioStarts'))>6,'Trusted input unlocked actual procedural audio voices');
  // Mobile: no keyboard required. Walk on the already-open trail to the iron pocket.
  await tap('8','Digit8');await move(['d','s'],`Number(document.querySelector('canvas').dataset.playerX)>-20.1`);
  await move(['w','d'],`Number(document.querySelector('canvas').dataset.playerZ)>12.6`);
  await move(['d','s'],`Number(document.querySelector('canvas').dataset.playerX)>-18.5`);
  await wait(`document.querySelector('.interact-button').textContent.includes('铁矿脉')`);
  // Holding E handles one full hit; releasing outside the canvas stops the next stroke.
  await focus();await key('e',true);await wait(`JSON.parse(document.querySelector('canvas').dataset.miningNodes).find(n=>n.id==='iron-east').health===3`);await key('e',false);await wait(idle);await sleep(850);assert.equal(await health('iron-east'),3);
  // F tracks facing, independently from the irrelevant mouse cursor.
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:750,y:650});await focus();await key('f',true,'KeyF');
  await wait(`JSON.parse(document.querySelector('canvas').dataset.miningNodes).find(n=>n.id==='iron-east').health===2`);await key('f',false,'KeyF');await wait(idle);await sleep(850);assert.equal(await health('iron-east'),2);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await sleep(400);
  await wait(`document.querySelector('.interact-button').textContent.includes('铁矿脉')`);
  const button=await evaluate(`(()=>{const r=document.querySelector('.interact-button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  // One real finger hold completes both remaining iron hits. No keyboard or repeated click.
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...button,id:0}]});await wait(busy);await wait(`document.querySelector('canvas').dataset.miningHolding==='true'`);await shot('mining-mobile-hold');
  await wait(`JSON.parse(document.querySelector('canvas').dataset.miningNodes).find(n=>n.id==='iron-east').health===0`);await shot('mining-mobile-loot');
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait(idle);await sleep(1200);
  assert.equal(await evaluate(`document.querySelectorAll('.pack-slot .item-ironOre').length`),0,'Touch release after break cannot fall through into an accidental pickup');
  assert.equal(await evaluate(`JSON.parse(document.querySelector('canvas').dataset.groundItems).filter(i=>i.item==='ironOre').length`),1);
  assert.equal(await evaluate(`document.querySelector('canvas').dataset.miningHolding`),'false');await shot('mining-mobile');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({result:'passed',url,checks:'12 deposits; real movement; wrong tool/out-of-range; tap vs sustained mouse hold; F/E hold + release; switch/pause cancellation; exact once per completed swing; separate ballistic loot piles; airborne pause; land before manual pickup; no auto-collect or adjacent retarget; ore pickup flight/drop/pickup; trusted audio; sustained mobile touch',audioVoices:await evaluate('window.__audioStarts')}));
}catch(error){
  if(call){try{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile('.cache/mining-browser-failure.png',Buffer.from(s.data,'base64'));console.error('Browser state',await evaluate(`({dataset:{...document.querySelector('canvas')?.dataset},text:document.body.innerText})`));}catch{}}
  throw error;
}finally{
  if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);
  browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
