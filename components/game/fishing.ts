import { InventoryModel, ITEMS, isEquipmentSlot } from "./inventory";
import type { FishId } from "./inventory";
import { BOUNDS, isWater, isSea, onBridge, onDock } from "./geography";

export type FishingPhase = "idle" | "charging" | "casting" | "waiting" | "bite" | "reeling" | "catching" | "escaped";
export type FishingSpot = { x: number; z: number; kind: "river" | "sea" };
export type FishCatch = { id: FishId; length: number; perfect: boolean };

/** Species table: name sourced from ITEMS (kept identical), length roll range (cm) and difficulty scaling. */
export const FISH: Record<FishId, { name: string; minLength: number; maxLength: number; difficulty: number }> = {
  carp: { name: ITEMS.carp.name, minLength: 18, maxLength: 45, difficulty: 0.4 },
  perch: { name: ITEMS.perch.name, minLength: 15, maxLength: 38, difficulty: 0.75 },
  sardine: { name: ITEMS.sardine.name, minLength: 8, maxLength: 20, difficulty: 1.5 },
  redSnapper: { name: ITEMS.redSnapper.name, minLength: 26, maxLength: 55, difficulty: 2.5 },
};

export const FISHING = {
  castSeconds: 0.65,
  chargeSeconds: 1.1,
  biteSeconds: 1.65,
  jumpSeconds: 0.8,
  flySeconds: 0.75,
  catchSeconds: 1.55,
  escapeSeconds: 1.25,
  barSize: 0.28,
  minRange: 1.15,
  maxRange: 5.8,
  waitMin: 2,
  waitMax: 4,
  barUp: 0.85,
  barDown: 0.85,
  progressUp: 0.17,
  progressDown: 0.13,
  progressStart: 0.35,
  graceSeconds: 1,
  reelTimeout: 35,
  substep: 1 / 120,
} as const;

export type FishingSnapshot = {
  phase: FishingPhase;
  phaseTime: number;
  castPower: number;
  spot: FishingSpot | null;
  fish: FishCatch | null;
  fishPosition: number;
  barPosition: number;
  barSize: number;
  progress: number;
  inBar: boolean;
  perfect: boolean;
  held: boolean;
  message: string;
  canCast: boolean;
};

const BAR_HALF = FISHING.barSize / 2;
const BAR_MIN = BAR_HALF;
const BAR_MAX = 1 - BAR_HALF;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Triangle wave that rises from 0 to 1 over `FISHING.chargeSeconds` then falls
 * back to 0 over the same duration, repeating every 2·chargeSeconds (2.2s full
 * round trip). NaN and negative values are coerced safely to 0.
 */
export function castPowerAt(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  const t = seconds % (2 * FISHING.chargeSeconds);
  return 1 - Math.abs(t / FISHING.chargeSeconds - 1);
}

export class FishingModel {
  /** Parent-published readiness flag (default false). The model never writes it. */
  canCast = false;
  private _phase: FishingPhase = "idle";
  private phaseTime = 0;
  private castPower = 0;
  private spot: FishingSpot | null = null;
  private fish: FishCatch | null = null;
  private pendingCatch: FishCatch | null = null;
  private readonly random: () => number;
  private waitFor = 0;
  private fishPosition = 0.5;
  private barPosition = 0.5;
  private progress = 0;
  private inBar = false;
  private perfect = false;
  private leftZone = false;
  private held = false;
  private message = "";
  private offsetA = 0;
  private offsetB = 0;

  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  get phase(): FishingPhase {
    return this._phase;
  }

  get active(): boolean {
    return this._phase !== "idle";
  }

