// Activation-gesture acceptance tests (headless). The gesture state machine is
// driven by a fake clock, so hold/tap/double-tap/cap/lock are fully deterministic.
import {
  GestureDetector, type GestureAction, type GestureConfig, type Scheduler,
  parseHookLine, nextBackoffDelay, resolveDictationKey, DICTATION_KEYS,
} from '../main/hotkey';

let failures = 0;
function eq(name: string, got: string, want: string) {
  if (got !== want) { failures++; console.error(`FAIL ${name}\n  got:  ${got}\n  want: ${want}`); }
  else console.log(`PASS ${name}`);
}
function ok(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL ${name}`); } else console.log(`PASS ${name}`);
}

/** Virtual clock + timers: advance() fires due timers in time order, re-entrantly. */
class FakeScheduler implements Scheduler {
  private t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now(): number { return this.t; }
  set(delayMs: number, fn: () => void): number { const id = ++this.seq; this.timers.set(id, { at: this.t + delayMs, fn }); return id; }
  clear(id: number): void { this.timers.delete(id); }
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let next: { id: number; at: number; fn: () => void } | null = null;
      for (const [id, e] of this.timers) if (e.at <= target && (!next || e.at < next.at)) next = { id, ...e };
      if (!next) break;
      this.t = next.at;
      this.timers.delete(next.id);
      next.fn();
    }
    this.t = target;
  }
}

const CFG: GestureConfig = { holdThresholdMs: 300, doubleTapWindowMs: 400, maxSessionMs: 300000 };

/** Build a detector that records the actions it emits. */
function harness(cfg: GestureConfig = CFG) {
  const sched = new FakeScheduler();
  const actions: GestureAction[] = [];
  const d = new GestureDetector(cfg, sched, (a) => actions.push(a));
  return { d, sched, actions };
}

// A1 hold-to-talk
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(350); d.keyUp();
  eq('A1 hold', actions.join(','), 'start,stopInsert');
}

// A2 accidental tap
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(100); d.keyUp(); sched.advance(400);
  eq('A2 accidental tap', actions.join(','), 'start,cancelDiscard');
}

// A3 double-tap -> hands-free -> single tap ends
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(100); d.keyUp();   // first tap
  sched.advance(150); d.keyDown(); d.keyUp();    // second tap within window
  sched.advance(5000); d.keyDown(); d.keyUp();   // later single tap ends hands-free
  eq('A3 double-tap', actions.join(','), 'start,lockHandsFree,stopInsert');
}

// A4 abort on another key while held
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(50); d.otherKey();
  eq('A4 abort', actions.join(','), 'start,abort');
}

// A5 threshold is inclusive
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(300); d.keyUp();
  eq('A5 threshold inclusive', actions.join(','), 'start,stopInsert');
}

// A6 session cap mid-hold
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(300000);
  eq('A6 cap mid-hold', actions.join(','), 'start,stopInsert');
}

// A7 screen lock while holding, and while hands-free
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(100); d.forceStop();
  eq('A7a lock mid-hold', actions.join(','), 'start,stopInsert');
  const h = harness();
  h.d.keyDown(); h.sched.advance(100); h.d.keyUp(); h.sched.advance(150); h.d.keyDown(); h.d.keyUp();
  h.d.forceStop();
  eq('A7b lock in hands-free', h.actions.join(','), 'start,lockHandsFree,stopInsert');
}

// A8 other key ignored in hands-free; single tap still ends
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(100); d.keyUp(); sched.advance(150); d.keyDown(); d.keyUp();
  d.otherKey(); d.otherKey();                 // typing/mouse while hands-free: ignored
  sched.advance(1000); d.keyDown(); d.keyUp(); // end
  eq('A8 hands-free ignores other', actions.join(','), 'start,lockHandsFree,stopInsert');
}

// A9 other key during the double-tap window discards
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(100); d.keyUp(); sched.advance(50); d.otherKey();
  eq('A9 other during window', actions.join(','), 'start,cancelDiscard');
}

// A10 auto-repeat down while pressed emits no second start
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(50); d.keyDown(); sched.advance(50); d.keyDown(); sched.advance(300); d.keyUp();
  eq('A10 auto-repeat', actions.join(','), 'start,stopInsert');
}

// A11 second tap just outside the window: fresh session, not a double-tap
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(100); d.keyUp(); // tap
  sched.advance(400);                          // window elapses -> cancelDiscard
  d.keyDown();                                 // a brand-new press
  eq('A11 late second tap', actions.join(','), 'start,cancelDiscard,start');
}

// A12 no stray action after a normal end
{
  const { d, sched, actions } = harness();
  d.keyDown(); sched.advance(350); d.keyUp();   // hold ends
  sched.advance(300000);                         // long after: cap timer must be cleared
  eq('A12 no stray cap fire', actions.join(','), 'start,stopInsert');
}

// A13 helper line parsing
eq('A13a down', String(parseHookLine('down')), 'down');
eq('A13b up (crlf)', String(parseHookLine('up\r')), 'up');
eq('A13c other', String(parseHookLine('  other  ')), 'other');
eq('A13d noise -> null', String(parseHookLine('hook-failed')), 'null');
eq('A13e empty -> null', String(parseHookLine('')), 'null');

// A14 backoff ladder
eq('A14 backoff', `${nextBackoffDelay(0)},${nextBackoffDelay(1)},${nextBackoffDelay(2)},${nextBackoffDelay(3)}`,
  '1000,5000,30000,null');

// A15 dictation-key resolution
eq('A15a CapsLock', '0x' + resolveDictationKey('CapsLock').vk.toString(16), '0x14');
eq('A15b RightCtrl', '0x' + resolveDictationKey('RightCtrl').vk.toString(16), '0xa3');
eq('A15c F13', '0x' + resolveDictationKey('F13').vk.toString(16), '0x7c');
eq('A15d F24', '0x' + resolveDictationKey('F24').vk.toString(16), '0x87');
let warned = '';
eq('A15e unknown -> Caps Lock', '0x' + resolveDictationKey('Nonsense', (m) => { warned = m; }).vk.toString(16), '0x14');
ok('A15f unknown warns', warned.includes('Nonsense'));
ok('A15g F-key table complete', Object.keys(DICTATION_KEYS).filter((k) => /^F\d+$/.test(k)).length === 12);

if (failures) { console.error(`\n${failures} hotkey test(s) failed`); process.exit(1); }
console.log('\nALL HOTKEY TESTS PASSED');
