// Chromium/WebGL regression against the EXISTING Vite preview; starts no game server.
// Usage: node scripts/verify-time-rate-browser.mjs [http://127.0.0.1:5177]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,readFile,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177',profile=await mkdtemp(path.join(tmpdir(),'pinebrook-time-rate-'));
const browser=spawn(process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding',...(process.env.CHROME_SOFTWARE_GL?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]),'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,sequence=0;const pending=new Map(),errors=[];
try{
  await mkdir('.cache',{recursive:true});let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert(port,'Chrome opened its debugging endpoint');
  const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=20000)=>{const start=Date.now();while(Date.now()-start<timeout){const value=await evaluate(expression);if(value)return value;await sleep(50);}throw new Error('Timed out waiting: '+expression);};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const open=async()=>{await click('[aria-label="画面设置"]');await wait(`!!document.querySelector('[role="dialog"] [aria-label="时间倍速，可输入 0.25 到 64"]')`);};
  const close=async()=>{await click('[role="dialog"] .dialog-action');await wait(`!document.querySelector('[role="dialog"]')`);};
  const field=async()=>evaluate(`(()=>{const input=document.querySelector('[aria-label="时间倍速，可输入 0.25 到 64"]');return {min:input.getAttribute('min'),max:input.getAttribute('max'),value:input.value};})()`);
  const setRate=async text=>{await wait(`!!document.querySelector('[role="dialog"] [aria-label="时间倍速，可输入 0.25 到 64"]')`);await evaluate(`(()=>{const input=document.querySelector('[role="dialog"] [aria-label="时间倍速，可输入 0.25 到 64"]');input.focus();const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);};
  const blurRate=()=>evaluate(`document.querySelector('[role="dialog"] [aria-label="时间倍速，可输入 0.25 到 64"]').blur()`);
  const keyboard=async(key,code)=>call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:key==='Enter'?13:key==='Escape'?27:undefined});
  const keyboardUp=async(key,code)=>call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:key==='Enter'?13:key==='Escape'?27:undefined});
  const apply=async()=>{await evaluate(`document.querySelector('[aria-label="应用输入的时间倍速"]').click()`);};
  const waitRate=async(expected)=>wait(`Number(document.querySelector('canvas').dataset.timeScale)===${expected}`);
  const setPreset=async(label,hour)=>{await open();await evaluate(`Array.from(document.querySelectorAll('.time-presets button')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);await wait(`Number(document.querySelector('canvas').dataset.gameHour)===${hour}`);await close();};
  const sampleClock=async(seconds=1600)=>evaluate(`new Promise(resolve=>{const start=performance.now(),a=Number(document.querySelector('canvas').dataset.gameHour);setTimeout(()=>{const end=performance.now();resolve({a,b:Number(document.querySelector('canvas').dataset.gameHour),seconds:(end-start)/1000});},${seconds});})`);
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});await wait(`document.querySelector('.game-canvas')?.dataset.renderStatus==='ready'`,60000);
  await open();
  assert.equal((await field()).min,'0.25');assert.equal((await field()).max,'64');
  assert.equal((await field()).value,'1');assert.equal(await evaluate(`document.querySelector('[role="dialog"] .clock-rate-heading strong').textContent`),'1×');
  // Typing then Enter applies without a second click.
  await setRate('3.75');await keyboard('Enter','Enter');await keyboardUp('Enter','Enter');await waitRate(3.75);
  assert.equal(await evaluate(`document.querySelector('[role="dialog"] .clock-rate-heading strong').textContent`),'3.75×');
  // A value above the maximum is clamped to it, not rejected: speeds beyond 16 are allowed.
  await setRate('100');await apply();await waitRate(64);assert.equal((await field()).value,'64');
  await setRate('20');await apply();await waitRate(20);
  // Zero pauses are not typed here: 0 is treated as invalid and the last speed is kept.
  await setRate('0');await apply();await waitRate(20);assert.equal((await field()).value,'20');
  await setRate('0.75');await blurRate();await waitRate(.75);
  await setRate('2.5');await blurRate();await waitRate(2.5);
  await close();
  assert.equal(await evaluate(`document.querySelector('canvas').dataset.timeScale`),'2.5');
  // The real engine clock advances at the typed rate; a paused panel keeps it frozen.
  await click('[aria-label="暂停时间"]');
  await setPreset('正午',12);await open();
  const frozen=await sampleClock(900);assert(Math.abs(frozen.b-frozen.a)<.001,`Paused time stays still while a panel is open: ${JSON.stringify(frozen)}`);
  await evaluate(`document.querySelector('.time-presets button:nth-child(2)').click()`);await wait(`Number(document.querySelector('canvas').dataset.gameHour)===12`);
  await close();
  // 20×: about 2.4 game-minutes per real second, so 48 per second.
  await open();await setRate('20');await apply();await close();await waitRate(20);
  const fast=await sampleClock(940);const fastMinutes=(fast.b-fast.a)*60;assert(fastMinutes>40&&fastMinutes<55,`20× advances roughly 48 min per second: ${JSON.stringify(fast)}`);
  // Slow .25×: about 0.6 game-minutes per 2.5 seconds.
  await open();await setRate('0.25');await apply();await close();await waitRate(.25);
  const slow=await sampleClock(940);const slowMinutes=(slow.b-slow.a)*60;assert(slowMinutes>.4&&slowMinutes<.9,`.25× advances roughly 0.6 min per 2.5s: ${JSON.stringify(slow)}`);
  await open();await setRate('1');await apply();await setRate('1');await apply();await close();await waitRate(1);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({result:'passed',url,checks:'typed ranges 0.25-64, Enter/apply/blur commit, clamp above 64, invalid zero keeps last rate, real engine clock advance at .25x and 20x, pause, preset scrubbing and no runtime exceptions'}));
}finally{
  if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);
  browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