  /**
   * Start a cast from idle, or fire a charged cast from `charging`. Requires a
   * valid water spot and no unclaimed catch. Casting from charging preserves the
   * released charge power (during `casting`/`waiting`) for state and debug; an
   * idle cast carries power 0.
   */
  cast(spot: FishingSpot): boolean {
    if ((this._phase !== "idle" && this._phase !== "charging") || this.pendingCatch) return false;
    if (!spot || !Number.isFinite(spot.x) || !Number.isFinite(spot.z)) return false;
    if (spot.kind !== "river" && spot.kind !== "sea") return false;
    if (Math.abs(spot.x) > BOUNDS.x || Math.abs(spot.z) > BOUNDS.z) return false;
    if (!isWater(spot.x, spot.z) || onBridge(spot.x, spot.z) || onDock(spot.x, spot.z)) return false;
    if (spot.kind !== (isSea(spot.x, spot.z) ? "sea" : "river")) return false;
    this.castPower = this._phase === "charging" ? castPowerAt(this.phaseTime) : 0;
    this._phase = "casting";
    this.phaseTime = 0;
    this.spot = { x: spot.x, z: spot.z, kind: spot.kind };
    this.fish = null;
    this.held = false;
    this.leftZone = false;
    this.progress = 0;
    this.fishPosition = 0.5;
    this.barPosition = 0.5;
    this.inBar = false;
    this.perfect = false;
    this.waitFor = FISHING.waitMin + this.random() * (FISHING.waitMax - FISHING.waitMin);
    this.message = "抛竿…";
    return true;
  }

  /**
   * Enter the charge wind-up. Only succeeds from idle with no unclaimed catch.
   * Starts the power at 0 and holds it (held=true); time accumulates in `update`
   * and the power oscillates via `castPowerAt`.
   */
  beginCharge(): boolean {
    if (this._phase !== "idle" || this.pendingCatch) return false;
    this._phase = "charging";
    this.phaseTime = 0;
    this.castPower = 0;
    this.held = true;
    this.message = "蓄力中…按住空格，松开发射";
    return true;
  }

  /** Bite -> hook the fish (held=true); reeling -> hold the bar up. Waiting cannot skip the bite. */
  press(): void {
    if (this._phase === "bite") {
      this.enterReeling();
    } else if (this._phase === "reeling") {
      this.held = true;
    }
  }

  /**
   * Clear the hold. In reeling the bar sinks; in charging this just clears the
   * hold and never fires the cast — the parent engine decides whether to cast.
   */
  release(): void {
    if (this._phase === "reeling" || this._phase === "charging") this.held = false;
  }

  /** Cancel back to idle. Catching is locked so the fish is always claimed. */
  cancel(): boolean {
    if (this._phase === "catching" || this._phase === "idle") return false;
    this.toIdle();
    return true;
  }

