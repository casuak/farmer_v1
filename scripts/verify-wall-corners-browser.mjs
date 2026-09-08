// Finite real-Chrome/WebGL diagnostic on the EXISTING preview; no runtime hooks/server.
// node scripts/verify-wall-corners-browser.mjs [url] [before|after]
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const url=process.argv[2]??'http://127.0.0.1:5177',stage=process.argv[3]??'before';
assert(['before','after'].includes(stage));
const profile=await mkdtemp(path.join(tmpdir(),'pinebrook-wall-corners-'));
const browser=spawn(process.env.CHROME_PATH??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1440,900','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),pending=new Map(),errors=[],consoleErrors=[],screenshots=[];
let ws,sequence=0,call,evaluate;
try{
  await mkdir('.cache',{recursive:true});let port;
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await sleep(100);}}
  assert(port,'Chrome debugging endpoint opened');
  const tabs=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(JSON.stringify(m.error)));else p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')consoleErrors.push(m.params.args.map(a=>a.value??a.description).join(' '));};
  call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},25000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,timeout=20000)=>{const start=Date.now();while(Date.now()-start<timeout){const v=await evaluate(expression);if(v)return v;await sleep(60);}throw new Error('Timed out waiting: '+expression);};
  const click=async selector=>{const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
  const shot=async suffix=>{const s=await call('Page.captureScreenshot',{format:'png'}),file=`.cache/wall-corners-${suffix}.png`;await writeFile(file,Buffer.from(s.data,'base64'));screenshots.push(file);return s.data;};
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});await wait(`document.querySelector('canvas')?.dataset.renderStatus==='ready'`,60000);
  await evaluate(`(async()=>{const entry=performance.getEntriesByType('resource').find(e=>e.name.includes('/@babylonjs_core_Engines_engine.js'));if(!entry)throw Error('Requires existing Vite preview');const {Engine}=await import(entry.name);window.__wcScene=Engine.LastCreatedScene;const {BUILDINGS}=await import('/components/game/geography.ts');window.__wcHome=BUILDINGS.find(b=>b.id==='home');})()`);
  if(await evaluate(`!!document.querySelector('[aria-label="暂停时间"]')`))await click('[aria-label="暂停时间"]');
  await click('[aria-label="画面设置"]');
  await click('.time-presets button:nth-child(2)');
  for(const label of ['春日动态','背景音乐','游戏音效'])if(await evaluate(`document.querySelector('[role="switch"][aria-label="${label}"]')?.getAttribute('aria-checked')==='true'`))await click(`[role="switch"][aria-label="${label}"]`);
  await click('[role="dialog"] .dialog-action');await wait(`!document.querySelector('[role="dialog"]')`);
  await evaluate(`(()=>{const b=window.__wcHome,p=window.__wcScene.getTransformNodeByName('player');p.position.x=b.x;p.position.z=b.z-b.d/2+1.2;document.querySelector('canvas').focus();})()`);
  await wait(`window.__wcScene.getMeshByName('home-roof').visibility<.03`);
  await sleep(3500); // Normal engine room detection and follow camera, never forced camera/roof.
  const collect=()=>evaluate(`(()=>{
    const s=window.__wcScene,b=window.__wcHome,e=s.getEngine(),V=s.activeCamera.position.constructor,M=s.getTransformMatrix().constructor,canvas=document.querySelector('canvas').getBoundingClientRect(),vp=s.activeCamera.viewport.toGlobal(canvas.width,canvas.height);
    const project=p=>{const v=V.Project(new V(...p),M.Identity(),s.getTransformMatrix(),vp);return {x:v.x+canvas.left,y:v.y+canvas.top,z:v.z};};
    const corners=[];for(const x of [b.x-b.w/2,b.x+b.w/2])for(const z of [b.z-b.d/2,b.z+b.d/2])corners.push({name:(x<b.x?'left':'right')+'-'+(z<b.z?'front':'back'),world:[x,1.44,z],bottom:project([x,.1,z]),middle:project([x,1.44,z]),top:project([x,2.865,z])});
    const meshes=s.meshes.filter(m=>m.name.startsWith('home-')).map(m=>{const a=m.getVerticesData('position')??[],boxes=[];for(let i=0;i+71<a.length;i+=72){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let j=0;j<72;j++) {const k=j%3;min[k]=Math.min(min[k],a[i+j]);max[k]=Math.max(max[k],a[i+j]);}const size=max.map((v,k)=>v-min[k]);if(Math.abs(size[0]-.22)<.002&&Math.abs(size[1]-2.85)<.002&&Math.abs(size[2]-.22)<.002)boxes.push({min,max,center:min.map((v,k)=>(v+max[k])/2)});}
      return {name:m.name,visibility:m.visibility,isVisible:m.isVisible,enabled:m.isEnabled(),receiveShadows:m.receiveShadows,vertices:m.getTotalVertices(),material:{name:m.material?.name,alpha:m.material?.alpha,alphaMode:m.material?.alphaMode,transparencyMode:m.material?.transparencyMode,backFaceCulling:m.material?.backFaceCulling,needAlphaBlending:m.material?.needAlphaBlendingForMesh(m)},cornerPostBoxes:boxes};});
    const sun=s.getLightByName('morning-sun'),sg=sun.getShadowGenerator(),casters=sg.getShadowMap()?.renderList??[],gl=e._gl;
    const ground=s.meshes.filter(m=>m.receiveShadows&&(/terrain|ground|floor/.test(m.name))).map(m=>m.name);
    return {home:b,player:s.getTransformNodeByName('player').position.asArray(),camera:s.activeCamera.position.asArray(),target:s.activeCamera.target?.asArray(),hour:Number(document.querySelector('canvas').dataset.gameHour),corners,meshes,shadows:{enabled:s.shadowsEnabled,lightEnabled:sun.shadowEnabled,sunIntensity:sun.intensity,casters:casters.map(m=>m.name),groundReceivers:ground,characterCasters:casters.filter(m=>/farmer|player/.test(m.name)).map(m=>m.name),transparencyShadow:sg.transparencyShadow,softTransparent:sg.enableSoftTransparentShadow,homeCasterPolicy:casters.filter(m=>m.name.startsWith('home-')).map(m=>({name:m.name,allowed:!sg.customAllowRendering||m.subMeshes.some(sm=>sg.customAllowRendering(sm))}))},gl:{version:gl.getParameter(gl.VERSION),renderer:gl.getParameter(gl.RENDERER),error:gl.getError(),lost:gl.isContextLost()},ui:{renderStatus:document.querySelector('canvas').dataset.renderStatus,inventorySlots:document.querySelectorAll('[data-inventory-slot]').length,quickTime:!!document.querySelector('[aria-label="快捷调整时间"]'),bodyText:document.body.innerText}};
  })()`);
  const baseline=await collect();assert.equal(baseline.hour,12);assert(baseline.shadows.enabled,'Production shadows stay enabled');assert(baseline.shadows.characterCasters.length>0,'Farmer remains a real shadow caster');assert(baseline.shadows.groundReceivers.length>0,'Ground still receives shadows');assert.equal(baseline.gl.lost,false);
  if(stage==='after'){
    assert.equal(baseline.meshes.find(m=>m.name==='home-back-walls')?.visibility,1,'Interior rear walls remain opaque');
    for(const name of ['home-front-walls','home-roof']){assert.equal(baseline.meshes.find(m=>m.name===name)?.visibility,0,'Interior cutaway has no transparent ghost '+name);assert.equal(baseline.shadows.homeCasterPolicy.find(m=>m.name===name)?.allowed,false,'Hidden cutaway is excluded from occupied-room sun shadow '+name);}
    assert.equal(baseline.shadows.homeCasterPolicy.find(m=>m.name==='home-back-walls')?.allowed,true,'Opaque rear wall remains a sun caster');
  }
  const original=await shot(stage);
  // Mutations exist solely in this disposable browser scene and always restore.
  await evaluate(`window.__wcOriginalShadows=window.__wcScene.shadowsEnabled;window.__wcScene.shadowsEnabled=false;`);
  await evaluate(`window.__wcScene.whenReadyAsync()`);await sleep(1200);const noShadows=await shot(stage+'-shadows-off');
  await evaluate(`window.__wcScene.shadowsEnabled=window.__wcOriginalShadows;`);await evaluate(`window.__wcScene.whenReadyAsync()`);await sleep(800);
  await evaluate(`window.__wcFacade=window.__wcScene.getMeshByName('home-front-walls');window.__wcOriginalFacade=window.__wcFacade.visibility;window.__wcOverride=window.__wcScene.onBeforeRenderObservable.add(()=>{window.__wcFacade.visibility=0;});`);
  await sleep(1200);const noFacade=await shot(stage+'-facade-zero');
  await evaluate(`window.__wcScene.onBeforeRenderObservable.remove(window.__wcOverride);window.__wcFacade.visibility=window.__wcOriginalFacade;`);await sleep(800);
  // Pixel comparisons use the real projected post footprint, not guessed screen coordinates.
  const measure=async data=>evaluate(`(async()=>{const img=new Image();img.src='data:image/png;base64,${data}';await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const corners=${JSON.stringify(baseline.corners)};return corners.map(p=>{const x=Math.round(p.middle.x)-5,y=Math.round(p.top.y),w=10,h=Math.max(1,Math.round(p.bottom.y)-y);if(x<0||y<0||x+w>c.width||y+h>c.height)return {name:p.name,outside:true};const pixels=ctx.getImageData(x,y,w,h).data;let luma=0,dark=0;for(let i=0;i<pixels.length;i+=4){const l=pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722;luma+=l;if(l<75)dark++;}return {name:p.name,rect:{x,y,w,h},luma:luma/(pixels.length/4),darkPixels:dark};});})()`);
  const pixels={baseline:await measure(original),shadowsOff:await measure(noShadows),facadeZero:await measure(noFacade)};
  // Exercise actual UI after temporary overrides have been removed.
  await click('[aria-label="画面设置"]');assert(await evaluate(`!!document.querySelector('[role="dialog"]')`));await click('[role="dialog"] .dialog-action');await wait(`!document.querySelector('[role="dialog"]')`);
  const restored=await collect();assert(restored.shadows.enabled);assert.equal(restored.gl.error,0);assert.equal(restored.gl.lost,false);assert.equal(restored.ui.renderStatus,'ready');assert(restored.ui.inventorySlots>=9&&restored.ui.quickTime);assert.equal(errors.length,0,errors.join('\n'));assert.equal(consoleErrors.length,0,consoleErrors.join('\n'));
  const steadyGL=await evaluate(`new Promise(resolve=>{const s=window.__wcScene,gl=s.getEngine()._gl,samples=[];const observer=s.onAfterRenderObservable.add(()=>{samples.push(gl.getError());if(samples.length===30){s.onAfterRenderObservable.remove(observer);resolve(samples);}});})`);
  assert(steadyGL.every(code=>code===0),'Thirty consecutive real rendered frames have no GL error: '+steadyGL);
  let outside=null,flashlight=null;
  if(stage==='after'){
    await evaluate(`document.querySelector('canvas').focus()`);
    for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'9',code:'Digit9',windowsVirtualKeyCode:57});
    await wait(`document.querySelector('canvas').dataset.flashlightEnabled==='true'&&window.__wcScene.getLightByName('held-flashlight').isEnabled()&&window.__wcScene.getLightByName('held-flashlight').intensity>3`);await sleep(1200);
    flashlight=await evaluate(`(()=>{const s=window.__wcScene,l=s.getLightByName('held-flashlight'),g=l.getShadowGenerator();return {enabled:document.querySelector('canvas').dataset.flashlightEnabled==='true',lightEnabled:l.isEnabled(),intensity:l.intensity,size:g.getShadowMap().getSize(),walls:g.getShadowMap().renderList.filter(m=>m.name.endsWith('-walls')).map(m=>({name:m.name,visibility:m.visibility,enabled:m.isEnabled(),vertices:m.getTotalVertices(),allowed:!g.customAllowRendering||m.subMeshes.some(sm=>g.customAllowRendering(sm))})),glError:s.getEngine()._gl.getError()};})()`);
    const hiddenWall=flashlight.walls.find(m=>m.name==='home-front-walls');assert(hiddenWall&&hiddenWall.visibility===0&&hiddenWall.enabled&&hiddenWall.vertices>0&&hiddenWall.allowed,'Zero-visibility facade remains physical flashlight shadow geometry');assert.equal(flashlight.glError,0);await shot('after-flashlight');
    for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'1',code:'Digit1',windowsVirtualKeyCode:49});
    await wait(`document.querySelector('canvas').dataset.flashlightEnabled==='false'&&window.__wcScene.getLightByName('held-flashlight').isEnabled()&&window.__wcScene.getLightByName('held-flashlight').intensity===0`);
    await evaluate(`(()=>{const b=window.__wcHome,p=window.__wcScene.getTransformNodeByName('player');p.position.x=b.x+10;p.position.z=b.z-b.d/2-5;})()`);
    await wait(`window.__wcScene.getMeshByName('home-roof').visibility>.999`);await sleep(2500);
    outside=await collect();assert(outside.shadows.enabled);assert(outside.shadows.characterCasters.length>0);assert(outside.shadows.homeCasterPolicy.every(m=>m.allowed),'Exterior restores all home sun casters');assert.equal(outside.gl.error,0);await shot('after-outside');
  }
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(consoleErrors.length,0,consoleErrors.join('\n'));
  // baseline.gl.error retains the pre-existing startup/recovery error rather than hiding it;
  // restored/steadyGL/flashlight/outside assert zero on actual post-recovery rendering.
  const report={stage,result:'passed',url,baseline,pixels,steadyGL,flashlight,outside,restored:{gl:restored.gl,shadowsEnabled:restored.shadows.enabled,facadeVisibility:restored.meshes.find(m=>m.name==='home-front-walls')?.visibility},errors,consoleErrors,screenshots};
  await writeFile(`.cache/wall-corners-${stage}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}catch(error){if(call)try{const s=await call('Page.captureScreenshot',{format:'png'});await writeFile(`.cache/wall-corners-${stage}-failure.png`,Buffer.from(s.data,'base64'));console.error('Browser state',await evaluate(`({canvas:{...document.querySelector('canvas')?.dataset},text:document.body.innerText})`));}catch{}throw error;
}finally{if(evaluate)try{await evaluate(`(()=>{const s=window.__wcScene;if(!s)return;if(window.__wcOverride)s.onBeforeRenderObservable.remove(window.__wcOverride);if(window.__wcFacade)window.__wcFacade.visibility=window.__wcOriginalFacade;if(window.__wcOriginalShadows!==undefined)s.shadowsEnabled=window.__wcOriginalShadows;})()`);}catch{}if(ws?.readyState===WebSocket.OPEN)ws.close();for(const p of pending.values())clearTimeout(p.timer);browser.kill();await sleep(400);await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});}
