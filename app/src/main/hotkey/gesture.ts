// Pure gesture state machine for the dictation key: turns raw key down/up/other
// events (from the native hook) into dictation actions. It is deliberately free of
// Electron, timers, and I/O: time comes from an injected Scheduler, so every
// gesture — hold, tap, double-tap, abort, cap, lock — is deterministically testable.

/** What the orchestrator should do in response to a gesture. */
export type GestureAction =
  | 'start'          // begin listening now (fires on the first key-down of a session)
  | 'stopInsert'     // end the session and insert what was said
  | 'cancelDiscard'  // end the session and insert nothing (accidental tap)
  | 'abort'          // end the session and insert nothing (another key was pressed mid-hold)
  | 'lockHandsFree'; // a double-tap confirmed hands-free; keep listening

export interface GestureConfig {
  /** Minimum hold (ms) for a release to count as hold-to-talk, not a tap. */
  holdThresholdMs: number;
  /** Window (ms) after a tap's release within which a second press is a double-tap. */
  doubleTapWindowMs: number;
  /** Hard cap (ms) on any one session, as a guard against a missed key-up. */
  maxSessionMs: number;
}

/** Injected clock + timers, so tests can drive time by hand. */
export interface Scheduler {
  now(): number;
  set(delayMs: number, fn: () => void): number;
  clear(id: number): void;
}

/** Production scheduler backed by the real clock. */
export class RealScheduler implements Scheduler {
  now(): number { return Date.now(); }
  set(delayMs: number, fn: () => void): number {
    return setTimeout(fn, delayMs) as unknown as number;
  }
  clear(id: number): void { clearTimeout(id as unknown as NodeJS.Timeout); }
}

type Mode = 'idle' | 'pressed' | 'awaitSecond' | 'handsFree';

export class GestureDetector {
  private mode: Mode = 'idle';
  private pressedAt = 0;
  private capTimer: number | null = null;
  private tapTimer: number | null = null;

  constructor(
    private readonly cfg: GestureConfig,
    private readonly sched: Scheduler,
    private readonly emit: (action: GestureAction) => void,
  ) {}

  /** The dictation key went down. */
  keyDown(): void {
    switch (this.mode) {
      case 'idle':
        this.pressedAt = this.sched.now();
        this.mode = 'pressed';
        this.armCap();
        this.emit('start');
        break;
      case 'awaitSecond': // second press inside the window → double-tap → hands-free
        this.clearTap();
        this.mode = 'handsFree';
        this.emit('lockHandsFree');
        break;
      case 'handsFree': // a single tap ends a hands-free session
        this.endSession('stopInsert');
        break;
      case 'pressed':
        // Auto-repeat while the key is held: ignore (one session, one 'start').
        break;
    }
  }

  /** The dictation key went up. */
  keyUp(): void {
    // Only the release of the *holding* press matters; the release that ends a
    // double-tap's second press, or any release in hands-free, is ignored.
    if (this.mode !== 'pressed') return;
    const heldMs = this.sched.now() - this.pressedAt;
    if (heldMs >= this.cfg.holdThresholdMs) {
      this.endSession('stopInsert'); // hold-to-talk release
    } else {
      this.mode = 'awaitSecond'; // a tap: keep listening, wait for a possible second tap
      this.tapTimer = this.sched.set(this.cfg.doubleTapWindowMs, () => {
        this.tapTimer = null;
        this.endSession('cancelDiscard'); // no second tap → accidental tap
      });
    }
  }

  /** Some key other than the dictation key went down. */
  otherKey(): void {
    if (this.mode === 'pressed') this.endSession('abort');
    else if (this.mode === 'awaitSecond') this.endSession('cancelDiscard');
    // idle / handsFree: the user is doing other things; leave the session alone.
  }

  /** External stop (screen lock, shutdown): end any live session and insert. */
  forceStop(): void {
    if (this.mode !== 'idle') this.endSession('stopInsert');
  }

  private armCap(): void {
    this.capTimer = this.sched.set(this.cfg.maxSessionMs, () => {
      this.capTimer = null;
      this.endSession('stopInsert'); // cap reached → insert what we have
    });
  }

  private clearCap(): void {
    if (this.capTimer !== null) { this.sched.clear(this.capTimer); this.capTimer = null; }
  }

  private clearTap(): void {
    if (this.tapTimer !== null) { this.sched.clear(this.tapTimer); this.tapTimer = null; }
  }

  private endSession(action: GestureAction): void {
    this.clearCap();
    this.clearTap();
    this.mode = 'idle';
    this.emit(action);
  }
}
