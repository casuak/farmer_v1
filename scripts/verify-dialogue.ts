import assert from "node:assert/strict";
import { DialogueModel, type DialogueScript, type DialogueSpeaker } from "../components/game/dialogue";
import { dialogueFor } from "../components/game/dialogueContent";

const speaker: DialogueSpeaker = { name: "莉芙", color: "#c49389", line: "原本的农场提示" };
const fixture = (): DialogueScript => ({
  start: "hello",
  nodes: {
    hello: { id: "hello", lines: ["你好，春天！", "再聊一会儿。"], choices: [
      { id: "farm", label: "聊种田", next: "farm" },
      { id: "bye", label: "告别", next: null },
    ] },
    farm: { id: "farm", lines: ["记得浇水。", "收成后整理背包。"], next: "followup" },
    followup: { id: "followup", lines: ["还想聊吗？"], choices: [
      { id: "back", label: "回去", next: "hello" },
      { id: "bye", label: "告别", next: "end" },
    ] },
    end: { id: "end", lines: ["回头见！"], next: null },
  },
});
function single(text: string): DialogueScript {
  return { start: "one", nodes: { one: { id: "one", lines: [text] } } };
}
function finishNode(model: DialogueModel): void {
  const id = model.snapshot().nodeId;
  // Finish every line, stopping before following next or selecting a choice.
  for (let guard = 0; guard < 100; guard++) {
    const snap = model.snapshot();
    assert.equal(snap.nodeId, id);
    if (snap.typing) model.advance();
    const done = model.snapshot();
    if (done.choices.length || !done.active) return;
    // Test callers use explicit line counts for choice-less nodes.
    if (done.nodeId === "hello" && done.lineIndex === 0) model.advance();
    else return;
  }
  assert.fail("finishNode did not settle");
}
let checks = 0;
function test(name: string, run: () => void) {
  run();
  checks++;
  console.log(`✓ ${name}`);
}

test("inactive, close, and input methods are repeatable no-ops", () => {
  const model = new DialogueModel();
  const initial = model.snapshot();
  assert.deepEqual(initial, { active: false, speaker: null, nodeId: "", lineIndex: 0, text: "", visibleText: "", typing: false, choices: [], serial: 0 });
  model.advance(); model.choose("missing"); model.close(); model.close();
  assert.deepEqual(model.update(0.1), { changed: false, blips: 0 });
  assert.deepEqual(model.snapshot(), initial);
});

test("typing cadence, punctuation pause and natural end", () => {
  const model = new DialogueModel(); model.start(speaker, single("春，天"));
  assert.equal(model.snapshot().visibleText, "");
  assert.deepEqual(model.update(0.034), { changed: false, blips: 0 });
  assert.deepEqual(model.update(0.001), { changed: true, blips: 1 });
  assert.equal(model.snapshot().visibleText, "春");
  assert.deepEqual(model.update(0.035), { changed: true, blips: 0 });
  assert.equal(model.snapshot().visibleText, "春，");
  assert.deepEqual(model.update(0.1), { changed: false, blips: 0 });
  assert.deepEqual(model.update(0.005), { changed: true, blips: 1 });
  assert.equal(model.snapshot().visibleText, "春，天");
  assert.equal(model.snapshot().typing, false);
  assert.equal(model.active, true, "natural typing never auto-closes");
  model.advance(); assert.equal(model.active, false);
});

test("advance only fills typing; next line clears bubble and increments serial", () => {
  const model = new DialogueModel(); model.start(speaker, fixture());
  const firstSerial = model.snapshot().serial;
  model.update(0.035); model.advance();
  assert.equal(model.snapshot().visibleText, "你好，春天！");
  assert.equal(model.snapshot().lineIndex, 0);
  assert.equal(model.snapshot().serial, firstSerial);
  assert.deepEqual(model.snapshot().choices, []);
  assert.deepEqual(model.update(0.1), { changed: false, blips: 0 }, "skip queues no audio");
  model.advance();
  assert.equal(model.snapshot().lineIndex, 1);
  assert.equal(model.snapshot().visibleText, "");
  assert.equal(model.snapshot().typing, true);
  assert.equal(model.snapshot().serial, firstSerial + 1);
  assert.deepEqual(model.snapshot().choices, []);
  model.advance();
  assert.equal(model.snapshot().choices.length, 2);
  const waiting = model.snapshot();
  for (let i = 0; i < 10; i++) model.advance();
  assert.deepEqual(model.snapshot(), waiting, "advance cannot select an option");
});

