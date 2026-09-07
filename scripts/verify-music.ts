import assert from "node:assert/strict";
import { MUSIC_TRACK, BackgroundMusic } from "../components/game/music";

// A close-enough fake HTMLAudioElement. It records construction, listeners,
// playback state, and src release so we can assert the class contract without a
// browser. `play` can reject for autoplay-block or a failed load; `load` clears a
// failed load so a trusted gesture can retry.
type Listener = (event?: unknown) => void;
const made: FakeAudio[] = [];
let autoplayBlocked = false;

class FakeAudio {
  loop = false;
  preload = "";
  volume = 1;
  src = "";
  paused = true;
  currentTime = 0;
  loadCalls = 0;
  playCalls = 0;
  failed = false;
  listeners = new Map<string, Set<Listener>>();
  removed = new Set<string>();
  constructor(src?: string) {
    this.src = src ?? "";
    made.push(this);
  }
  play(): Promise<void> {
    this.playCalls++;
    if (this.failed || autoplayBlocked) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(name: string, fn: Listener): void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }
  removeEventListener(name: string, fn: Listener): void {
    this.removed.add(name);
    this.listeners.get(name)?.delete(fn);
  }
  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
    this.removed.add("attr:" + name);
  }
  load(): void {
    this.loadCalls++;
    this.failed = false;
  }
  emit(name: string): void {
    for (const fn of this.listeners.get(name) ?? []) fn();
  }
}

function installFakeAudio() {
  const old = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
  return () => {
    if (old) Object.defineProperty(globalThis, "Audio", old);
    else Reflect.deleteProperty(globalThis, "Audio");
  };
}