  /** Bounded sub-stepped simulation; 0 / NaN / negative are no-ops. Caps at 60s so UI never stalls. */
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this._phase === "idle") return;
    if (this._phase === "charging") {
      // Charging has no physics or transitions: evaluate the wave once, not 7200 substeps.
      this.phaseTime += Math.min(dt,60);
      this.castPower = castPowerAt(this.phaseTime);
      return;
    }
    let remaining = dt;
    let steps = 0;
    while (remaining > 0 && steps < 7200) {
      const step = Math.min(FISHING.substep, remaining);
      this.tick(step);
      remaining -= step;
      steps++;
      // Use the getter so TS doesn't carry the early-return field narrowing across tick().
      if (this.phase === "idle") break;
      if (this.phase === "catching" && this.pendingCatch) break;
    }
  }

  snapshot(): FishingSnapshot {
    return {
      phase: this._phase,
      phaseTime: this.phaseTime,
      castPower: this.castPower,
      spot: this.spot ? { ...this.spot } : null,
      fish: this.fish ? { ...this.fish } : null,
      fishPosition: this.fishPosition,
      barPosition: this.barPosition,
      barSize: FISHING.barSize,
      progress: this.progress,
      inBar: this.inBar,
      perfect: this.perfect,
      held: this.held,
      message: this.message,
      canCast: this.canCast,
    };
  }

  /** Claim the fish once, when the 1.55s catch completes; afterwards returns null. */
  takeCatch(): FishCatch | null {
    if (!this.pendingCatch) return null;
    const caught = { ...this.pendingCatch };
    this.toIdle();
    return caught;
  }

  /** Clear the whole session back to idle. */
  reset(): void {
    this.toIdle();
  }

  private tick(s: number): void {
    this.phaseTime += s;
    switch (this._phase) {
      case "charging":
        // Power oscillates with hold time; long holds never auto-cast or hook.
        this.castPower = castPowerAt(this.phaseTime);
        break;
      case "casting":
        if (this.phaseTime >= FISHING.castSeconds) this.enterWaiting();
        break;
      case "waiting":
        if (this.phaseTime >= this.waitFor) this.enterBite();
        break;
      case "bite":
        if (this.phaseTime >= FISHING.biteSeconds) this.enterEscaped();
        break;
      case "reeling":
        this.tickReeling(s);
        break;
      case "catching":
        if (!this.pendingCatch && this.phaseTime >= FISHING.catchSeconds) {
          this.pendingCatch = this.fish;
          this.perfect = !this.leftZone;
          this.held = false;
          this.message = "钓到了！";
          // Stay in catching until takeCatch() so the landed fish is never dropped early.
        }
        break;
      case "escaped":
        if (this.phaseTime >= FISHING.escapeSeconds) this.toIdle();
        break;
      default:
        break;
    }
  }

  private enterWaiting(): void {
    this._phase = "waiting";
    this.phaseTime = 0;
    this.message = "等待鱼儿上钩…";
  }

  private enterBite(): void {
    this._phase = "bite";
    this.phaseTime = 0;
    this.message = "咬钩了！按住不放！";
  }

  private enterReeling(): void {
    this._phase = "reeling";
    this.phaseTime = 0;
    this.held = true;
    this.leftZone = false;
    this.progress = FISHING.progressStart;
    this.perfect = true;
    this.fish = this.makeFish();
    this.offsetA = this.random() * Math.PI * 2;
    this.offsetB = this.random() * Math.PI * 2;
    this.fishPosition = this.fishTarget(0, FISH[this.fish.id].difficulty);
    this.barPosition = clamp(this.fishPosition, BAR_MIN, BAR_MAX);
    this.inBar = true;
    this.message = `${FISH[this.fish.id].name}上钩了！保持绿条命中鱼影`;
  }

  private tickReeling(s: number): void {
    const fish = this.fish;
    if (!fish) {
      this.enterEscaped();
      return;
    }
    const difficulty = FISH[fish.id].difficulty;
    this.fishPosition = this.fishTarget(this.phaseTime, difficulty);
    if (this.held) this.barPosition += FISHING.barUp * s;
    else this.barPosition -= FISHING.barDown * s;
    this.barPosition = clamp(this.barPosition, BAR_MIN, BAR_MAX);
    this.inBar = Math.abs(this.fishPosition - this.barPosition) <= BAR_HALF;
    if (!this.inBar && this.phaseTime >= FISHING.graceSeconds) this.leftZone = true;
    if (this.inBar) this.progress += FISHING.progressUp * s;
    else if (this.phaseTime >= FISHING.graceSeconds) this.progress -= FISHING.progressDown * s;
    this.progress = clamp(this.progress, 0, 1);
    this.perfect = !this.leftZone;
    if (this.progress >= 1) this.enterCatching();
    else if (this.progress <= 0 || this.phaseTime >= FISHING.reelTimeout) this.enterEscaped();
  }

  private enterCatching(): void {
    this._phase = "catching";
    this.phaseTime = 0;
    this.perfect = !this.leftZone;
    if (this.fish) this.fish.perfect = !this.leftZone;
    this.held = false;
    this.message = "钓到了！";
  }

  private enterEscaped(): void {
    this._phase = "escaped";
    this.phaseTime = 0;
    this.held = false;
    this.fish = null;
    this.leftZone = false;
    this.progress = 0;
    this.inBar = false;
    this.perfect = false;
    this.message = "鱼跑掉了…";
  }

  /** A smooth, bounded, difficulty-scaled fish track that is a pure function of reeling time. */
  private fishTarget(t: number, difficulty: number): number {
    const freq = 1 + difficulty * 0.5;
    const a1 = 0.22 + Math.min(0.06, difficulty * 0.03);
    const a2 = 0.09;
    const y = 0.5 + Math.sin(t * freq + this.offsetA) * a1 + Math.sin(t * freq * 0.37 + this.offsetB) * a2;
    return clamp(y, BAR_MIN, BAR_MAX);
  }

  /** Draw a species from the spot's biome pool (river: carp/perch, sea: sardine/redSnapper). */
  private makeFish(): FishCatch {
    const sea = this.spot?.kind === "sea";
    const ids: FishId[] = sea ? ["sardine", "redSnapper"] : ["carp", "perch"];
    const weights = ids.map((id) => 1 / FISH[id].difficulty);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.random() * total;
    let id: FishId = ids[ids.length - 1];
    for (let i = 0; i < ids.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        id = ids[i];
        break;
      }
    }
    const spec = FISH[id];
    const length = round1(spec.minLength + this.random() * (spec.maxLength - spec.minLength));
    return { id, length, perfect: true };
  }

  private toIdle(): void {
    this._phase = "idle";
    this.phaseTime = 0;
    this.castPower = 0;
    this.spot = null;
    this.fish = null;
    this.pendingCatch = null;
    this.held = false;
    this.leftZone = false;
    this.progress = 0;
    this.inBar = false;
    this.perfect = false;
    this.message = "";
  }
}

