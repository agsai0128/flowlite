// The Dictation session: one activation of dictation, from the moment listening
// starts to the moment text is inserted or discarded. It owns the
// idle -> listening -> finalizing state machine and all its fields; callers see only
// a small interface and talk to the outside world through the injected SessionView.
//
// This is the logic that used to live as free functions + module globals in main.ts;
// the behaviour (the start-token race, the discard path, the error->idle->hide delay)
// is unchanged. See .scratch/dictation-session/spec.md.
import type { AppState, AsrSession, FocusContext } from '../../shared/types';
import { applyBlocklist } from '../context';
import { recognitionHints, type Vocabulary } from '../vocab';
import type { SessionPorts } from './types';

const ERROR_VISIBLE_MS = 3000;

export class DictationSession {
  private state: AppState = 'idle';
  private session: AsrSession | null = null;
  private finalText = '';
  private startToken = 0;
  private discard = false;
  private focusPromise: Promise<FocusContext> = Promise.resolve({});
  private vocab: Vocabulary = { terms: [], replacements: [] };

  constructor(private readonly ports: SessionPorts) {}

  /** Read state through a call so it isn't narrowed across an await by the compiler. */
  private current(): AppState { return this.state; }

  /** Begin a session. No-op unless idle. */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    const { config, view, engine, contextProvider } = this.ports;
    const token = ++this.startToken;
    this.discard = false;
    this.vocab = this.ports.reloadVocabulary();
    // Capture the focused field now (concurrently), while the target still has focus.
    this.focusPromise = config.contextAwareness
      ? contextProvider.capture().then((f) => applyBlocklist(f, config.contextBlocklist)).catch(() => ({}))
      : Promise.resolve({});
    this.finalText = '';
    this.setState('listening');
    let s: AsrSession;
    try {
      s = await engine.start({
        sampleRate: config.sampleRate,
        language: config.language,
        hints: recognitionHints(this.vocab.terms),
        onPartial: (t) => { if (token === this.startToken) view.partial(t); },
        onFinal: (t) => { if (token === this.startToken) this.finalText = t; },
        onError: (e) => { console.error('[asr]', e.message); view.error(e.message); },
      });
    } catch (e) {
      if (token === this.startToken) this.failToIdle(`Transcription unavailable: ${(e as Error).message}`);
      return;
    }
    // Stopped (or restarted) while connecting: discard this session, don't start capture.
    if (token !== this.startToken || this.current() !== 'listening') {
      void s.finish().catch(() => {});
      return;
    }
    this.session = s;
    view.startCapture();
  }

  /** Finalize the session and insert what was said. No-op unless listening. */
  stop(): void {
    if (this.state !== 'listening') return;
    this.setState('finalizing');
    this.ports.view.stopCapture(); // renderer flushes, then calls captureStopped()
  }

  /** End the session without inserting (accidental tap, or another key mid-hold). */
  cancel(): void {
    if (this.state !== 'listening') return;
    this.discard = true;
    this.setState('finalizing');
    this.ports.view.stopCapture(); // same flush path; finalize drops the text
  }

  /** Toggle entry point (the OS hotkey): start if idle, stop if listening. */
  toggle(): void {
    if (this.state === 'idle') void this.start();
    else if (this.state === 'listening') this.stop();
  }

  /** Mark the live session hands-free (double-tap). Shows it in the view. */
  handsFree(): void {
    console.log('[flowlite] hands-free engaged');
    this.ports.view.handsFree();
  }

  /** Forward one PCM chunk to the engine session (ignored if not capturing). */
  sendAudio(chunk: Buffer): void {
    this.session?.sendAudio(chunk);
  }

  /** The renderer finished flushing capture: finalize and (maybe) insert. */
  captureStopped(): void {
    void this.finalizeAndInject();
  }

  /** The renderer's capture failed. */
  captureError(msg: string): void {
    const s = this.session;
    this.failToIdle(msg);
    if (s) void s.finish().catch(() => {});
  }

  private setState(next: AppState): void {
    this.state = next;
    if (next === 'listening') this.ports.view.enterListening();
    else if (next === 'finalizing') this.ports.view.enterFinalizing();
    else this.ports.view.enterIdle();
  }

  /** Show an error in the bar, return to idle, hide the bar a few seconds later. */
  private failToIdle(msg: string): void {
    console.error('[flowlite]', msg);
    this.session = null;
    this.setState('idle');
    this.ports.view.error(msg);
    this.ports.scheduler.set(ERROR_VISIBLE_MS, () => { if (this.state === 'idle') this.ports.view.hide(); });
  }

  private async finalizeAndInject(): Promise<void> {
    const dropped = this.discard;
    this.discard = false;
    try {
      if (this.session) await this.session.finish();
    } catch (e) {
      console.error('[asr] finish failed:', (e as Error).message);
    }
    this.session = null;
    const raw = this.finalText.trim();
    if (!dropped && raw) {
      // Layers 2-4: clean-up -> dictionary -> replacements -> continuation (never throws).
      const focus = await this.focusPromise;
      const text = await this.ports.processTranscript(raw, {
        formatter: this.ports.formatter,
        vocab: this.vocab,
        language: this.ports.config.language,
        focus,
        sendContextToLlm: this.ports.config.sendContextToLlm,
      });
      if (text) {
        try { await this.ports.injector.insertAtCursor(text); }
        catch (e) { console.error('[inject] failed:', (e as Error).message); }
      }
    }
    this.ports.view.hide();
    this.setState('idle');
  }
}
