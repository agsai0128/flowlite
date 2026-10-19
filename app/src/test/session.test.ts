// Dictation session acceptance tests (headless). The whole idle -> listening ->
// finalizing loop runs behind fakes at every port: a controllable engine, a
// recording injector, a fake view, a no-op context provider, and a fake clock.
// Covers S1-S8 from .scratch/dictation-session/spec.md.
import { DictationSession } from '../main/session';
import type { SessionView } from '../main/session';
import { processTranscript } from '../main/pipeline';
import { loadConfig, type Config } from '../main/config';
import type { AsrEngine, AsrSession, AsrStartOptions, ContextProvider, Formatter, TextInjector } from '../shared/types';
import type { Scheduler } from '../main/hotkey';

let failures = 0;
function eq(name: string, got: string, want: string) {
  if (got !== want) { failures++; console.error(`FAIL ${name}\n  got:  ${got}\n  want: ${want}`); }
  else console.log(`PASS ${name}`);
}
function ok(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL ${name}`); } else console.log(`PASS ${name}`);
}

// --- Fakes ---------------------------------------------------------------
class FakeView implements SessionView {
  calls: string[] = [];
  startCapture() { this.calls.push('startCapture'); }
  stopCapture() { this.calls.push('stopCapture'); }
  enterListening() { this.calls.push('enterListening'); }
  enterFinalizing() { this.calls.push('enterFinalizing'); }
  enterIdle() { this.calls.push('enterIdle'); }
  hide() { this.calls.push('hide'); }
  partial(t: string) { this.calls.push('partial:' + t); }
  handsFree() { this.calls.push('handsFree'); }
  error(t: string) { this.calls.push('error:' + t); }
}
class RecordingInjector implements TextInjector {
  inserted: string[] = [];
  async insertAtCursor(text: string) { this.inserted.push(text); }
}
const passthroughFormatter: Formatter = { name: 'id', async format(raw: string) { return raw; } };
const noopContext: ContextProvider = { name: 'none', async capture() { return {}; } };

/** Engine with a controllable connect gate and a canned final transcript. */
class FakeEngine implements AsrEngine {
  readonly name = 'fake';
  started = 0; finished = 0;
  lastOpts?: AsrStartOptions;
  constructor(private finalText = 'hello world', private gate?: Promise<void>, private throwOnStart = false) {}
  async start(opts: AsrStartOptions): Promise<AsrSession> {
    this.started++;
    this.lastOpts = opts;
    if (this.throwOnStart) throw new Error('no device');
    if (this.gate) await this.gate;
    return {
      sendAudio: () => {},
      finish: async () => { this.finished++; if (this.finalText) opts.onFinal?.(this.finalText); },
    };
  }
}
class FakeScheduler implements Scheduler {
  private t = 0; private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now() { return this.t; }
  set(delayMs: number, fn: () => void) { const id = ++this.seq; this.timers.set(id, { at: this.t + delayMs, fn }); return id; }
  clear(id: number) { this.timers.delete(id); }
  advance(ms: number) {
    const target = this.t + ms;
    for (;;) {
      let next: { id: number; at: number; fn: () => void } | null = null;
      for (const [id, e] of this.timers) if (e.at <= target && (!next || e.at < next.at)) next = { id, ...e };
      if (!next) break;
      this.t = next.at; this.timers.delete(next.id); next.fn();
    }
    this.t = target;
  }
}

function baseConfig(): Config {
  // Defaults, but keep context awareness on to exercise the concurrent capture path.
  return { ...loadConfig(), contextAwareness: true, sendContextToLlm: false, language: 'en', sampleRate: 16000, contextBlocklist: [] };
}
function makeSession(engine: AsrEngine, view: FakeView, injector: TextInjector, scheduler: Scheduler) {
  return new DictationSession({
    config: baseConfig(),
    reloadVocabulary: () => ({ terms: [], replacements: [] }),
    engine, injector, formatter: passthroughFormatter, processTranscript,
    contextProvider: noopContext, view, scheduler,
  });
}

async function main() {
  // S1 happy path
  {
    const view = new FakeView(); const inj = new RecordingInjector();
    const eng = new FakeEngine('hello world');
    const s = makeSession(eng, view, inj, new FakeScheduler());
    await s.start();
    eng.lastOpts?.onPartial?.('hello');
    s.stop();
    s.captureStopped();
    await new Promise((r) => setTimeout(r, 0)); // let finalize microtasks settle
    ok('S1a startCapture after connect', view.calls.includes('startCapture'));
    ok('S1b partial shown', view.calls.includes('partial:hello'));
    eq('S1c inserted processed text', inj.inserted.join('|'), 'hello world');
    ok('S1d ends hidden + idle', view.calls.includes('hide') && view.calls.lastIndexOf('enterIdle') > view.calls.indexOf('startCapture'));
  }

  // S2 stop while connecting
  {
    const view = new FakeView(); const inj = new RecordingInjector();
    let openGate!: () => void;
    const gate = new Promise<void>((res) => { openGate = res; });
    const eng = new FakeEngine('hello world', gate);
    const s = makeSession(eng, view, inj, new FakeScheduler());
    const started = s.start();           // awaiting the gate inside engine.start
    s.stop();                            // stop before it connects
    openGate();                          // engine now resolves
    await started;
    ok('S2a startCapture never called', !view.calls.includes('startCapture'));
    ok('S2b abandoned session finished', eng.finished === 1);
    eq('S2c nothing inserted', inj.inserted.join('|'), '');
  }

  // S3 cancel / discard
  {
    const view = new FakeView(); const inj = new RecordingInjector();
    const s = makeSession(new FakeEngine('hello world'), view, inj, new FakeScheduler());
    await s.start();
    s.cancel();
    s.captureStopped();
    await new Promise((r) => setTimeout(r, 0));
    eq('S3a nothing inserted', inj.inserted.join('|'), '');
    ok('S3b hidden + idle', view.calls.includes('hide') && view.calls.includes('enterIdle'));
  }

  // S4 engine-start throws
  {
    const view = new FakeView(); const inj = new RecordingInjector(); const sched = new FakeScheduler();
    const s = makeSession(new FakeEngine('x', undefined, true), view, inj, sched);
    await s.start();
    ok('S4a error shown', view.calls.some((c) => c.startsWith('error:')));
    ok('S4b not yet hidden', !view.calls.includes('hide'));
    sched.advance(3000);
    ok('S4c hidden after 3s', view.calls.includes('hide'));
  }

  // S5 captureError
  {
    const view = new FakeView(); const inj = new RecordingInjector();
    const eng = new FakeEngine('hello world');
    const s = makeSession(eng, view, inj, new FakeScheduler());
    await s.start();
    s.captureError('microphone unavailable');
    await new Promise((r) => setTimeout(r, 0));
    ok('S5a error shown', view.calls.includes('error:microphone unavailable'));
    ok('S5b engine session finished', eng.finished === 1);
    eq('S5c nothing inserted', inj.inserted.join('|'), '');
  }

  // S6 hands-free
  {
    const view = new FakeView(); const inj = new RecordingInjector();
    const s = makeSession(new FakeEngine('note taken'), view, inj, new FakeScheduler());
    await s.start();
    s.handsFree();
    s.stop();
    s.captureStopped();
    await new Promise((r) => setTimeout(r, 0));
    ok('S6a handsFree shown', view.calls.includes('handsFree'));
    eq('S6b still inserts on stop', inj.inserted.join('|'), 'note taken');
  }

  // S7 guards
  {
    const view = new FakeView(); const inj = new RecordingInjector();
    const eng = new FakeEngine('hello world');
    const s = makeSession(eng, view, inj, new FakeScheduler());
    s.stop();   // not listening -> no-op
    s.cancel(); // not listening -> no-op
    ok('S7a stop/cancel when idle do nothing', view.calls.length === 0);
    await s.start();
    await s.start(); // already listening -> no-op
    ok('S7b second start is a no-op', eng.started === 1);
  }

  // S8 empty transcript
  {
    const view = new FakeView(); const inj = new RecordingInjector();
    const s = makeSession(new FakeEngine(''), view, inj, new FakeScheduler()); // finish yields no final text
    await s.start();
    s.stop();
    s.captureStopped();
    await new Promise((r) => setTimeout(r, 0));
    eq('S8a nothing inserted', inj.inserted.join('|'), '');
    ok('S8b still hidden + idle', view.calls.includes('hide') && view.calls.includes('enterIdle'));
  }

  // S9 toggle entry point: first toggle starts, second stops + inserts (regression:
  // a naive toggle that called start() then stop() would start-and-immediately-stop).
  {
    const view = new FakeView(); const inj = new RecordingInjector();
    const s = makeSession(new FakeEngine('toggled text'), view, inj, new FakeScheduler());
    s.toggle();
    await new Promise((r) => setTimeout(r, 0));
    ok('S9a first toggle starts', view.calls.includes('startCapture'));
    s.toggle(); // now listening -> stop
    s.captureStopped();
    await new Promise((r) => setTimeout(r, 0));
    eq('S9b second toggle stops + inserts', inj.inserted.join('|'), 'toggled text');
  }

  if (failures) { console.error(`\n${failures} session test(s) failed`); process.exit(1); }
  console.log('\nALL SESSION TESTS PASSED');
}
main().catch((e) => { console.error('ERROR', e); process.exit(1); });