test("choice gating, invalid options, double click, next nodes and followup", () => {
  const model = new DialogueModel(); model.start(speaker, fixture());
  const first = model.snapshot(); model.choose("farm"); assert.deepEqual(model.snapshot(), first);
  model.advance(); model.choose("farm"); assert.equal(model.snapshot().nodeId, "hello");
  model.advance(); model.choose("farm"); assert.equal(model.snapshot().nodeId, "hello");
  model.advance();
  const ready = model.snapshot(); model.choose("bogus"); assert.deepEqual(model.snapshot(), ready);
  model.choose("farm");
  const farm = model.snapshot();
  assert.equal(farm.nodeId, "farm"); assert.equal(farm.visibleText, ""); assert.equal(farm.lineIndex, 0);
  assert.equal(farm.serial, ready.serial + 1);
  model.choose("farm"); model.choose("bye"); assert.deepEqual(model.snapshot(), farm, "duplicate click cannot skip new typing");
  model.advance(); model.advance(); model.advance();
  assert.equal(model.snapshot().lineIndex, 1);
  const lastSerial = model.snapshot().serial;
  model.advance();
  assert.equal(model.snapshot().nodeId, "followup"); assert.equal(model.snapshot().visibleText, "");
  assert.equal(model.snapshot().serial, lastSerial + 1); assert.deepEqual(model.snapshot().choices, []);
  model.advance(); model.choose("back");
  assert.equal(model.snapshot().nodeId, "hello"); assert.equal(model.snapshot().lineIndex, 0);
  finishNode(model); model.choose("bye"); assert.equal(model.active, false);
  model.start(speaker, { ...fixture(), start: "followup" }); model.advance(); model.choose("bye");
  assert.equal(model.snapshot().nodeId, "end"); model.advance(); model.advance(); assert.equal(model.active, false);
});

test("close clears state, restart starts from scratch with no stale progress", () => {
  const model = new DialogueModel(); model.start(speaker, fixture()); model.update(0.034);
  const serial = model.snapshot().serial; model.close();
  assert.equal(model.snapshot().speaker, null); assert.equal(model.snapshot().text, ""); assert.equal(model.snapshot().visibleText, "");
  const closed = model.snapshot(); model.close(); model.update(0.1); assert.deepEqual(model.snapshot(), closed);
  model.start({ ...speaker, name: "阿松" }, fixture());
  assert.equal(model.snapshot().serial, serial + 1); assert.equal(model.snapshot().speaker?.name, "阿松");
  model.update(0.001); assert.equal(model.snapshot().visibleText, "");
  model.update(0.034); assert.equal(model.snapshot().visibleText, "你");
  model.advance(); model.advance(); model.start(speaker, fixture());
  assert.equal(model.snapshot().lineIndex, 0); assert.equal(model.snapshot().visibleText, "");
});

test("Chinese, combining marks, emoji families, flags, keycaps and skin tones are graphemes", () => {
  const units = ["中", "👨‍👩‍👧‍👦", "🇨🇳", "👍🏽", "e\u0301", "1️⃣", "🌱", "文"];
  const model = new DialogueModel(); model.start(speaker, single(units.join("")));
  for (let i = 0; i < units.length; i++) {
    model.update(0.035);
    assert.equal(model.snapshot().visibleText, units.slice(0, i + 1).join(""));
  }
  assert.equal(model.snapshot().typing, false);
});

