// Real Chromium/WebGL input on the existing preview; does not start a game server.
// node scripts/verify-mining-per-hit-browser.mjs [http://127.0.0.1:5177]
// Optional CDP_URL=http://127.0.0.1:9222 reuses Chrome (creates/closes only its own tab).
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile, mkdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const url = process.argv[2] ?? 'http://127.0.0.1:5177';
const output = '.cache/mining-per-hit';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map(), errors = [], report = {url, scenarios: []};
let profile, browser, endpoint = process.env.CDP_URL, targetId, ws, sequence = 0, call, evaluate;
try {
  await mkdir(output, {recursive: true});
  if (!endpoint) {
    profile = await mkdtemp(path.join(tmpdir(), 'pinebrook-per-hit-'));
    browser = spawn(process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--window-size=1440,900', 'about:blank',
    ], {stdio: 'ignore'});
    for (let i = 0; i < 100; i++) {
      try { endpoint = `http://127.0.0.1:${(await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]}`; break; }
      catch { await sleep(100); }
    }
    assert(endpoint, 'Chromium debugging endpoint opened');
  }
  const target = await fetch(`${endpoint}/json/new?about:blank`, {method: 'PUT'}).then(r => r.json());
  targetId = target.id;
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {ws.onopen = resolve; ws.onerror = reject;});
  ws.onmessage = e => {
    const message = JSON.parse(e.data);
    if (message.id) {
      const p = pending.get(message.id); if (!p) return;
      pending.delete(message.id); clearTimeout(p.timer);
      if (message.error) p.reject(new Error(JSON.stringify(message.error))); else p.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    }
  };
  call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {pending.delete(id); reject(new Error(`CDP timeout ${method}`));}, 20000);
    pending.set(id, {resolve, reject, timer}); ws.send(JSON.stringify({id, method, params}));
  });
  evaluate = async expression => {
    const result = await call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (expression, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = await evaluate(expression); if (value) return value;
      await sleep(15);
    }
    throw new Error(`Timed out waiting: ${expression}`);
  };
  const canvas = `document.querySelector('.game-canvas')`;
  const ground = `JSON.parse(${canvas}.dataset.groundItems)`;
  const nodes = `JSON.parse(${canvas}.dataset.miningNodes)`;
  const copperHealth = `${nodes}.find(n=>n.id==='copper-trail').health`;
  const idle = `${canvas}.dataset.miningActive==='false'`;
  const key = (key, down, code = key.length === 1 ? 'Key' + key.toUpperCase() : key) => call('Input.dispatchKeyEvent', {
    type: down ? 'keyDown' : 'keyUp', key, code,
    windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined,
  });
  const tap = async (k, code) => {await key(k, true, code); await key(k, false, code);};
  const focus = () => evaluate(`${canvas}.focus()`);
  const screenshot = async name => {
    const shot = await call('Page.captureScreenshot', {format: 'png'});
    await writeFile(`${output}/${name}.png`, Buffer.from(shot.data, 'base64'));
  };
  const mouse = (type, point) => call('Input.dispatchMouseEvent', {type, ...point, button: 'left', clickCount: 1});
  const click = async point => {await mouse('mousePressed', point); await mouse('mouseReleased', point);};
  const uiClick = async selector => {
    const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await click(point);
  };
  const move = async (keys, condition) => {
    await focus(); for (const k of keys) await key(k, true);
    try {await wait(condition);} finally {for (const k of keys) await key(k, false);}
    await sleep(400);
  };
  const labels = () => evaluate(`Array.from(document.querySelectorAll('.pack-slot')).map(e=>e.getAttribute('aria-label'))`);
  const noInventoryLoot = async () => {
    assert(!(await labels()).some(label => /铜矿石|石料/.test(label)), 'No loot enters inventory before E');
    assert.equal(await evaluate(`document.querySelector('.pickup-layer').dataset.active`), '0', 'No automatic pickup flight');
  };
  const loot = () => evaluate(`${ground}.filter(i=>i.item==='copperOre'||i.item==='stone')`);
  const assertLoot = async hits => {
    const items = await loot(), copper = items.filter(i => i.item === 'copperOre'), stone = items.filter(i => i.item === 'stone');
    assert.equal(copper.length, hits, `Hit ${hits}: one independently identified copper item per hit`);
    assert.equal(new Set(copper.map(i => i.id)).size, hits);
    assert(copper.every(i => i.count === 1), 'No merged copper stacks');
    assert.equal(stone.length, hits === 3 ? 1 : 0, 'Stone appears only on the breaking hit');
    if (hits === 3) assert.equal(stone[0].count, 2);
    await noInventoryLoot(); return items;
  };
  const observe = () => evaluate(`
    window.__perHitFrames=[];window.__perHitWatching=true;
    (()=>{let previous='';function frame(){if(!window.__perHitWatching)return;
      const c=${canvas};const value=c.dataset.groundItems;
      if(value&&value!==previous){previous=value;window.__perHitFrames.push({time:performance.now(),health:JSON.parse(c.dataset.miningNodes).find(n=>n.id==='copper-trail').health,items:JSON.parse(value)});}
      requestAnimationFrame(frame);
    }requestAnimationFrame(frame);})();
  `);
  const arc = async id => {
    const frames = await evaluate(`window.__perHitFrames.flatMap(f=>f.items.filter(i=>i.id===${id}).map(i=>({...i,time:f.time,health:f.health})))`);
    const flying = frames.filter(f => f.airborne && f.visual);
    assert(flying.length >= 3, `Drop ${id}: multiple visible flight samples`);
    assert(flying.every(f => Number.isFinite(f.flightTime)), 'Flight times are observable');
    const first = flying[0], peak = flying.reduce((a, b) => a.visual.y > b.visual.y ? a : b);
    assert(peak.visual.y > first.visual.y + .05, `Drop ${id}: visible y rises after impact`);
    assert(flying.some(f => f.time > peak.time && f.visual.y < peak.visual.y - .08), `Drop ${id}: visible y descends`);
    const landed = frames.find(f => !f.airborne && f.visual);
    assert(landed, `Drop ${id}: reaches the ground`);
    assert.equal(landed.flightTime, null);
    return {id, firstY: first.visual.y, peakY: peak.visual.y, landedY: landed.visual.y, samples: frames.length};
  };
  const approach = async () => {
    await call('Page.navigate', {url});
    await wait(`${canvas}?.dataset.renderStatus==='ready'`, 60000);
    await tap('8', 'Digit8'); await tap('Shift');
    await move(['d', 's'], `Number(${canvas}.dataset.playerX)>-20.2`);
    await move(['w', 'd'], `Number(${canvas}.dataset.playerZ)>7.8`);
    await move(['w', 'a'], `Number(${canvas}.dataset.playerX)<-21.9`);
    await wait(`${canvas}.dataset.miningTarget==='copper-trail'`);
    const p = await evaluate(`({x:Number(${canvas}.dataset.playerX),z:Number(${canvas}.dataset.playerZ)})`);
    const scale = 900 / (31.6 / 1.4);
    const point = {x: 720 + (-23.3 - p.x + 8 - p.z - 1.4) * Math.SQRT1_2 * scale,
      y: 450 + ((-23.3 - p.x) - (8 - p.z - 1.4)) * .5 * scale - .65 * Math.SQRT1_2 * scale};
    await call('Input.dispatchMouseEvent', {type: 'mouseMoved', ...point});
    await wait(`document.querySelector('.mining-inspector')?.dataset.oreId==='copper-trail'`);
    assert.equal(await evaluate(copperHealth), 3);
    await observe(); await focus(); return point;
  };
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});

  // Three genuine down/up mouse taps, separated by complete landing. Never mine via evaluate.
  const point = await approach();
  const untouched = await evaluate(`${nodes}.filter(n=>n.id!=='copper-trail')`);
  await click(point); await tap('1', 'Digit1'); await wait(idle); await sleep(950);
  assert.equal(await evaluate(copperHealth), 3, 'Tool switch before contact cancels the unfinished strike');
  assert.deepEqual(await loot(), [], 'Cancelled, unhit stroke emits nothing');
  await tap('8', 'Digit8'); await focus();
  const tapped = [];
  for (let hit = 1; hit <= 3; hit++) {
    await click(point);
    await wait(`${copperHealth}===${3-hit}`);
    const items = await assertLoot(hit), copper = items.filter(i => i.item === 'copperOre');
    const newest = copper.find(i => !tapped.some(t => t.id === i.id));
    assert(newest?.airborne, `Hit ${hit}: newly ejected copper is flying immediately, before waiting for break`);
    assert.equal(newest.count, 1); assert(newest.visual);
    await screenshot(`tap-hit-${hit}-flight`);
    await wait(`${ground}.filter(i=>i.item==='copperOre'||i.item==='stone').every(i=>!i.airborne)`);
    await wait(idle); await sleep(230);
    assert.equal(await evaluate(copperHealth), 3-hit, 'Tap cannot become a held repeat');
    await assertLoot(hit); await screenshot(`tap-hit-${hit}-landed`);
    tapped.push(await arc(newest.id));
  }
  assert.deepEqual(await evaluate(`${nodes}.filter(n=>n.id!=='copper-trail')`), untouched, 'No adjacent retarget');

  // Inspect actual Babylon dropped-mesh material, not just a CSS icon or a source string.
  const textures = await evaluate(`(async()=>{
    const entry=performance.getEntriesByType('resource').find(e=>/\\/engineStore-[^/]+\\.js/.test(e.name));
    if(!entry)throw new Error('Shared Babylon EngineStore resource not found');
    const module=await import(entry.name);const store=Object.values(module).find(v=>v&&v.LastCreatedScene?.meshes);
    if(!store)throw new Error('Live Babylon scene not found');
    return store.LastCreatedScene.meshes.filter(m=>m.metadata?.itemId==='copperOre').map(m=>({
      id:m.metadata.groundItemId,name:m.name,url:m.material?.diffuseTexture?.url,ready:m.material?.diffuseTexture?.isReady(),alpha:m.material?.diffuseTexture?.hasAlpha
    }));
  })()`);
  assert.equal(textures.length, 3);
  for (const texture of textures) {
    assert(texture.ready && texture.alpha, 'Dropped ore uses a ready alpha PNG texture');
    const asset = new URL(texture.url, url); assert.equal(asset.origin, new URL(url).origin);
    assert.match(asset.pathname, /\.png$/);
    const response = await fetch(asset); assert(response.ok, 'Same-origin ore PNG loads');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer()).slice(0, 8)], [137,80,78,71,13,10,26,10]);
  }
  // E only: each of four independent piles is collected once, after it has landed.
  await focus();
  for (let remaining = 4; remaining > 0; remaining--) {
    await tap('e'); await wait(`${ground}.filter(i=>i.item==='copperOre'||i.item==='stone').length===${remaining-1}`);
    if (remaining === 4) await screenshot('manual-E-pickup');
  }
  await wait(`document.querySelector('.pickup-layer').dataset.active==='0'`);
  assert((await labels()).some(label => /铜矿石 ×3/.test(label)));
  assert((await labels()).some(label => /石料 ×2/.test(label)));
  await screenshot('tap-collected');
  report.scenarios.push({mode: 'three separate mouse taps', cancelledWithoutLoot: true, arcs: tapped, textures, copper: 3, stone: 2, manualPickup: 'real E'});

  // Fresh page, same reachable copper: one F down through three contacts, then keyup.
  await approach();
  await call('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 750, y: 650});
  await focus(); await key('f', true, 'KeyF');
  const held = [];
  for (let hit = 1; hit <= 3; hit++) {
    await wait(`${copperHealth}===${3-hit}`);
    const items = await assertLoot(hit);
    const newest = items.find(i => i.item === 'copperOre' && !held.includes(i.id));
    assert(newest?.airborne, `Held F contact ${hit} has its own new flight`);
    held.push(newest.id); await screenshot(`held-F-hit-${hit}-flight`);
  }
  await key('f', false, 'KeyF');
  // Freeze the final flight using the real help button; opening a panel cancels inputs.
  await uiClick('[aria-label="操作说明"]');
  await wait(`!!document.querySelector('[role="dialog"]')`); await sleep(100);
  const frozen = await loot(); assert(frozen.some(i => i.airborne), 'Pause catches an in-progress flight');
  await sleep(450); assert.deepEqual(await loot(), frozen, 'Paused flight time and rendered xyz remain unchanged');
  await screenshot('held-F-paused');
  await uiClick('[role="dialog"] .dialog-action');
  await wait(`${ground}.filter(i=>i.item==='copperOre'||i.item==='stone').every(i=>!i.airborne)`);
  await wait(idle); await sleep(900);
  await assertLoot(3); assert.equal(await evaluate(`${canvas}.dataset.miningHolding`), 'false');
  await screenshot('held-F-all-landed');
  const heldArcs = []; for (const id of held) heldArcs.push(await arc(id));
  report.scenarios.push({mode: 'one continuous F hold', ids: held, arcs: heldArcs, pauseFrozen: true, copper: 3, stone: 2, noAutoPickup: true});
  assert.deepEqual(errors, [], 'No browser runtime exceptions');
  report.result = 'passed';
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (call) try {
    const shot = await call('Page.captureScreenshot', {format: 'png'});
    await writeFile(`${output}/failure.png`, Buffer.from(shot.data, 'base64'));
    console.error('Browser state', await evaluate(`({dataset:{...document.querySelector('canvas')?.dataset},text:document.body.innerText})`));
  } catch {}
  throw error;
} finally {
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  for (const p of pending.values()) clearTimeout(p.timer);
  if (endpoint && targetId) await fetch(`${endpoint}/json/close/${targetId}`).catch(() => {});
  if (browser) {browser.kill(); await sleep(400);}
  if (profile) await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200}).catch(() => {});
}
