export type DialogueSpeaker = {
  name: string;
  color: string;
  line: string;
  injured?: boolean;
  panicking?: boolean;
};

export type DialogueChoice = { id: string; label: string; next: string | null };
export type DialogueNode = {
  id: string;
  lines: string[];
  choices?: DialogueChoice[];
  next?: string | null;
};
export type DialogueScript = { start: string; nodes: Record<string, DialogueNode> };
export type DialogueSnapshot = {
  active: boolean;
  speaker: DialogueSpeaker | null;
  nodeId: string;
  lineIndex: number;
  text: string;
  visibleText: string;
  typing: boolean;
  choices: DialogueChoice[];
  serial: number;
};

const LETTER_SECONDS = 0.035;
const PUNCTUATION_SECONDS = 0.105;
const BLIP_SECONDS = 0.055;
const EPSILON = 1e-9;
const silent = new RegExp("^[\\s\\p{P}]+$", "u");
const punctuation = new RegExp("^\\p{P}+$", "u");

function graphemes(text: string): string[] {
  // Segmenter keeps combining accents, flags, skin tones and ZWJ families intact.
  // Older runtimes conservatively reveal the whole line rather than split emoji.
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return [text];
  return Array.from(new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text), part => part.segment);
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Validate the complete graph (including unreachable nodes), then own its data. */
function copyScript(script: DialogueScript): DialogueScript {
  const fail = (reason: string): never => { throw new Error(`Invalid dialogue script: ${reason}`); };
  if (!script || !validText(script.start) || !script.nodes || typeof script.nodes !== "object" || Array.isArray(script.nodes)) {
    return fail("missing start or nodes");
  }
  const owns = (id: string) => Object.prototype.hasOwnProperty.call(script.nodes, id);
  if (!owns(script.start)) return fail("start node does not exist");
  const validNext = (next: unknown) => next === null || (validText(next) && owns(next));
  const nodes: Record<string, DialogueNode> = Object.create(null);
  for (const [id, node] of Object.entries(script.nodes)) {
    if (!validText(id) || !node || node.id !== id) return fail(`node id mismatch: ${id}`);
    if (!Array.isArray(node.lines) || !node.lines.length || !Array.from(node.lines).every(validText)) return fail(`empty or invalid lines: ${id}`);
    if (node.next !== undefined && !validNext(node.next)) return fail(`invalid next: ${id}`);
    let choices: DialogueChoice[] | undefined;
    if (node.choices !== undefined) {
      if (!Array.isArray(node.choices)) return fail(`invalid choices: ${id}`);
      const ids = new Set<string>();
      choices = [];
      for (const choice of node.choices) {
        if (!choice || !validText(choice.id) || !validText(choice.label) || ids.has(choice.id) || !validNext(choice.next)) {
          return fail(`invalid or duplicate choice: ${id}`);
        }
        ids.add(choice.id);
        choices.push({ id: choice.id, label: choice.label, next: choice.next });
      }
    }
    nodes[id] = { id, lines: [...node.lines], ...(choices ? { choices } : {}), ...(node.next !== undefined ? { next: node.next } : {}) };
  }
  return { start: script.start, nodes };
}

/** Pure synchronous state machine: no DOM, audio objects, wall clock or timers. */
export class DialogueModel {
  private script: DialogueScript | null = null;
  private speaker: DialogueSpeaker | null = null;
  private nodeId = "";
  private lineIndex = 0;
  private segments: string[] = [];
  private revealed = 0;
  private untilLetter = LETTER_SECONDS;
  private serial = 0;
  private clock = 0;
  // Keep the audio cooldown across line changes and restarts to prevent bursts.
  private lastBlip = -Infinity;

  get active(): boolean { return this.script !== null; }

  start(speaker: DialogueSpeaker, script: DialogueScript): void {
    const validated = copyScript(script);
    this.speaker = { ...speaker };
    this.script = validated;
    this.enter(validated.start);
  }

  snapshot(): DialogueSnapshot {
    const node = this.script?.nodes[this.nodeId];
    const typing = this.active && this.revealed < this.segments.length;
    const choices = node && !typing && this.lineIndex === node.lines.length - 1 ? node.choices ?? [] : [];
    return {
      active: this.active,
      speaker: this.speaker ? { ...this.speaker } : null,
      nodeId: this.nodeId,
      lineIndex: this.lineIndex,
      text: node?.lines[this.lineIndex] ?? "",
      visibleText: this.segments.slice(0, this.revealed).join(""),
      typing,
      choices: choices.map(choice => ({ ...choice })),
      serial: this.serial,
    };
  }

  update(dt: number): { changed: boolean; blips: number } {
    if (!Number.isFinite(dt) || dt <= 0) return { changed: false, blips: 0 };
    const elapsed = Math.min(dt, 0.1);
    this.clock += elapsed;
    if (!this.active || this.revealed === this.segments.length) return { changed: false, blips: 0 };
    this.untilLetter -= elapsed;
    let changed = false;
    let audible = false;
    while (this.untilLetter <= EPSILON && this.revealed < this.segments.length) {
      const letter = this.segments[this.revealed++];
      changed = true;
      audible ||= !silent.test(letter);
      this.untilLetter += punctuation.test(letter) ? PUNCTUATION_SECONDS : LETTER_SECONDS;
    }
    // Never queue dropped blips: only characters revealed in this update count.
    const blips = audible && this.clock - this.lastBlip + EPSILON >= BLIP_SECONDS ? 1 : 0;
    if (blips) this.lastBlip = this.clock;
    return { changed, blips };
  }

  advance(): void {
    const node = this.script?.nodes[this.nodeId];
    if (!node) return;
    if (this.revealed < this.segments.length) {
      this.revealed = this.segments.length;
      this.untilLetter = LETTER_SECONDS;
      return;
    }
    if (this.lineIndex < node.lines.length - 1) {
      this.lineIndex++;
      this.beginLine();
    } else if (!node.choices?.length) {
      if (node.next != null) this.enter(node.next);
      else this.close();
    }
  }

  choose(id: string): void {
    const node = this.script?.nodes[this.nodeId];
    if (!node || this.revealed < this.segments.length || this.lineIndex !== node.lines.length - 1) return;
    const choice = node.choices?.find(candidate => candidate.id === id);
    if (!choice) return;
    if (choice.next === null) this.close();
    else this.enter(choice.next);
  }

  close(): void {
    this.script = null;
    this.speaker = null;
    this.nodeId = "";
    this.lineIndex = 0;
    this.segments = [];
    this.revealed = 0;
    this.untilLetter = LETTER_SECONDS;
  }

  private enter(id: string): void {
    this.nodeId = id;
    this.lineIndex = 0;
    this.beginLine();
  }

  private beginLine(): void {
    this.segments = graphemes(this.script!.nodes[this.nodeId].lines[this.lineIndex]);
    this.revealed = 0;
    this.untilLetter = LETTER_SECONDS;
    this.serial++;
  }
}
