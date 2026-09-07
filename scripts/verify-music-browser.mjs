// Real Chromium/CDP check of the looping background music against the EXISTING preview.
// Starts no game server. The trusted key/Space unlock and the settings gear are real CDP
// input; the in-dialog switches and the volume slider are driven by DOM clicks / keyboard,
// since a raw pointer at their center would land on the scrollable dialog backdrop. Game
// state is never injected - the only test hook is capturing the single Audio reference.
// Usage: node scripts/verify-music-browser.mjs [http://127.0.0.1:5177]
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177',profile=await mkdtemp(path.join(tmpdir(),'pinebrook-music-'));
const browser=spawn(process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1440,900','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws,sequence=0,evaluate,call;
const pending=new Map(),errors=[];
const music=`window.__musicAudio`;
try{
  await mkdir('.cache',{recursive:true});let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert(port,'Chromium debugging endpoint opened');
  const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
  call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=20000)=>{const start=Date.now();while(Date.now()-start<timeout){const v=await evaluate(expression);if(v)return v;await sleep(40);}throw new Error('Timed out waiting: '+expression);};
  const key=async(key,down,code=key.length===1?'Key'+key.toUpperCase():key)=>call('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',key,code,windowsVirtualKeyCode:key===' '?32:key.length===1?key.toUpperCase().charCodeAt(0):undefined});
  const tap=async(k,code)=>{await key(k,true,code);await key(k,false,code);};
  const click=async p=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
  const clickSel=async sel=>{const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await click(p);};
  const shot=async name=>{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile(`.cache/${name}.png`,Buffer.from(s.data,'base64'));};
  const currentTime=()=>evaluate(`${music}&&${music}.currentTime`);
  const dataset=()=>evaluate(`(()=>{const d=document.querySelector('canvas').dataset;return {playing:d.musicPlaying,enabled:d.musicEnabled,volume:d.musicVolume};})()`);
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  // Instrument Audio/HTMLMediaElement BEFORE any page script runs so the single background
  // music element is captured by reference without touching game state.
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__musicElementCount=0;window.__musicAudio=null;window.__musicPlayCount=0;window.__musicPauseCount=0;
    const RealAudio=window.Audio;
    function InstrumentedAudio(src,...rest){const el=new RealAudio(src,...rest);window.__musicElementCount++;window.__musicAudio=el;return el;}
    InstrumentedAudio.prototype=RealAudio.prototype;window.Audio=InstrumentedAudio;
    const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...a){if(this===window.__musicAudio)window.__musicPlayCount++;return play.apply(this,a);};
    const pause=HTMLMediaElement.prototype.pause;HTMLMediaElement.prototype.pause=function(...a){if(this===window.__musicAudio)window.__musicPauseCount++;return pause.apply(this,a);};
  `});
  await call('Page.navigate',{url});
  await wait(`document.querySelector('.game-canvas')?.dataset.renderStatus==='ready'`,60000);

  // 1. Before any trusted gesture: no background music element, nothing playing.
  assert.equal((await dataset()).playing,'false','No music before a trusted input');
  assert.equal(await evaluate('window.__musicElementCount'),0,'No Audio element is created before a gesture');
  assert.equal(await evaluate('window.__musicAudio'),null,'No music reference yet');

  // 2. A trusted key event unlocks and starts the music.
  await tap('8','Digit8');
  await wait(`${music}&&${music}.paused===false`,15000);
  await wait(`document.querySelector('canvas').dataset.musicPlaying==='true'`,15000);
  const d1=await dataset();
  assert.equal(d1.enabled,'true','Music is enabled by default');
  assert.equal(d1.volume,'0.22','Default music volume is 0.22');
  assert.equal(await evaluate('window.__musicElementCount'),1,'Exactly one music element');

  // 3. The captured element is the local loop: finite src, loop=true, real duration, live volume.
  const src=await evaluate(`${music}.src`);
  assert(src.endsWith('/audio/dream-culture.mp3'),`Music src is the bundled track: ${src}`);
  assert.equal(await evaluate(`${music}.loop`),true,'Background music loops');
  assert(Math.abs((await evaluate(`${music}.volume`))-0.22)<1e-9,'Element volume is 0.22');
  await wait(`Number.isFinite(${music}.duration)&&${music}.duration>0&&${music}.readyState>=2`,20000);
  const duration=await evaluate(`${music}.duration`);
  // currentTime actually advances while playing.
  const t0=await currentTime();await sleep(500);const t1=await currentTime();
  assert(t1>t0,`currentTime advances while playing (${t0} -> ${t1})`);

  // 4. The bundled asset is served locally with a real audio MIME type.
  const fetchInfo=await evaluate(`(async()=>{const r=await fetch('/audio/dream-culture.mp3',{method:'HEAD'});return {status:r.status,ct:r.headers.get('content-type')||''};})()`);
  assert.equal(fetchInfo.status,200,`Music fetch returns 200 (got ${fetchInfo.status})`);
  assert(/^audio\//.test(fetchInfo.ct),`Music fetch has an audio MIME type (got ${fetchInfo.ct})`);

  // 5. Repeated trusted inputs neither restart the track nor stack a second element.
  const beforeRepeat=await currentTime();await tap('8','Digit8');await tap('8','Digit8');await tap('8','Digit8');await sleep(600);
  const afterRepeat=await currentTime();
  assert.equal(await evaluate('window.__musicPlayCount'),1,'Playing music is never double-started by repeated input');
  assert.equal(await evaluate('window.__musicElementCount'),1,'Repeated input does not stack audio elements');
  assert(afterRepeat>beforeRepeat,`currentTime is not reset by repeated input (${beforeRepeat} -> ${afterRepeat})`);

  // 6. Loop continuity: seek to just before the end and confirm it wraps to the start.
  await evaluate(`${music}.currentTime=${music}.duration-0.4`);
  await sleep(700);
  const wrapped=await currentTime();
  assert(wrapped<0.5,`Loop wraps back to the start (currentTime=${wrapped.toFixed(3)})`);

  // 7. Open the settings via a real click on the gear; music keeps playing with the dialog up.
  await clickSel('[aria-label="画面设置"]');
  await wait(`!!document.querySelector('[aria-label="背景音乐"]')`,10000);
  await sleep(400);
  await wait(`document.querySelector('canvas').dataset.musicPlaying==='true'`,10000);

  // 8. Turning the effect sounds off does not silence the background music.
  // .click() (DOM input) on the in-dialog switch: a real pointer at its center could land
  // on the scrollable dialog's backdrop and close it, so the switch is toggled directly.
  await evaluate(`document.querySelector('[aria-label="游戏音效"]').click()`);
  await sleep(600);
  assert.equal((await dataset()).playing,'true','Disabling effect sounds leaves the music playing');
  assert.equal((await dataset()).enabled,'true','Music toggle is still on');

  // 9. Live music-volume slider (real keyboard on the Radix thumb): 0 pauses, >0 resumes.
  const musicThumb=async()=>evaluate(`(()=>{const row=Array.from(document.querySelectorAll('.settings-row')).find(r=>r.querySelector('strong')?.textContent==='音乐音量');const t=row?.querySelector('[role="slider"],[data-slot="slider-thumb"]');if(!t)return false;t.focus();return true;})()`);
  assert.equal(await musicThumb(),true,'Music volume slider thumb found and focused');
  await tap('Home','Home');
  await wait(`document.querySelector('canvas').dataset.musicVolume==='0'`,10000);
  await wait(`document.querySelector('canvas').dataset.musicPlaying==='false'`,10000);
  assert.equal(await evaluate(`${music}.paused`),true,'Volume 0 pauses the music');
  const frozen=await currentTime();await sleep(300);assert.equal(await currentTime(),frozen,'currentTime is frozen while paused');
  await tap('End','End');
  await wait(`Number(document.querySelector('canvas').dataset.musicVolume)>0`,10000);
  await wait(`document.querySelector('canvas').dataset.musicPlaying==='true'`,10000);
  assert.equal(await evaluate(`${music}.paused`),false,'Volume >0 resumes the music');
  await sleep(400);assert((await currentTime())>frozen,'currentTime advances again after resuming');

  // 10. The dedicated background-music switch independently pauses / resumes.
  await evaluate(`document.querySelector('[aria-label="背景音乐"]').click()`);
  await wait(`document.querySelector('canvas').dataset.musicPlaying==='false'`,10000);
  assert.equal((await dataset()).enabled,'false','Background-music switch turns off');
  assert.equal(await evaluate(`${music}.paused`),true,'Element pauses when the music switch is off');
  await evaluate(`document.querySelector('[aria-label="背景音乐"]').click()`);
  await wait(`document.querySelector('canvas').dataset.musicPlaying==='true'`,10000);
  assert.equal((await dataset()).enabled,'true','Background-music switch turns back on');
  assert.equal(await evaluate(`${music}.paused`),false,'Element resumes when the music switch is on');
  await shot('music-settings');

  // 11. Close the settings with a real click and wait out its close animation.
  await evaluate(`document.querySelector('.dialog-action').click()`);
  await sleep(700);
  assert.equal((await dataset()).playing,'true','Music still plays after closing the settings dialog');

  // 12. Visibility lifecycle: backgrounding pauses, returning to foreground resumes. Only the
  // visibility getters are overridden; no game state is touched (render loop sleeps while hidden,
  // so the live element's paused flag is the source of truth here).
  await evaluate(`(()=>{Object.defineProperty(document,'visibilityState',{get:()=>'hidden',configurable:true});Object.defineProperty(document,'hidden',{get:()=>true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));return true;})()`);
  await wait(`${music}.paused===true`,10000);
  await evaluate(`(()=>{Object.defineProperty(document,'visibilityState',{get:()=>'visible',configurable:true});Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));return true;})()`);
  await wait(`${music}.paused===false`,10000);
  assert.equal(await evaluate(`${music}.paused`),false,'Music resumes when the tab returns to the foreground');

  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({result:'passed',url,duration,checks:'no music before trusted input; trusted key starts; element is the local looping mp3 (loop=true, finite duration, readyState>=2, currentTime advances); fetch 200 + audio/mpeg; repeated input neither resets currentTime nor stacks elements; loop wraps; real gear click opens; effect-sound off keeps music; live volume slider 0->pause / >0->resume; dedicated music switch; settings close animation; visibility background pause/resume; no runtime exceptions',volume:await evaluate(`${music}.volume`),musicPlaying:await evaluate(`document.querySelector('canvas').dataset.musicPlaying`)}));
}catch(error){
  if(call){try{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile('.cache/music-browser-failure.png',Buffer.from(s.data,'base64'));console.error('Browser state',await evaluate(`({dataset:{...document.querySelector('canvas')?.dataset},music:window.__musicAudio?{paused:window.__musicAudio.paused,currentTime:window.__musicAudio.currentTime,src:window.__musicAudio.src,duration:window.__musicAudio.duration,readyState:window.__musicAudio.readyState,loop:window.__musicAudio.loop}:null,body:document.body.innerText.slice(0,400)})`));}catch{}}
  throw error;
}finally{
  if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);
  browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
