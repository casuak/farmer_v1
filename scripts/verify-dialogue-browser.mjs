// Real Chrome/CDP on the EXISTING preview. Never starts a game server.
// node scripts/verify-dialogue-browser.mjs [http://127.0.0.1:5177]
// Optional CDP_URL reuses Chrome, creating/closing only this test's tab.
// Only fallback setup changes NPC root positions; all dialogue/settings actions
// are trusted CDP mouse/touch/key input. No dialogue API, synthetic click, or model injection.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile, mkdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5177';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map(), errors = [], consoleErrors = [];
const report = {url, result: 'running', setup: [], checks: [], screenshots: []};
let profile, browser, endpoint = process.env.CDP_URL, targetId, ws, sequence = 0, call, evaluate;
const C = `document.querySelector('.game-canvas')`;
const D = `document.querySelector('.dialogue-overlay')`;

// Observation only: retain actual native source starts, nonzero PCM, live gain
// chain and connected output analyser. We do not replace play with a declaration.
const instrumentation = `(() => {
  window.__dialogueFrames = []; window.__dialogueAudio = []; window.__dialogueSignals = [];
  const edges = new WeakMap(), analysers = new WeakMap();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function(destination, ...rest) {
    if (destination instanceof AudioNode) edges.set(this, destination);
    return connect.call(this, destination, ...rest);
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
    const result = start.apply(this, args), buffer = this.buffer;
    const chain = [], gains = []; let node = this, destination = false;
    for (let i = 0; node && i < 12; i++, node = edges.get(node)) {
      chain.push(node.constructor.name); if (node.gain) gains.push(node.gain.value);
      if (node === this.context.destination) destination = true;
    }
    let rms = 0; if (buffer) {const pcm = buffer.getChannelData(0); for (const v of pcm) rms += v*v; rms = Math.sqrt(rms/pcm.length);}
    window.__dialogueAudio.push({time:performance.now(),currentTime:this.context.currentTime,state:this.context.state,duration:buffer?.duration,rms,gains,chain,destination});
    // Parallel analysis tap does not change the audible source -> master graph.
    if (buffer && Math.abs(buffer.duration-.04)<.002 && !analysers.has(this.context)) {
      let master = edges.get(edges.get(this));
      if (master) {const a = this.context.createAnalyser(); a.fftSize = 256; connect.call(master,a); analysers.set(this.context,a); const samples = new Float32Array(a.fftSize);
        const sample = () => {if(this.context.state==='closed')return;a.getFloatTimeDomainData(samples);let peak=0;for(const v of samples)peak=Math.max(peak,Math.abs(v));if(peak>0)window.__dialogueSignals.push({time:performance.now(),peak});requestAnimationFrame(sample);};requestAnimationFrame(sample);}
    }
    return result;
  };
  let previous = '';
  const record = () => {const d = document.querySelector('.dialogue-overlay'); if(!d)return;
    const frame = {node:d.dataset.dialogueNode,line:Number(d.dataset.dialogueLine),serial:Number(d.dataset.dialogueSerial),typing:d.dataset.typing==='true',text:d.querySelector('.dialogue-text')?.textContent??'',choices:[...d.querySelectorAll('.dialogue-choice')].map(b=>b.textContent)};
    const signature=JSON.stringify(frame);if(signature!==previous){previous=signature;window.__dialogueFrames.push({...frame,time:performance.now()});}
  };
  new MutationObserver(record).observe(document,{childList:true,subtree:true,attributes:true,characterData:true});
})();`;