test("legacy Segmenter fallback never splits text; lifecycle needs no timers or Audio", () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const segmenter = Object.getOwnPropertyDescriptor(Intl, "Segmenter");
  try {
    Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined });
    for (const key of ["setTimeout", "setInterval", "requestAnimationFrame", "Audio", "AudioContext"]) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, get() { assert.fail(`model accessed ${key}`); } });
    }
    const model = new DialogueModel();
    const text = "一家人👨‍👩‍👧‍👦一起种田🌱";
    model.start(speaker, single(text)); model.update(0.035);
    assert.equal(model.snapshot().visibleText, text);
    model.close(); model.close(); model.update(0.1);
    model.start(speaker, fixture()); model.advance(); model.advance(); model.advance(); model.choose("farm"); model.close();
  } finally {
    if (segmenter) Object.defineProperty(Intl, "Segmenter", segmenter);
    else Reflect.deleteProperty(Intl, "Segmenter");
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("blips are throttled, at most one per update, and never queued by whitespace or punctuation", () => {
  const model = new DialogueModel(); model.start(speaker, single("春".repeat(200)));
  let time = 0, last = -Infinity, count = 0;
  for (const dt of Array.from({ length: 140 }, (_, i) => [0.016, 0.035, 0.08, 0.001][i % 4])) {
    time += dt; const { blips } = model.update(dt);
    assert(blips === 0 || blips === 1);
    if (blips) { assert(time - last >= 0.055 - 1e-9); last = time; count++; }
  }
  assert(count > 10);
  const batch = new DialogueModel(); batch.start(speaker, single("一二三四五六七八九"));
  assert.equal(batch.update(0.1).blips, 1); assert.equal(batch.snapshot().visibleText, "一二");
  const quiet = new DialogueModel(); quiet.start(speaker, single(" ，。！？…—\n\t"));
  for (let i = 0; i < 30; i++) assert.equal(quiet.update(0.1).blips, 0);
  const noQueue = new DialogueModel(); noQueue.start(speaker, single("甲乙，"));
  assert.equal(noQueue.update(0.035).blips, 1); assert.equal(noQueue.update(0.035).blips, 0);
  assert.equal(noQueue.update(0.035).blips, 0, "a previous throttled letter is not replayed on punctuation");
  const restart = new DialogueModel(); restart.start(speaker, single("甲")); assert.equal(restart.update(0.035).blips, 1);
  restart.close(); restart.start(speaker, single("乙")); assert.equal(restart.update(0.035).blips, 0, "restart preserves anti-burst cooldown");
});

test("invalid dt cannot poison state, and long frames are capped at 0.1 seconds", () => {
  const model = new DialogueModel(); model.start(speaker, single("春".repeat(100)));
  for (const dt of [0, -1, NaN, Infinity, -Infinity, undefined, null, "1"] as unknown as number[]) {
    const before = model.snapshot(); assert.deepEqual(model.update(dt), { changed: false, blips: 0 }); assert.deepEqual(model.snapshot(), before);
  }
  assert.equal(model.update(9999).blips, 1); assert.equal(model.snapshot().visibleText, "春春");
  model.update(0.005); assert.equal(model.snapshot().visibleText, "春春春");
});

test("mute is an audio-layer concern: two models emit identical intentions without audio globals", () => {
  const audible = new DialogueModel(), muted = new DialogueModel();
  audible.start(speaker, fixture()); muted.start(speaker, fixture());
  const played: number[] = [];
  for (let i = 0; i < 60; i++) {
    const a = audible.update(0.016), b = muted.update(0.016);
    assert.deepEqual(a, b); assert.deepEqual(audible.snapshot(), muted.snapshot());
    if (a.blips) played.push(i); // A muted engine simply does not consume b.blips.
  }
  assert(played.length > 0);
});

test("script validation rejects malformed graphs atomically", () => {
  const model = new DialogueModel(); model.start(speaker, fixture()); model.update(0.035);
  const baseline = model.snapshot();
  const invalid: unknown[] = [
    null, {}, { start: "missing", nodes: {} }, { start: "hello", nodes: [] },
    { start: "one", nodes: { one: null } },
    { start: "one", nodes: { one: { id: "different", lines: ["你好"] } } },
    { start: "one", nodes: { one: { id: "one", lines: [] } } },
    { start: "one", nodes: { one: { id: "one", lines: [""] } } },
    { start: "one", nodes: { one: { id: "one", lines: [" \n "] } } },
    { start: "one", nodes: { one: { id: "one", lines: [3] } } },
    { start: "one", nodes: { one: { id: "one", lines: Array(2) } } },
    { start: "one", nodes: { one: { id: "one", lines: ["你好"], next: "missing" } } },
    { start: "one", nodes: { one: { id: "one", lines: ["你好"], choices: null } } },
    { start: "one", nodes: { one: { id: "one", lines: ["你好"], choices: [{ id: "x", label: "X", next: "missing" }] } } },
    { start: "one", nodes: { one: { id: "one", lines: ["你好"], choices: [{ id: "x", label: "X" }] } } },
    { start: "one", nodes: { one: { id: "one", lines: ["你好"], choices: [{ id: "", label: "X", next: null }] } } },
    { start: "one", nodes: { one: { id: "one", lines: ["你好"], choices: [{ id: "x", label: " ", next: null }] } } },
    { start: "one", nodes: { one: { id: "one", lines: ["你好"], choices: [{ id: "x", label: "X", next: null }, { id: "x", label: "Y", next: null }] } } },
    { ...single("你好"), nodes: { ...single("你好").nodes, unused: { id: "unused", lines: [] } } },
    { start: "toString", nodes: {} },
  ];
  for (const script of invalid) {
    assert.throws(() => model.start(speaker, script as DialogueScript), /Invalid dialogue script/);
    assert.deepEqual(model.snapshot(), baseline);
  }
  const emptyChoices = single("你好"); emptyChoices.nodes.one.choices = [];
  model.start(speaker, emptyChoices); model.advance(); model.advance(); assert.equal(model.active, false);
  const loop = single("绕一圈"); loop.nodes.one.next = "one";
  model.start(speaker, loop); model.advance(); const serial = model.snapshot().serial; model.advance();
  assert.equal(model.snapshot().serial, serial + 1); assert.equal(model.snapshot().visibleText, "");
});

test("caller scripts and snapshots cannot mutate a running conversation", () => {
  const script = fixture(), who = { ...speaker }, model = new DialogueModel(); model.start(who, script);
  script.nodes.hello.lines[0] = "被修改"; script.nodes.hello.choices![0].next = null; who.name = "改名";
  assert.equal(model.snapshot().text, "你好，春天！"); assert.equal(model.snapshot().speaker?.name, "莉芙");
  finishNode(model);
  const snapshot = model.snapshot(); snapshot.choices[0].next = null; snapshot.speaker!.name = "又改名";
  model.choose("farm"); assert.equal(model.snapshot().nodeId, "farm"); assert.equal(model.snapshot().speaker?.name, "莉芙");
});

test("five residents have multi-line welcomes, topic branches, followups, return menus and goodbyes", () => {
  for (const name of ["莉芙", "阿松", "米娅", "奥利", "艾达"]) {
    const script = dialogueFor({ ...speaker, name });
    const welcome = script.nodes[script.start];
    assert(welcome.lines.length >= 2); assert.equal(welcome.choices?.length, 3);
    const model = new DialogueModel(); model.start({ ...speaker, name }, script);
    const visited = new Set<string>(), queue = [script.start];
    while (queue.length) {
      const id = queue.shift()!; if (visited.has(id)) continue; visited.add(id);
      const node = script.nodes[id];
      model.start({ ...speaker, name }, { ...script, start: id });
      for (let line = 0; line < node.lines.length; line++) {
        assert.equal(model.snapshot().visibleText, ""); assert.deepEqual(model.snapshot().choices, []);
        model.advance(); assert.equal(model.snapshot().visibleText, node.lines[line]);
        if (line < node.lines.length - 1) { assert.deepEqual(model.snapshot().choices, []); model.advance(); }
      }
      if (node.choices?.length) {
        assert.deepEqual(model.snapshot().choices, node.choices);
        for (const choice of node.choices) {
          const branch = new DialogueModel(); branch.start(speaker, { ...script, start: id });
          for (let i = 0; i < node.lines.length; i++) { branch.advance(); if (i < node.lines.length - 1) branch.advance(); }
          branch.choose(choice.id);
          assert.equal(branch.active, choice.next !== null);
          if (choice.next !== null) { assert.equal(branch.snapshot().nodeId, choice.next); queue.push(choice.next); }
        }
      } else {
        model.advance(); assert.equal(model.active, node.next != null);
        if (node.next != null) { assert.equal(model.snapshot().nodeId, node.next); queue.push(node.next); }
      }
    }
    assert.equal(visited.size, Object.keys(script.nodes).length, `${name}: every node reachable`);
    for (const choice of welcome.choices!.slice(0, 2)) {
      const topic = script.nodes[choice.next!]; assert(topic.lines.length >= 2); assert.equal(topic.choices?.length, 3);
      const detail = script.nodes[topic.choices![0].next!]; assert(detail.lines.length >= 2); assert.equal(detail.next, "topics");
    }
    assert.equal(script.nodes.goodbye.next, null);
    // Content factory returns fresh arrays/choices even before the model clones it.
    welcome.lines[0] = "changed"; welcome.choices![0].label = "changed";
    assert.notEqual(dialogueFor({ ...speaker, name }).nodes.welcome.lines[0], "changed");
    for (const flags of [{ injured: true }, { panicking: true }, { injured: true, panicking: true }]) {
      const short = dialogueFor({ ...speaker, name, ...flags }); model.start(speaker, short);
      assert.equal(Object.keys(short.nodes).length, 1); assert.equal(short.nodes[short.start].lines.length, 1);
      model.advance(); assert.deepEqual(model.snapshot().choices, []); model.advance(); assert.equal(model.active, false);
    }
  }
});

test("unknown residents retain original npc.line as fallback", () => {
  for (const name of ["旅人", "toString", "__proto__"]) {
    const model = new DialogueModel(); model.start({ ...speaker, name }, dialogueFor({ ...speaker, name }));
    assert.equal(model.snapshot().text, speaker.line); model.advance(); model.advance(); assert.equal(model.active, false);
  }
  const blank = { ...speaker, name: "旅人", line: " " };
  const model = new DialogueModel(); assert.doesNotThrow(() => model.start(blank, dialogueFor(blank)));
});

console.log(`Dialogue verification passed: ${checks} suites (pure model + all five NPC graphs).`);
