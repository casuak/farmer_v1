// Real Chromium/CDP against the existing preview. Never starts a game server
// or patches runtime/CSS. Usage: node scripts/verify-hud-layout-browser.mjs [URL]
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile, mkdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5177';
const viewports = [
  {width: 1440, height: 900, mobile: false, name: 'desktop'},
  {width: 1024, height: 768, mobile: false, name: 'tablet'},
  {width: 390, height: 844, mobile: true, name: 'mobile'},
  {width: 390, height: 600, mobile: true, name: 'mobile-short'},
  {width: 844, height: 390, mobile: true, name: 'mobile-landscape'},
];
const profile = await mkdtemp(path.join(tmpdir(), 'pinebrook-hud-layout-'));
const browser = spawn(process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--window-size=1440,900', 'about:blank',
], {stdio: 'ignore'});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map(), errors = [], screenshots = [], results = [], failures = [];
let ws, sequence = 0, call, evaluate, browserError;
browser.on('error', error => { browserError = error; });

try {
  await mkdir('.cache', {recursive: true});
  let port;
  for (let i = 0; i < 100; i++) {
    if (browserError) throw browserError;
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await sleep(100); }
  }
  assert(port, 'Chrome debugging endpoint opened');
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
  const tab = tabs.find(candidate => candidate.type === 'page');
  assert(tab, 'Chrome page target exists');
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      console.error('Browser console:', message.params.args.map(arg => arg.value ?? arg.description).join(' '));
    }
  };
  call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 20000);
    pending.set(id, {resolve, reject, timer});
    ws.send(JSON.stringify({id, method, params}));
  });
  evaluate = async expression => {
    const result = await call('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (expression, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = await evaluate(expression);
      if (value) return value;
      await sleep(25);
    }
    throw new Error(`Timed out waiting: ${expression}`);
  };
  const shot = async name => {
    const image = await call('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
    const file = `.cache/hud-layout-${name}.png`;
    await writeFile(file, Buffer.from(image.data, 'base64'));
    screenshots.push(file);
  };
  const ready = `document.querySelector('.dodge-button')?.dataset.dodgeReady === 'true' &&
    !document.querySelector('.dodge-button').disabled &&
    Number(document.querySelector('canvas').dataset.dodgeCooldown) === 0`;
  const state = () => evaluate(`(() => {
    const canvas = document.querySelector('canvas'), button = document.querySelector('.dodge-button');
    return {count: Number(canvas.dataset.dodgeCount), cooldown: Number(canvas.dataset.dodgeCooldown),
      active: canvas.dataset.dodgeActive, buttonCooldown: Number(button.dataset.dodgeCooldown),
      disabled: button.disabled, ready: button.dataset.dodgeReady,
      label: button.querySelector('small').textContent, fill: button.querySelector('.dodge-recharge i').style.width};
  })()`);
  const space = async () => {
    await evaluate(`document.querySelector('canvas').focus()`);
    for (const type of ['keyDown', 'keyUp']) {
      await call('Input.dispatchKeyEvent', {type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32});
    }
  };
  const pointer = async (touch, selector = '.dodge-button') => {
    const point = await evaluate(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x: r.left + r.width / 2, y: r.top + r.height / 2};
    })()`);
    if (touch) {
      await call('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{...point, id: 0}]});
      await call('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    } else {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await call('Input.dispatchMouseEvent', {type, ...point, button: 'left', clickCount: 1});
      }
    }
  };
  const roll = async (input, trigger, screenshot) => {
    await wait(ready);
    const before = await state();
    await trigger();
    await wait(`Number(document.querySelector('canvas').dataset.dodgeCount) > ${before.count} &&
      Number(document.querySelector('.dodge-button').dataset.dodgeCooldown) > 0`, 5000);
    const cooling = await state();
    assert.equal(cooling.count, before.count + 1, `${input}: exactly one real roll`);
    assert(cooling.cooldown > 0 && cooling.buttonCooldown > 0, `${input}: runtime and HUD enter cooldown`);
    assert(cooling.disabled && cooling.ready === 'false', `${input}: cooldown disables the HUD button`);
    assert.match(cooling.label, /翻滚中|\d+\.\d+s/, `${input}: visible cooldown label`);
    assert(parseFloat(cooling.fill) < 100, `${input}: recharge meter is not full`);
    if (screenshot) await shot(screenshot);
    await wait(ready);
    const recovered = await state();
    assert.equal(recovered.label, '就绪', `${input}: cooldown recovers`);
    assert.equal(parseFloat(recovered.fill), 100, `${input}: recharge meter fills`);
    return {input, beforeCount: before.count, cooling, recovered};
  };

  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', {width: 1440, height: 900, deviceScaleFactor: 1, mobile: false});
  await call('Page.navigate', {url});
  await wait(`document.querySelector('canvas')?.dataset.renderStatus === 'ready'`, 60000);

  for (const viewport of viewports) {
    const {width, height, mobile, name} = viewport;
    await call('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile});
    await call('Emulation.setTouchEmulationEnabled', {enabled: mobile, maxTouchPoints: 1});
    await sleep(400);
    await wait(ready);
    const layout = await evaluate(`(() => {
      const rect = selector => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const r = element.getBoundingClientRect(), style = getComputedStyle(element);
        return {left: r.left, top: r.top, right: r.right, bottom: r.bottom,
          width: r.width, height: r.height, x: r.left + r.width / 2, y: r.top + r.height / 2,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && r.width > 0 && r.height > 0};
      };
      const dodge = rect('.dodge-button'), runControl = rect('.run-control'), runButton = rect('.run-control .movement-toggle');
      const hit = dodge && document.elementFromPoint(dodge.x, dodge.y);
      const runHit = runButton && document.elementFromPoint(runButton.x, runButton.y);
      return {viewport: {width: innerWidth, height: innerHeight}, coarsePointer: matchMedia('(pointer:coarse)').matches,
        removed: Object.fromEntries(['.brand', '.chapter', '.zoom-control', '.interact-button'].map(selector => [selector, document.querySelectorAll(selector).length])),
        runControl, runButton, hitRun: !!runHit?.closest('.movement-toggle'),
        inMovementCorner: !!document.querySelector('.movement-corner .dodge-button'), dodge,
        place: rect('.movement-corner .place'),
        hitDodge: !!hit?.closest('.dodge-button'),
        obstacles: Object.fromEntries(['.inventory-dock', '.touch-pad', '.controls', '.movement-help'].map(selector => [selector, rect(selector)]))};
    })()`);
    const record = {name, width, height, mobile, layout, checks: [], interactions: []};
    results.push(record);
    const check = (condition, description) => {
      record.checks.push({description, passed: !!condition});
      if (!condition) failures.push(`${width}x${height}: ${description}`);
    };
    check(layout.viewport.width === width && layout.viewport.height === height, 'CSS viewport matches requested dimensions');
    for (const [selector, count] of Object.entries(layout.removed)) check(count === 0, `${selector} has no DOM nodes (including hidden nodes)`);
    check(layout.inMovementCorner, 'Dodge belongs to movement-corner');
    const dodge = layout.dodge;
    check(dodge?.visible, 'Dodge is visible');
    check(dodge && dodge.left >= 0 && dodge.top >= 0 && dodge.right <= width && dodge.bottom <= height, 'Dodge fits entirely inside viewport');
    check(dodge && dodge.x < width / 2, 'Dodge center x is in the left half');
    check(layout.hitDodge, 'Dodge center is not occluded and receives pointer input');
    for (const [selector, obstacle] of Object.entries(layout.obstacles)) {
      check(!!obstacle, `${selector} exists for overlap verification`);
      const overlap = dodge && obstacle?.visible && Math.min(dodge.right, obstacle.right) - Math.max(dodge.left, obstacle.left) > 0.5 &&
        Math.min(dodge.bottom, obstacle.bottom) - Math.max(dodge.top, obstacle.top) > 0.5;
      check(!overlap, `Dodge does not overlap visible ${selector}`);
    }
    check(!!layout.place, 'Place belongs to movement-corner');
    if (layout.place?.visible) {
      const place = layout.place;
      check(place.left >= 0 && place.top >= 0 && place.right <= width && place.bottom <= height, 'Visible place fits inside viewport');
      for (const [selector, obstacle] of Object.entries({'.dodge-button': dodge, ...layout.obstacles})) {
        const overlap = obstacle?.visible && Math.min(place.right, obstacle.right) - Math.max(place.left, obstacle.left) > 0.5 &&
          Math.min(place.bottom, obstacle.bottom) - Math.max(place.top, obstacle.top) > 0.5;
        check(!overlap, `Place does not overlap visible ${selector}`);
      }
    }
    for (const [selector, run] of Object.entries({'.run-control': layout.runControl, '.movement-toggle': layout.runButton})) {
      check(run?.visible, `${selector} is visible`);
      check(run && run.left >= 0 && run.top >= 0 && run.right <= width && run.bottom <= height, `${selector} fits entirely inside viewport`);
      check(run && run.x < width / 2, `${selector} center x is in the left half`);
      for (const [otherSelector, obstacle] of Object.entries({'.dodge-button': dodge, '.place': layout.place, ...layout.obstacles})) {
        const overlap = run && obstacle?.visible && Math.min(run.right, obstacle.right) - Math.max(run.left, obstacle.left) > 0.5 &&
          Math.min(run.bottom, obstacle.bottom) - Math.max(run.top, obstacle.top) > 0.5;
        check(!overlap, `${selector} does not overlap visible ${otherSelector}`);
      }
    }
    check(layout.hitRun, 'Run button center is not occluded and receives pointer input');
    await shot(`${name}-${width}x${height}`);
    try {
      const selector = '.run-control .movement-toggle';
      const before = await evaluate(`document.querySelector('${selector}').getAttribute('aria-pressed')`);
      assert(['true', 'false'].includes(before), 'Run button exposes boolean aria-pressed');
      await pointer(false, selector);
      await wait(`document.querySelector('${selector}').getAttribute('aria-pressed') === '${before === 'true' ? 'false' : 'true'}'`, 5000);
      const toggled = await evaluate(`({pressed: document.querySelector('${selector}').getAttribute('aria-pressed'),
        text: document.querySelector('${selector}').textContent, speed: document.querySelector('canvas').dataset.speed})`);
      assert.equal(toggled.speed, toggled.pressed === 'true' ? '9' : '6', 'Run click changes actual runtime movement speed');
      // Restore the starting state with a second real input; use touch on mobile.
      await pointer(mobile, selector);
      await wait(`document.querySelector('${selector}').getAttribute('aria-pressed') === '${before}'`, 5000);
      record.interactions.push({input: 'run-toggle', before, toggled, restored: before, restoreInput: mobile ? 'touch' : 'click'});
    } catch (error) {
      failures.push(`${width}x${height} run-toggle: ${error.message}`);
      record.interactions.push({input: 'run-toggle', error: error.message});
    }
    // Use actual CDP mouse/touch/keyboard events; never invoke the game API or
    // synthetic DOM click. Each viewport verifies both pointer and Space input.
    for (const [input, trigger] of [['click', () => pointer(false)], ['Space', space], ...(mobile ? [['touch', () => pointer(true)]] : [])]) {
      try {
        record.interactions.push(await roll(input, trigger,
          input === 'click' && (name === 'desktop' || name === 'mobile') ? `${name}-cooldown` : undefined));
      } catch (error) {
        const failure = `${width}x${height} ${input}: ${error.message}`;
        failures.push(failure);
        record.interactions.push({input, error: error.message});
      }
    }
    console.log(JSON.stringify({viewport: `${width}x${height}`, dodge, runControl: layout.runControl, runButton: layout.runButton, failures: failures.filter(failure => failure.startsWith(`${width}x${height}`))}));
  }
  if (errors.length) failures.push(...errors.map(error => `Runtime exception: ${error}`));
  const report = {result: failures.length ? 'failed' : 'passed', url, results, failures, errors, screenshots};
  await writeFile('.cache/hud-layout-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({result: report.result, url, viewports: results.length, failures, screenshots, report: '.cache/hud-layout-results.json'}));
  assert.equal(failures.length, 0, failures.join('\n'));
} catch (error) {
  if (call) {
    try {
      const image = await call('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
      await writeFile('.cache/hud-layout-failure.png', Buffer.from(image.data, 'base64'));
      console.error('HUD failure state:', await evaluate(`({canvas: {...document.querySelector('canvas')?.dataset}, text: document.body.innerText})`));
    } catch { /* Preserve the original failure if Chrome has already closed. */ }
  }
  throw error;
} finally {
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  browser.kill();
  await sleep(400);
  await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200}).catch(() => {});
}