try {
  await mkdir('.cache', {recursive: true});
  if (!endpoint) {
    profile = await mkdtemp(path.join(tmpdir(), 'pinebrook-dialogue-'));
    browser = spawn(process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--window-size=1440,900', 'about:blank',
    ], {stdio: 'ignore'});
    let spawnError; browser.once('error', error => {spawnError = error;});
    for (let i = 0; i < 100; i++) {
      if (spawnError) throw spawnError;
      try {endpoint = `http://127.0.0.1:${(await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]}`; break;}
      catch {await sleep(100);}
    }
    assert(endpoint, 'Chromium debugging endpoint opened');
  }
  const target = await fetch(`${endpoint}/json/new?about:blank`, {method: 'PUT'}).then(r => r.json());
  targetId = target.id; ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {ws.onopen = resolve; ws.onerror = reject;});
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) {
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  };
  call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => {pending.delete(id); reject(new Error(`CDP timeout ${method}`));}, 20000);
    pending.set(id, {resolve, reject, timer}); ws.send(JSON.stringify({id, method, params}));
  });
  evaluate = async expression => {
    const r = await call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const wait = async (expression, timeout = 15000) => {
    const start = Date.now();
    while (Date.now()-start < timeout) {const v = await evaluate(expression); if (v) return v; await sleep(20);}
    throw new Error(`Timed out waiting: ${expression}`);
  };
  const state = () => evaluate(`(() => {const d=${D};return d?{node:d.dataset.dialogueNode,line:Number(d.dataset.dialogueLine),serial:Number(d.dataset.dialogueSerial),typing:d.dataset.typing==='true',text:d.querySelector('.dialogue-text').textContent,choices:[...d.querySelectorAll('.dialogue-choice')].map(b=>b.textContent),speaker:d.querySelector('#dialogue-speaker')?.textContent}:null;})()`);
  const key = (k, down, code = k.length === 1 ? 'Key'+k.toUpperCase() : k) => call('Input.dispatchKeyEvent', {type:down?'keyDown':'keyUp',key:k,code,windowsVirtualKeyCode:k===' '?32:k==='Escape'?27:k.length===1?k.toUpperCase().charCodeAt(0):undefined});
  const tap = async (k, code) => {await key(k,true,code);await key(k,false,code);};
  const focus = () => evaluate(`${C}.focus()`);
  const clickAt = async (p, touch = false) => {
    if (touch) {await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:0}]});await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    else {await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});}
  };
  const click = async (selector, touch = false) => {
    const p = await evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing input target '+${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;if(x<0||x>innerWidth||y<0||y>innerHeight)throw Error('Input target outside viewport');const hit=document.elementFromPoint(x,y);if(!e.contains(hit)&&hit!==e)throw Error('Input target occluded: '+hit?.className);return {x,y};})()`);
    await clickAt(p,touch);
  };
  const shot = async name => {const s=await call('Page.captureScreenshot',{format:'png'});const file=`.cache/dialogue-${name}.png`;await writeFile(file,Buffer.from(s.data,'base64'));report.screenshots.push(file);};
  const check = (name, details = {}) => {report.checks.push({name,...details});console.log('PASS',name);};
  const ticks = () => evaluate(`window.__dialogueAudio.filter(a=>Math.abs(a.duration-.04)<.002)`);
  const frames = serial => evaluate(`window.__dialogueFrames.filter(f=>f.serial===${serial})`);
  const waitOpen = () => wait(`${D}?.getAttribute('role')==='dialog'&&${C}.dataset.dialogueActive==='true'`);
  const close = async (touch = false) => {await click('.dialogue-close',touch);await wait(`!${D}&&${C}.dataset.dialogueActive==='false'`);};
  const complete = async (touch = false) => {const before=await state();assert(before);if(before.typing)await click('.dialogue-text',touch);await wait(`${D}?.dataset.typing==='false'`);const after=await state();assert.equal(after.serial,before.serial,'Skip does not advance serial');assert.equal(after.line,before.line,'Skip does not advance line');return after;};
  const next = async (touch = false) => {const before=await state();assert(!before.typing);await click('.dialogue-text',touch);await wait(`${D}&&Number(${D}.dataset.dialogueSerial)>${before.serial}`);const after=await state();const history=await frames(after.serial);assert.equal(history[0]?.text,'','A new serial is committed with empty visible text');assert(history[0].typing);return after;};
  const menu = async (touch = false) => {let s=await state();for(let i=0;i<12&&!s.choices.length;i++){s=await complete(touch);if(s.choices.length)break;s=await next(touch);}assert(s.choices.length>=3);return s;};
  const choose = async (text, touch = false) => {const buttons=await evaluate(`[...document.querySelectorAll('.dialogue-choice')].map(b=>b.textContent)`);const index=buttons.findIndex(t=>t.includes(text));assert(index>=0,`Choice exists: ${text} in ${buttons}`);await click(`.dialogue-choice:nth-child(${index+1})`,touch);};
  const snapshotWorld = () => evaluate(`(() => {const s=window.__dialogueScene,d=${C}.dataset;return {player:s.getTransformNodeByName('player').position.asArray(),residents:s.transformNodes.filter(n=>n.name.startsWith('resident-')&&n.name!=='resident-limb').map(n=>({name:n.name,p:n.position.asArray()})),enemies:s.transformNodes.filter(n=>/slime|boss|boat/.test(n.name)).map(n=>({name:n.name,p:n.position.asArray()})),hour:d.gameHour,gold:d.gold,health:d.playerHealth,tool:d.selectedTool,mining:d.miningNodes,dodgeCount:d.dodgeCount,inventory:[...document.querySelectorAll('.pack-slot')].map(e=>e.getAttribute('aria-label'))};})()`);

  await call('Runtime.enable');await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument',{source:instrumentation});
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});await wait(`${C}?.dataset.renderStatus==='ready'`,60000);
  await evaluate(`(async()=>{const entries=performance.getEntriesByType('resource');let scene;for(const e of entries.filter(e=>/engineStore-[^/]+\\.js|@babylonjs_core_Engines_engine\\.js/.test(e.name))){const m=await import(e.name);const store=Object.values(m).find(v=>v?.LastCreatedScene?.meshes);scene=store?.LastCreatedScene;if(scene)break;}if(!scene)throw Error('Live Babylon scene unavailable');window.__dialogueScene=scene;})()`);
  assert.equal(await evaluate(`!!${D}`),false,'No initial dialogue');
  // Reuse the existing mining script's actual walkable corridor. Pursue the live
  // resident position afterward, because NPC patrol timing varies with WebGL startup.
  await focus();await tap('8','Digit8');
  const move = async (keys, condition, timeout = 9000) => {await focus();for(const k of keys)await key(k,true);try{await wait(condition,timeout);}finally{for(const k of keys)await key(k,false);}};
  try {
    await move(['d','s'],`Number(${C}.dataset.playerX)>-20.2`);
    await move(['w','d'],`Number(${C}.dataset.playerZ)>7.0`,12000);
    for(let i=0;i<35;i++){
      if(await evaluate(`document.querySelector('.talk-prompt')?.textContent.includes('奥利')`))break;
      const delta=await evaluate(`(()=>{const s=window.__dialogueScene,p=s.getTransformNodeByName('player').position,n=s.getTransformNodeByName('resident-奥利').position;return {x:n.x-p.x,z:n.z-p.z};})()`);
      const right=delta.x+delta.z,up=delta.z-delta.x,k=Math.abs(right)>Math.abs(up)?right>0?'d':'a':up>0?'w':'s';
      await key(k,true);await sleep(120);await key(k,false);await sleep(30);
    }
    await wait(`document.querySelector('.talk-prompt')?.textContent.includes('奥利')`,1500);
    report.setup.push({mode:'real keyboard movement',target:'奥利',position:await evaluate(`({x:${C}.dataset.playerX,z:${C}.dataset.playerZ})`)});
  } catch(error) {
    report.setup.push({mode:'NPC-only proximity fallback',reason:String(error)});
  }
  // The first opening preserves genuine movement if it succeeded. Later repeats
  // place only the NPC near the unchanged player, never teleport the avatar or
  // stop the world update (so the pause test remains meaningful).
  const arrange = async (name='奥利',force=false) => {
    if(!force&&await evaluate(`document.querySelector('.talk-prompt')?.textContent.includes(${JSON.stringify(name)})`))return;
    const setup=await evaluate(`(()=>{const s=window.__dialogueScene,p=s.getTransformNodeByName('player').position,n=s.getTransformNodeByName('resident-'+${JSON.stringify(name)}),before=n.position.asArray(),displaced=[];for(const other of s.transformNodes.filter(r=>r.name.startsWith('resident-')&&r.name!=='resident-limb'&&r!==n)){if(Math.hypot(other.position.x-p.x,other.position.z-p.z)<3){displaced.push({name:other.name,before:other.position.asArray()});other.position.set(p.x+5,0,p.z+5);}}n.position.set(p.x+.35,0,p.z+.15);return {name:${JSON.stringify(name)},before,after:n.position.asArray(),player:p.asArray(),displaced};})()`);
    report.setup.push({mode:'NPC-only proximity setup',...setup});
    await wait(`document.querySelector('.talk-prompt')?.textContent.includes(${JSON.stringify(name)})`,4000);
  };
  let opened = 0;
  const open = async (method='mouse',name='奥利') => {await arrange(name,opened++>0);const label=await evaluate(`document.querySelector('button.talk-prompt').textContent`);assert(label.includes(`和${name}交谈`));assert(!/\bE\b/i.test(label),'Talk button has no E badge');if(method==='key'){await focus();await tap('1','Digit1');for(let i=0;i<8;i++){await tap('e');await sleep(70);if(await evaluate(`!!${D}`))break;await arrange(name,true);}}else await click('button.talk-prompt',method==='touch');await waitOpen();assert.equal((await state()).speaker,name);return state();};

  const first=await open();assert.equal(first.node,'welcome');assert.equal(first.line,0);
  await sleep(280);const partial=await state();assert(partial.typing&&partial.text.length>0);
  await sleep(260);const grown=await state();assert(grown.text.startsWith(partial.text)&&grown.text.length>partial.text.length,'Actual rendered text grows incrementally');
  await shot('desktop-typing');
  const completed=await complete();assert(completed.text.length>grown.text.length);assert.equal(completed.choices.length,0);
  const firstFrames=await frames(first.serial);assert.equal(firstFrames[0].text,'');
  assert(new Set(firstFrames.map(f=>f.text.length)).size>=4,'Multiple partial rendered states');
  const sound=await ticks();assert(sound.length>=3,'Actual short AudioBufferSourceNode voices started');
  assert(sound.every(a=>a.state==='running'&&a.rms>0&&a.destination&&a.gains.length>=2&&a.gains.every(g=>g>0)),'Nonzero PCM travels through live gain chain to running audio destination');
  await wait(`window.__dialogueSignals.some(s=>s.peak>0)`,3000);
  check('typewriter, native 40ms audio starts and nonzero output, one click completes only current line',{samples:firstFrames.length,voices:sound.length,audio:sound.slice(0,5)});
  const serial=completed.serial,count=(await ticks()).length;await sleep(450);
  assert.equal((await state()).serial,serial);assert.equal((await ticks()).length,count,'No tick after completion');
  const second=await next();assert.equal(second.node,'welcome');assert.equal(second.line,1);assert.equal(second.choices.length,0);
  await wait(`${D}.dataset.typing==='false'`);const secondDone=await state();assert.equal(secondDone.choices.length,3);
  await sleep(450);assert.equal((await state()).serial,second.serial,'Never automatically advances completed lines');
  await shot('desktop-choices');check('two welcome lines, empty new serial, choices only after final line completes, no auto advance');

  // Keep a completed choice menu active so Space cannot intentionally advance it.
  const frozen=await snapshotWorld(),audioStart=await evaluate(`window.__dialogueAudio.length`);
  for(const k of ['w','a','s','d']){await key(k,true);await sleep(140);await key(k,false);}
  await key('f',true);await sleep(220);await key('f',false);await tap(' ','Space');
  await clickAt({x:720,y:280});await sleep(250);
  assert.deepEqual(await snapshotWorld(),frozen,'Dialogue pauses player, every resident, enemies, clock, inventory and tools');
  assert.equal(await evaluate(`${C}.dataset.miningActive`),'false');assert.equal(await evaluate(`${C}.dataset.dodgeActive`),'false');assert.equal(await evaluate(`${C}.dataset.swordPhase`),'idle');
  assert.equal(await evaluate(`window.__dialogueAudio.length`),audioStart,'No mining/weapon/dodge sound started through overlay');
  check('overlay blocks WASD/F/Space/tool pointer; actual world/player/NPC positions stay frozen');

  await choose('聊聊采矿');let branch=await state();assert.equal(branch.node,'mining');assert.equal(branch.line,0);assert.equal(branch.choices.length,0);
  assert.equal((await frames(branch.serial))[0].text,'');await complete();await next();await complete();assert((await state()).choices.some(t=>t.includes('出发前检查什么')));
  await choose('出发前检查什么');assert.equal((await state()).node,'mining-detail');await complete();await next();await complete();await next();assert.equal((await state()).node,'topics');
  await menu();await choose('先聊到这里');assert.equal((await state()).node,'goodbye');await complete();
  const beforeEnd=await snapshotWorld(),endAudio=await evaluate(`window.__dialogueAudio.length`);await click('.dialogue-text');await wait(`!${D}`);await sleep(180);
  const afterEnd=await snapshotWorld();assert.deepEqual(afterEnd.player,beforeEnd.player,'Closing pointer does not move player');assert.equal(afterEnd.dodgeCount,beforeEnd.dodgeCount);assert.equal(afterEnd.mining,beforeEnd.mining);assert.equal(afterEnd.gold,beforeEnd.gold);assert.deepEqual(afterEnd.inventory,beforeEnd.inventory);
  assert.equal(await evaluate(`${C}.dataset.miningActive`),'false');assert.equal(await evaluate(`window.__dialogueAudio.length`),endAudio,'End click does not leak into attack audio');
  check('real topic choice -> two lines -> follow-up choice -> two details -> topic menu -> goodbye; close click does not attack');
  await open('key');assert.equal((await state()).node,'welcome');assert.equal((await state()).line,0);await tap('Escape');await wait(`!${D}`);
  await open();assert.equal((await state()).line,0);assert.equal((await state()).node,'welcome');await close();check('E opens, Escape closes, button reopens from first welcome line');

  const settings = async ({enabled=true,volume}) => {
    await click('[aria-label="画面设置"]');await wait(`!!document.querySelector('[role="switch"][aria-label="游戏音效"]')`);
    const enabledNow=await evaluate(`document.querySelector('[role="switch"][aria-label="游戏音效"]').getAttribute('aria-checked')==='true'`);
    if(enabledNow!==enabled)await click('[role="switch"][aria-label="游戏音效"]');
    if(volume!==undefined){assert(enabled);const selector=await evaluate(`(()=>{const row=[...document.querySelectorAll('.settings-row')].find(r=>r.querySelector('strong')?.textContent==='音量'),thumb=row?.querySelector('[role="slider"]');if(!thumb)throw Error('Effects volume slider missing');thumb.setAttribute('data-dialogue-test-volume','true');thumb.scrollIntoView({block:'nearest'});thumb.focus();return '[data-dialogue-test-volume]';})()`);await tap('Home');for(let n=0;n<volume;n+=5)await tap('ArrowRight');assert.equal(Number(await evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-valuenow')`)),volume);}
    await shot(`settings-${enabled?volume:'off'}`);await click('[role="dialog"] .dialog-action');await wait(`!document.querySelector('[role="dialog"]')`);await sleep(100);
  };
  for(const setting of [{enabled:false},{enabled:true,volume:0},{enabled:true,volume:25},{enabled:true,volume:75}]){
    await settings(setting);const countBefore=(await ticks()).length;await open();await sleep(650);const observed=(await ticks()).slice(countBefore);
    if(!setting.enabled||setting.volume===0)assert.equal(observed.length,0,'Sound off/zero volume starts no dialogue sources');
    else {assert(observed.length>=3);assert(observed.slice(-3).every(a=>Math.abs(a.gains.at(-1)-setting.volume/100)<.015),'Actual master gain settles to settings slider after WebAudio smoothing');}
    assert((await state()).text.length>0,'Muted text still types');await close();check('audio settings verified through native starts/live gains',{...setting,voices:observed.length,master:observed.at(-1)?.gains.at(-1)});
  }

  // Each named resident uses the same two-line welcome contract, not a legacy toast.
  for(const name of ['莉芙','阿松','米娅','艾达']){
    const original=await evaluate(`window.__dialogueScene.getTransformNodeByName('resident-'+${JSON.stringify(name)}).position.asArray()`);
    const s=await open('mouse',name);assert.equal(s.node,'welcome');assert.equal(s.line,0);await complete();assert.equal((await state()).choices.length,0);await next();await complete();assert.equal((await state()).choices.length,3);await shot(`resident-${name}`);await close();
    // Restore this resident away from the player so it cannot win nearest-NPC selection.
    await evaluate(`window.__dialogueScene.getTransformNodeByName('resident-'+${JSON.stringify(name)}).position.set(...${JSON.stringify(original)})`);
  }
  check('all five named residents show two welcome paragraphs followed by real choices');

  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await sleep(300);
  await open('touch');await sleep(250);assert((await state()).typing);await complete(true);await next(true);await complete(true);await shot('mobile-choices');
  const bounds=await evaluate(`(()=>{const selectors=['.dialogue-bubble','#dialogue-speaker','.dialogue-text','.dialogue-close',...Array.from({length:document.querySelectorAll('.dialogue-choice').length},(_,i)=>'.dialogue-choice:nth-child('+(i+1)+')')];return selectors.map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {selector,x:r.x,y:r.y,width:r.width,height:r.height,visible:s.visibility!=='hidden'&&s.display!=='none',text:e.textContent};});})()`);
  assert(bounds.every(r=>r.visible&&r.width>0&&r.height>0&&r.x>=-1&&r.y>=-1&&r.x+r.width<=391&&r.y+r.height<=845),'390px speaker/text/choices/close all visibly within viewport');
  assert(bounds.find(r=>r.selector==='#dialogue-speaker').text.includes('奥利'));assert(bounds.find(r=>r.selector==='.dialogue-text').text.length>5);
  await choose('聊聊采矿',true);assert.equal((await state()).node,'mining');await complete(true);await next(true);await complete(true);await choose('谢谢，回头见',true);await complete(true);await shot('mobile-goodbye');await click('.dialogue-text',true);await wait(`!${D}`);
  await open('touch');assert.equal((await state()).node,'welcome');await close(true);
  check('390px real touch open/skip/next/choice/goodbye/reopen/close and visible speaker/text bounds',{bounds});
  assert.deepEqual(errors,[],'No browser runtime exceptions');assert.deepEqual(consoleErrors,[],'No browser console errors');
  report.result='passed';report.audioOutputSamples=await evaluate(`window.__dialogueSignals.length`);
} catch(error) {
  report.result='failed';report.failure=error.stack??String(error);
  if(call)try{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile('.cache/dialogue-failure.png',Buffer.from(s.data,'base64'));report.screenshots.push('.cache/dialogue-failure.png');report.failureState=await evaluate(`({dataset:{...${C}?.dataset},text:document.body.innerText,frames:window.__dialogueFrames?.slice(-25),audio:window.__dialogueAudio?.slice(-15)})`);}catch(diagnostic){report.diagnosticError=String(diagnostic);}
  console.error(report.failure);process.exitCode=1;
} finally {
  report.errors=errors;report.consoleErrors=consoleErrors;
  await writeFile('.cache/dialogue-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({result:report.result,checks:report.checks.length,report:'.cache/dialogue-report.json',screenshots:report.screenshots}));
  if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);
  if(endpoint&&targetId)await fetch(`${endpoint}/json/close/${targetId}`).catch(()=>{});
  if(browser){browser.kill();await sleep(400);}if(profile)await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