/**
 * Find a valid water landing spot within FISHING.minRange..maxRange along the aim
 * direction. Accepts only real water inside BOUNDS, never a bridge/dock tile, and
 * rejects casts blocked by walls/trees/fences (via optional world.canWalk on the
 * land part of the path) or that would skip past far-side re-entry into water.
 *
 * `power` (clamped to 0..1) linearly maps to the near -> far end of the first
 * continuous water run within range, so a river never lands full power on the far
 * shore land while open sea casts strictly farther. Non-finite power -> null.
 */
export function findFishingSpot(
  player: { x: number; z: number },
  aim: { x: number; z: number },
  canStand?: (x: number, z: number) => boolean,
  power = 0,
): FishingSpot | null {
  if (![player.x,player.z,aim.x,aim.z].every(Number.isFinite)) return null;
  if (!Number.isFinite(power)) return null;
  const pw = clamp(power, 0, 1);
  const dx = aim.x - player.x;
  const dz = aim.z - player.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return null;
  const ux = dx / length;
  const uz = dz / length;
  const step = 0.08;
  let runStart = -1;
  let runEnd = -1;
  let inRun = false;
  for (let d = step; d <= FISHING.maxRange + 1e-9; d += step) {
    const x = player.x + ux * d;
    const z = player.z + uz * d;
    if (Math.abs(x) > BOUNDS.x || Math.abs(z) > BOUNDS.z) break;
    // A bridge/dock tile is a man-made platform. Before the first water it is
    // transparent (so a cast from a bridge/dock can reach the outer water); once
    // inside a water run it closes the run so the interpolation never spans it.
    if (onBridge(x, z) || onDock(x, z)) {
      if (inRun) break;
      continue;
    }
    if (isWater(x, z)) {
      if (!inRun) {
        inRun = true;
        runStart = d;
      }
      runEnd = d;
      continue;
    }
    // The far bank ends the water run; an obstacle there cannot block a line
    // that lands in front of it. Only dry ground BEFORE the water can block.
    if (inRun) break;
    // Radius 0 prevents the final dry shoreline sample from colliding with water.
    if (canStand && !canStand(x, z)) return null;
  }
  if (runStart < 0) return null;
  const near = Math.max(FISHING.minRange, runStart);
  const far = Math.min(FISHING.maxRange, runEnd);
  if (near > far) return null;
  const dist = near + pw * (far - near);
  const x = player.x + ux * dist;
  const z = player.z + uz * dist;
  // The interpolated point must never cross onto a bridge/dock or out of water.
  if (!(isWater(x, z) && !onBridge(x, z) && !onDock(x, z))) return null;
  return { x, z, kind: isSea(x, z) ? "sea" : "river" };
}

/**
 * Choose the slot that would hold one more of `id`: an existing non-full stack of
 * the item, else the first empty normal (non-equipment) slot. Doesn't mutate the
 * bag; returns null when there is no room (bag is full).
 */
export function inventoryCatchSlot(bag: InventoryModel, id: FishId): number | null {
  const max = ITEMS[id].max;
  for (let i = 0; i < bag.slots.length; i++) {
    if (isEquipmentSlot(i)) continue;
    const s = bag.slots[i];
    if (s && s.id === id && s.count < max) return i;
  }
  for (let i = 0; i < bag.slots.length; i++) {
    if (isEquipmentSlot(i) || bag.slots[i]) continue;
    return i;
  }
  return null;
}
