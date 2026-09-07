// Real Chromium/WebGL encounter test; uses the existing preview, never starts a server.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177',profile=await mkdtemp(path.join(tmpdir(),'pinebrook-boss-'));
const browser=spawn(process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1440,900','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws,sequence=0,evaluate,call;
const pending=new Map(),errors=[];
try{
  await mkdir('.cache',{recursive:true});let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert(port,'Chrome debugging endpoint opened');
  const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
  call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=20000)=>{const start=Date.now();while(Date.now()-start<timeout){const v=await evaluate(expression);if(v)return v;await sleep(40);}throw new Error('Timed out waiting: '+expression);};
  const key=async(key,down,code=key.length===1?'Key'+key.toUpperCase():key)=>call('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key,code,windowsVirtualKeyCode:key===' '?32:key.length===1?key.toUpperCase().charCodeAt(0):undefined});
  const tap=async(k,code)=>{await key(k,true,code);await key(k,false,code);};
  const focus=()=>evaluate(`document.querySelector('.game-canvas').focus()`);
  const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile(`.cache/${name}.png`,Buffer.from(s.data,'base64'));};
  const readState=()=>evaluate(`(()=>{const d=document.querySelector('canvas').dataset;return {x:+d.playerX,z:+d.playerZ,bx:+d.bossX,bz:+d.bossZ,hp:+d.bossHp,playerHp:+d.playerHealth,phase:d.bossPhase,lane:JSON.parse(d.bossTelegraph),screen:JSON.parse(d.bossScreen),visible:d.bossVisible==='true',gold:+d.gold,cd:+d.dodgeCooldown,rolling:d.dodgeActive==='true',iframes:d.dodgeInvulnerable==='true',rolls:+d.dodgeCount,enraged:d.bossEnraged==='true',combo:+d.bossCombo,stomp:JSON.parse(d.bossStomp??'null')};})()`);
  const move=async(keys,condition)=>{await focus();for(const k of keys)await key(k,true);try{await wait(condition);}finally{for(const k of keys)await key(k,false);}await sleep(400);};
  const click=async p=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await call('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});};
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`window.__audioStarts=0;const C=window.AudioContext;window.AudioContext=new Proxy(C,{construct(Target,args){const context=Reflect.construct(Target,args);window.__audioContext=context;return context;}});const s=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...a){window.__audioStarts++;return s.apply(this,a);};`});
  await call('Page.navigate',{url});await wait(`document.querySelector('canvas')?.dataset.renderStatus==='ready'`,60000);
  assert.equal((await readState()).visible,false);assert.equal(await evaluate(`document.querySelectorAll('.boss-hud').length`),0,'No boss bar at farm');
  // Existing camera-relative controls: W+D north, D+S east; central bridge z=0 is clear.
  await tap('Shift');await move(['d','s'],`Number(document.querySelector('canvas').dataset.playerX)>-20.2`);
  console.log('Early audio probe',await evaluate(`({starts:window.__audioStarts,context:window.__audioContext?.state})`));
  await move(['w','d'],`Number(document.querySelector('canvas').dataset.playerZ)>-.55`);
  await move(['d','s'],`Number(document.querySelector('canvas').dataset.playerX)>4`);
  await move(['a','s'],`Number(document.querySelector('canvas').dataset.playerZ)<-16.2`);
  await move(['d','s'],`Number(document.querySelector('canvas').dataset.playerX)>14`);
  await wait(`document.querySelector('.boss-hud')?.textContent.includes('潮角犀王')`);
  await wait(`document.querySelector('canvas').dataset.bossPhase==='windup'`);const telegraph=await readState();assert(telegraph.lane&&telegraph.lane.width===3);await shot('boss-telegraph');
  assert.equal(await evaluate(`document.querySelector('.boss-hp').getAttribute('aria-valuemax')`),'72');
  // The encounter freezes with a panel; telegraph geometry and player health must not advance.
  await evaluate(`document.querySelector('[aria-label="操作说明"]').click()`);await sleep(150);const frozen=await readState();await sleep(500);const still=await readState();assert.deepEqual({...still,screen:null},{...frozen,screen:null});
  await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);await sleep(700);await focus();
  // First charge deliberately kept on the lane: a real collision removes one heart.
  await wait(`Number(document.querySelector('canvas').dataset.playerHealth)<5`,15000);await shot('boss-player-hit');assert.equal((await readState()).playerHp,3,'Charge punishes standing still with two hearts');
  await evaluate(`document.querySelector('[aria-label="画面设置"]').click()`);await sleep(200);
  // Responsive top-bar check while the encounter is paused.
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(250);
  const mobile=await evaluate(`(()=>{const r=document.querySelector('.boss-hud').getBoundingClientRect(),b=document.querySelector('.inventory-dock').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,inventoryTop:b.top};})()`);
  assert(mobile.left>=0&&mobile.right<=390&&mobile.top<120&&mobile.bottom<mobile.inventoryTop,JSON.stringify(mobile));
  await evaluate(`document.querySelector('[role="dialog"] .dialog-action').click()`);await sleep(100);await shot('boss-mobile');
  // Reset after the deliberate damage probe, then approach open beach with full health.
  await evaluate(`document.querySelector('[aria-label="画面设置"]').click()`);await sleep(100);await evaluate(`document.querySelector('.return-home').click()`);await sleep(500);
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await sleep(250);await focus();
  await tap('5','Digit5');await tap('Shift'); // 3x sprint, not the previous 4x.
  await move(['d','s'],`Number(document.querySelector('canvas').dataset.playerX)>-20.2`);
  await move(['w','d'],`Number(document.querySelector('canvas').dataset.playerZ)>-.55`);
  await move(['d','s'],`Number(document.querySelector('canvas').dataset.playerX)>4`);
  await move(['a','s'],`Number(document.querySelector('canvas').dataset.playerZ)<-23`);
  await move(['d','s'],`Number(document.querySelector('canvas').dataset.playerX)>15`);
  let held=[],dodgeUntil=0,dodgeKeys=[],lastLane='',lastShot=0;const started=Date.now();let minHp=72,charges=0,sawEnrage=false,sawCombo=false,rolls=0,enrageShot=false;
  const setKeys=async next=>{for(const k of held)if(!next.includes(k))await key(k,false);for(const k of next)if(!held.includes(k))await key(k,true);held=next;};
  const keysFor=(dx,dz)=>{const right=dx+dz,up=dz-dx,m=Math.max(Math.abs(right),Math.abs(up));return [...(Math.abs(right)>.4*m?[right>0?'d':'a']:[]),...(Math.abs(up)>.4*m?[up>0?'w':'s']:[])];};
  try{
    while(Date.now()-started<120000){
      const s=await readState();minHp=Math.min(minHp,s.hp);assert(s.bx>-1&&s.bx<32&&s.bz<-2.2&&s.bz>-39,'Boss remains on the beach');
      if(s.hp===0)break;assert(s.x>0,'Player survived this encounter');sawEnrage||=s.enraged;sawCombo||=s.combo===2;rolls=Math.max(rolls,s.rolls);
      if(s.enraged&&!enrageShot&&s.phase==='recover'&&s.combo===2){await shot('boss-enraged');enrageShot=true;}
      let next=[],wantsRoll=false;
      if(s.phase==='windup'&&s.lane){
        const id=JSON.stringify(s.lane.start)+JSON.stringify(s.lane.end);
        if(id!==lastLane){
          lastLane=id;charges++;const dx=s.lane.end.x-s.lane.start.x,dz=s.lane.end.z-s.lane.start.z,len=Math.hypot(dx,dz),px=-dz/len,pz=dx/len;
          const choices=[1,-1].map(sign=>({sign,x:s.x+px*4*sign,z:s.z+pz*4*sign})).sort((a,b)=>Math.hypot(a.x-20,a.z+17)-Math.hypot(b.x-20,b.z+17));
          dodgeKeys=keysFor(px*choices[0].sign,pz*choices[0].sign);dodgeUntil=Date.now()+430;
          wantsRoll=s.cd<=0;
        }
      }
      if(s.phase==='stompWindup'&&s.stomp){next=keysFor(s.x-s.bx,s.z-s.bz);wantsRoll=s.cd<=0&&s.stomp.progress>.3;}
      else if(Date.now()<dodgeUntil)next=dodgeKeys;
      else if(Math.hypot(s.x-s.bx,s.z-s.bz)>8.2)next=keysFor(s.bx-s.x,s.bz-s.z);
      else if(Math.hypot(s.x-s.bx,s.z-s.bz)<3.8)next=keysFor(s.x-s.bx,s.z-s.bz);
      await setKeys(next);if(wantsRoll)await tap(' ','Space');
      if(Date.now()-lastShot>345&&!s.rolling&&!wantsRoll&&s.phase!=='return'&&s.screen.x>10&&s.screen.x<1430&&s.screen.y>210&&s.screen.y<680){await click(s.screen);lastShot=Date.now();}
      await sleep(65);
    }
  }finally{await setKeys([]);}
  const defeated=await readState();assert(sawEnrage&&sawCombo,'Fight crosses half-health into separately warned double charges');assert(rolls>0,'Real Space rolls were used during combat');assert(charges>0,'The fight includes additional locked-lane charges and sideways dodge inputs');assert.equal(defeated.hp,0,`Real weapons defeat boss (minimum HP ${minHp})`);await shot('boss-defeated');
  assert.equal(defeated.gold,300,'Exactly one +100 G reward');await sleep(800);assert.equal((await readState()).gold,300,'No repeated defeat rewards');
  assert((await evaluate(`Array.from(document.querySelectorAll('.pack-slot')).map(e=>e.getAttribute('aria-label')).join()`)).includes('贝壳 ×6'));
  console.log('Audio probe',await evaluate(`({starts:window.__audioStarts,context:window.__audioContext?.state,enabled:document.querySelector('[aria-label="游戏音效"]')?.getAttribute('aria-checked')})`));
  assert((await evaluate('window.__audioStarts'))>5,'Gesture-unlocked encounter sounds ran');assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({result:'passed',url,charges,rolls,sawEnrage,sawCombo,checks:'walk from farm; nearby top boss HP; locked charge warning; pause; player collision damage; mobile HUD; real pistol fight + dodge; single defeat reward; local audio; no runtime errors'}));
}catch(error){
  if(call){try{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile('.cache/boss-browser-failure.png',Buffer.from(s.data,'base64'));console.error('Browser state',await evaluate(`({dataset:{...document.querySelector('canvas')?.dataset},text:document.body.innerText})`));}catch{}}
  throw error;
}finally{
  if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
