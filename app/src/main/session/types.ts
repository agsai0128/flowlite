// Interfaces for the Dictation session module (see .scratch/dictation-session/spec.md).
// The session owns the idle -> listening -> finalizing lifecycle and speaks to the
// outside world only through SessionView, so it never touches Electron directly.
import type { AsrEngine, ContextProvider, Formatter, TextInjector } from '../../shared/types';
import type { Config } from '../config';
import type { Vocabulary } from '../vocab';
import type { Scheduler } from '../hotkey';
import type { processTranscript } from '../pipeline';

/**
 * Everything a dictation session says to the outside world — the indicator window,
 * the renderer capture messages, and the tray tooltip — behind one port. The real
 * adapter drives Electron; the test adapter records the call sequence.
 */
export interface SessionView {
  /** Tell the renderer to start/stop microphone capture (the `control` messages). */
  startCapture(): void;
  stopCapture(): void;
  /** State transitions: update the renderer indicator + tray, show the window. */
  enterListening(): void; // also shows the window (inactive)
  enterFinalizing(): void;
  enterIdle(): void; // does NOT hide the window; call hide() for that
  /** Hide the indicator window. */
  hide(): void;
  /** Renderer content updates. */
  partial(text: string): void;
  handsFree(): void;
  error(text: string): void;
}

/** Everything the DictationSession depends on, injected — it constructs nothing. */
export interface SessionPorts {
  /** Boot snapshot for the static fields (sampleRate, language, context flags). */
  config: Config;
  /** Re-read dictionary + replacements at the start of each session. */
  reloadVocabulary: () => Vocabulary;
  engine: AsrEngine;
  injector: TextInjector;
  formatter: Formatter;
  processTranscript: typeof processTranscript;
  contextProvider: ContextProvider;
  view: SessionView;
  scheduler: Scheduler;
}