export function verifyMusic() {
  // --- track metadata contract ---
  assert.equal(MUSIC_TRACK.title, "Dream Culture");
  assert.equal(MUSIC_TRACK.artist, "Kevin MacLeod");
  assert(MUSIC_TRACK.src.startsWith("/audio/") && MUSIC_TRACK.src.endsWith(".mp3"), "music is a local bundled asset");
  assert(MUSIC_TRACK.sourceUrl.startsWith("https://incompetech.com/"), "source is the official incompetech track page");
  assert(MUSIC_TRACK.sourceUrl.includes("isrc=USUAN1300046"), "source URL is grounded on the verified ISRC (USUAN1300046)");
  assert(/by\s*attribution/i.test(MUSIC_TRACK.license), "license is CC BY");
  assert.equal(MUSIC_TRACK.licenseUrl, "https://creativecommons.org/licenses/by/4.0/", "license URL is HTTPS");

  const restore = installFakeAudio();
  try {
    // --- SSR safety: constructing never touches Audio, and nothing auto-plays ---
    const cold = new BackgroundMusic();
    assert.equal(cold.isPlaying, false);
    assert.equal(made.length, 0, "constructing the player must not create an Audio element");
    cold.settings(true, 0.22); // no element yet -> no throw, still silent
    cold.setHidden(true);
    cold.setHidden(false);
    cold.dispose();
    cold.unlock();
    assert.equal(made.length, 0, "an unlock-only-after-dispose call stays a no-op");
    const done = new BackgroundMusic();
    done.dispose();
    done.dispose(); // double dispose is safe
    assert.equal(done.isPlaying, false);

    // --- disabled / muted / hidden first unlock never builds audio ---
    made.length = 0;
    const disabled = new BackgroundMusic();
    disabled.settings(false, 0.22);
    disabled.unlock();
    assert.equal(made.length, 0, "enabled=false unlock downloads nothing");
    assert.equal(disabled.isPlaying, false);

    made.length = 0;
    const muted = new BackgroundMusic();
    muted.settings(true, 0);
    muted.unlock();
    assert.equal(made.length, 0, "volume=0 unlock downloads nothing");
    assert.equal(muted.isPlaying, false);

    made.length = 0;
    const hidden = new BackgroundMusic();
    hidden.setHidden(true);
    hidden.unlock();
    assert.equal(made.length, 0, "backgrounded unlock downloads nothing");
    assert.equal(hidden.isPlaying, false);

    // --- unlock: one element, loop + gentle volume, and a single play ---
    made.length = 0;
    const m = new BackgroundMusic();
    m.unlock();
    assert.equal(made.length, 1, "unlock creates exactly one element");
    const a = made[0];
    assert.equal(a.loop, true, "the track loops");
    assert.equal(a.preload, "auto", "local audio is preloaded");
    assert.equal(a.volume, 0.22, "gentle default volume (0.22)");
    assert.equal(a.src, MUSIC_TRACK.src, "element is bound to the bundled file");
    assert.equal(a.playCalls, 1, "a gesture plays it once");
    assert.equal(m.isPlaying, true);

    // consecutive gestures while already playing are a no-op (no second play, no reset)
    a.currentTime = 42.5;
    const playCalls = a.playCalls;
    m.unlock();
    m.unlock();
    assert.equal(made.length, 1, "no stacked second element");
    assert.equal(a.playCalls, playCalls, "an already-playing element is never play()ed again");
    assert.equal(a.currentTime, 42.5, "currentTime is never reset by a gesture");

    // --- volume clamps to [0,1] ---
    m.settings(true, 2);
    assert.equal(a.volume, 1, "volume clamps high");
    m.settings(true, -0.4);
    assert.equal(a.volume, 0, "volume clamps low");
    m.settings(true, 0.6);
    assert.equal(a.volume, 0.6, "volume applies");
    m.settings(true, Number.NaN);
    assert.equal(a.volume, 0.22, "non-finite volume falls back to the default");

    // --- enable / disable ---
    m.settings(false, 0.22);
    assert.equal(a.volume, 0, "disabled mutes the element");
    assert.equal(a.paused, true, "disabled pauses playback");
    m.settings(true, 0.22);
    assert.equal(a.paused, false, "re-enabled resumes the loop");

    // --- tab background ---
    m.setHidden(true);
    assert.equal(a.paused, true, "backgrounding pauses the music");
    m.setHidden(false);
    assert.equal(a.paused, false, "returning to the foreground resumes a running loop");

    // --- volume 0: onReady and gestures leave it paused ---
    made.length = 0;
    const zero = new BackgroundMusic();
    zero.unlock(); // starts at 0.22
    const za = made[0];
    zero.settings(true, 0); // mute
    assert.equal(za.paused, true, "muting pauses the loop");
    zero.unlock();
    za.emit("loadeddata");
    assert.equal(za.paused, true, "a gesture and loadeddata never resume at volume 0");
    assert.equal(zero.isPlaying, false);

    // --- autoplay blocked: silent, then a later gesture retries without a reload ---
    made.length = 0;
    autoplayBlocked = true;
    const bm = new BackgroundMusic();
    bm.unlock(); // play() rejects; swallowed
    assert.equal(made.length, 1);
    assert.equal(bm.isPlaying, false, "blocked autoplay stays silent");
    assert.equal(made[0].playCalls, 1);
    bm.setHidden(true);
    bm.setHidden(false);
    assert.equal(bm.isPlaying, false, "foreground cannot force audio while autoplay is blocked");
    autoplayBlocked = false;
    bm.unlock(); // later gesture retries
    assert.equal(bm.isPlaying, true, "a later gesture retries and succeeds");

    // --- load error: the next trusted gesture reloads then plays ---
    made.length = 0;
    const broken = new BackgroundMusic();
    broken.unlock();
    const ba = made[0];
    assert.equal(broken.isPlaying, true);
    ba.failed = true;
    ba.paused = true;
    ba.emit("error"); // notify the player of a media load/decode failure
    assert.equal(broken.isPlaying, false, "after a load error the music is silent");
    const loadBefore = ba.loadCalls;
    broken.unlock(); // trusted gesture retry
    assert.equal(ba.loadCalls, loadBefore + 1, "a trusted gesture reloads the source after an error");
    assert.equal(broken.isPlaying, true, "the reload + play resume the music");
    assert.equal(ba.failed, false, "the reload clears the failed state");

    // --- dispose drops handlers and releases the source ---
    const d = new BackgroundMusic();
    d.unlock();
    const da = made[made.length - 1];
    const countAfterDUnlock = made.length;
    d.dispose();
    assert(da.removed.has("loadeddata"), "load handler removed");
    assert(da.removed.has("ended"), "end handler removed");
    assert(da.removed.has("error"), "error handler removed");
    assert(da.removed.has("attr:src"), "src attribute released");
    assert.equal(da.loadCalls >= 1, true, "element reloaded to release buffered audio");
    assert.equal(da.paused, true, "disposed player is paused");
    assert.equal(d.isPlaying, false);
    d.dispose(); // idempotent
    d.unlock(); // no-op after dispose
    assert.equal(made.length, countAfterDUnlock, `no new element after dispose (got ${made.length})`);
    assert.equal(da, made[made.length - 1], "the disposed element is not replaced");
  } finally {
    restore();
  }

  console.log(
    "Music regression passed: track metadata (CC BY 4.0 incompetech asset, HTTPS license URL), SSR-safe lazy Audio, " +
      "gated first unlock (disabled/muted/hidden never build audio), gesture unlock with loop + gentle 0.22 volume, " +
      "single play per running loop (consecutive gestures are a no-op, no reset), volume clamping, enable/disable, " +
      "volume-0 pause held through onReady and gestures, tab-background pause + unlocked-only resume, silent " +
      "autoplay-blocked with gesture retry, media load-error reload-then-play retry, and dispose handler/src cleanup " +
      "including double-dispose races.",
  );
}

verifyMusic();
