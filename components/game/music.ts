/**
 * Looping background music for the farm. A single CC BY 4.0 track (Kevin MacLeod,
 * "Dream Culture", incompetech.com) is bundled locally in /public/audio so the game
 * never streams from outside. This module intentionally stays self-contained and
 * independent of GameAudio: the game's sound-effects toggle does not silence it, and
 * the settings dialog can stay open while the music keeps playing so it can be tuned.
 *
 * SSR / Node safety: nothing references `window`, `document`, or `Audio` at module
 * scope. The element is created lazily on a trusted gesture inside `unlock()`. If audio
 * is unavailable, autoplay is blocked, or the media fails to load, the failure is
 * swallowed and a later trusted gesture may retry (re-loading after a media error).
 */
export const MUSIC_TRACK = {
  title: "Dream Culture",
  artist: "Kevin MacLeod",
  src: "/audio/dream-culture.mp3",
  sourceUrl: "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300046",
  license: "Creative Commons: By Attribution 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
} as const;

const DEFAULT_VOLUME = 0.22;

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_VOLUME;
}

export class BackgroundMusic {
  private audio: HTMLAudioElement | null = null;
  private enabled = true;
  private volume = DEFAULT_VOLUME;
  private hidden = false;
  private unlocked = false; // a trusted gesture has called unlock()
  private disposed = false;
  private hadError = false; // the element fired an error; a trusted gesture reloads before playing

  /** Whether the element is currently playing (not paused). */
  get isPlaying(): boolean {
    return this.audio ? this.audio.paused === false : false;
  }

  private ensureAudio(): HTMLAudioElement | null {
    if (this.audio) return this.audio;
    try {
      const a = new Audio(MUSIC_TRACK.src);
      a.loop = true;
      a.preload = "auto";
      a.volume = this.enabled ? this.volume : 0;
      a.addEventListener("loadeddata", this.onReady);
      a.addEventListener("ended", this.onEnded);
      a.addEventListener("error", this.onError);
      this.audio = a;
    } catch {
      return null;
    }
    return this.audio;
  }

  /** The single gate before any play call. Everything the caller would need to be true
   *  to start (or keep) the music is checked here, and an already-playing element is
   *  never touched, so repeated trusted gestures neither restart nor stack audio. */
  private tryPlay(a: HTMLAudioElement): void {
    if (this.disposed || !this.enabled || this.volume <= 0 || this.hidden || !this.unlocked) return;
    if (!a.paused) return; // already playing: no reset, no duplicate play
    try {
      const promise = a.play();
      if (promise && typeof promise.then === "function") {
        promise.catch(() => {
          /* Autoplay was blocked; stay silent and let a later gesture retry. */
        });
      }
    } catch {
      /* Swallowed. */
    }
  }

  /** Call from a trusted user gesture. Creating is gated: when the music is disabled,
   *  muted, or the tab is hidden, no element is created at all. If a previous media load
   *  errored, this reloads the source before attempting to play again. */
  unlock(): void {
    if (this.disposed) return;
    this.unlocked = true;
    if (!this.enabled || this.volume === 0 || this.hidden) return; // never build audio while it can't play
    const a = this.ensureAudio();
    if (!a) return;
    if (this.hadError) {
      this.hadError = false;
      try {
        a.load();
      } catch {
        /* Swallowed. */
      }
    }
    this.tryPlay(a);
  }

  /** Toggle the music and set its volume (clamped to [0,1]). Music is on by default
   *  at a gentle 0.22 and is independent of the game's effect-sound toggle. */
  settings(enabled: boolean, volume: number): void {
    this.enabled = !!enabled;
    this.volume = clampVolume(volume);
    const a = this.audio;
    if (!a) return;
    a.volume = this.enabled ? this.volume : 0;
    if (this.enabled && !this.hidden && this.volume > 0) this.tryPlay(a);
    else a.pause();
  }

  /** Pause when the tab goes to the background; on returning foreground, resume only
   *  if the music was already unlocked by a gesture (never auto-play from cold). */
  setHidden(hidden: boolean): void {
    this.hidden = !!hidden;
    const a = this.audio;
    if (!a) return;
    if (this.hidden || !this.enabled || this.volume === 0) a.pause();
    else this.tryPlay(a); // tryPlay gates on unlocked and paused
  }

  /** Drop every event handler, pause, and release the source URL so the element and
   *  any buffered audio are freed. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const a = this.audio;
    if (a) {
      a.removeEventListener("loadeddata", this.onReady);
      a.removeEventListener("ended", this.onEnded);
      a.removeEventListener("error", this.onError);
      a.pause();
      a.removeAttribute("src");
      try {
        a.load();
      } catch {
        /* Swallowed. */
      }
    }
    this.audio = null;
    this.unlocked = false;
    this.hadError = false;
  }

  // Internal handlers: run through the same gate and never surface failures.
  private onReady = () => {
    if (this.disposed || !this.enabled || this.volume <= 0 || this.hidden) return;
    this.tryPlay(this.audio!);
  };
  private onEnded = () => {
    // loop=true should never reach the end, but restart defensively if it does.
    if (this.disposed || !this.enabled || this.volume <= 0 || this.hidden) return;
    this.tryPlay(this.audio!);
  };
  private onError = () => {
    // Media load/decode failure: remember it so the next trusted gesture reloads.
    this.hadError = true;
  };
}
