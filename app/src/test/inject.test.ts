// Text-insertion acceptance tests (headless). The injector's save/write/press/restore
// ordering is driven through the PastePen + Clipboard seams with fakes; the persistent
// PasteHelper's warm/fallback behaviour is driven with a fake child process. No real
// desktop, clipboard, or PowerShell is touched.
import { EventEmitter } from 'node:events';
import { WindowsInjector } from '../main/inject/WindowsInjector';
import { PasteHelper, OneShotPastePen, nextPasteBackoff, parsePasteLine } from '../main/inject';
import type { Clipboard, PastePen } from '../main/inject';

let failures = 0;
function eq(name: string, got: string, want: string) {
  if (got !== want) { failures++; console.error(`FAIL ${name}\n  got:  ${got}\n  want: ${want}`); }
  else console.log(`PASS ${name}`);
}
function ok(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL ${name}`); } else console.log(`PASS ${name}`);
}

/** Clipboard + pen that record their calls into one shared, ordered log. */
function recorder() {
  const log: string[] = [];
  const clipboard: Clipboard = {
    readText: () => { log.push('read'); return 'ORIGINAL'; },
    writeText: (t) => { log.push('write:' + t); },
  };
  const pen: PastePen = { press: async () => { log.push('press'); } };
  return { log, clipboard, pen };
}

/** Minimal fake ChildProcess: an stdout emitter + a recording stdin. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { writable: true, writes: [] as string[], write(s: string) { this.writes.push(s); return true; }, end() {} };
  killed = false;
  kill() { this.killed = true; }
  line(s: string) { this.stdout.emit('data', Buffer.from(s + '\n')); }
}

async function main() {
  // I1 ordering: save (read) -> write our text -> press -> restore original
  {
    const { log, clipboard, pen } = recorder();
    const inj = new WindowsInjector({ dryRun: false, pen, clipboard, restoreDelayMs: 0 });
    await inj.insertAtCursor('hello world');
    eq('I1 insert ordering', log.join(','), 'read,write:hello world,press,write:ORIGINAL');
  }

  // I2 dry-run: no clipboard access, pen never pressed
  {
    const { log, clipboard, pen } = recorder();
    const inj = new WindowsInjector({ dryRun: true, pen, clipboard, restoreDelayMs: 0 });
    await inj.insertAtCursor('hello world');
    eq('I2 dry-run is a no-op', log.join(','), '');
  }

  // I2b empty text: nothing happens
  {
    const { log, clipboard, pen } = recorder();
    const inj = new WindowsInjector({ dryRun: false, pen, clipboard, restoreDelayMs: 0 });
    await inj.insertAtCursor('');
    eq('I2b empty text is a no-op', log.join(','), '');
  }

  // I3 resilience: even if press() rejects, the clipboard is restored
  {
    const log: string[] = [];
    const clipboard: Clipboard = { readText: () => { log.push('read'); return 'ORIGINAL'; }, writeText: (t) => log.push('write:' + t) };
    const pen: PastePen = { press: async () => { log.push('press'); throw new Error('pen down'); } };
    const inj = new WindowsInjector({ dryRun: false, pen, clipboard, restoreDelayMs: 0 });
    let threw = false;
    try { await inj.insertAtCursor('x'); } catch { threw = true; }
    ok('I3a press error propagates', threw);
    ok('I3b clipboard still restored', log[log.length - 1] === 'write:ORIGINAL');
  }

  // I4 ok-line parser
  eq('I4a ok', String(parsePasteLine('ok')), 'ok');
  eq('I4b ready (crlf)', String(parsePasteLine('ready\r')), 'ready');
  eq('I4c noise -> null', String(parsePasteLine('pasted')), 'null');
  eq('I4d empty -> null', String(parsePasteLine('')), 'null');

  // I5 backoff ladder
  eq('I5 backoff', `${nextPasteBackoff(0)},${nextPasteBackoff(1)},${nextPasteBackoff(2)},${nextPasteBackoff(3)}`, '1000,5000,30000,null');

  // I6 PasteHelper: not started (not ready) -> falls back to the one-shot pen
  {
    let fellBack = 0;
    const fallback: PastePen = { press: async () => { fellBack++; } };
    const helper = new PasteHelper({ helperRoot: '.', fallback });
    await helper.press(); // never started
    ok('I6 unavailable -> fallback used', fellBack === 1);
  }

  // I7 PasteHelper: warm path writes "paste" and resolves on "ok"
  {
    let fellBack = 0;
    const fallback: PastePen = { press: async () => { fellBack++; } };
    const child = new FakeChild();
    const helper = new PasteHelper({ helperRoot: '.', fallback, spawnHelper: () => child as never });
    helper.start();
    child.line('ready');            // helper announces it is warm
    const p = helper.press();
    ok('I7a wrote paste command', child.stdin.writes.join('') === 'paste\n');
    ok('I7b did not fall back', fellBack === 0);
    child.line('ok');               // helper acks
    await p;
    ok('I7c press resolved on ok', true);
  }

  // I8 PasteHelper: process dies mid-press -> pending press settles, then fallback next
  {
    let fellBack = 0;
    const fallback: PastePen = { press: async () => { fellBack++; } };
    const child = new FakeChild();
    const helper = new PasteHelper({ helperRoot: '.', fallback, spawnHelper: () => child as never });
    helper.start();
    child.line('ready');
    const p = helper.press();       // in-flight
    child.emit('close');            // process dies before 'ok'
    await p;                        // must not hang
    ok('I8a in-flight press settled on close', true);
    await helper.press();           // now not ready -> fallback
    ok('I8b next press falls back', fellBack === 1);
    helper.stop();
  }

  // I9 PasteHelper: warm but no ack within the window -> falls back (never silently drops)
  {
    let fellBack = 0;
    const fallback: PastePen = { press: async () => { fellBack++; } };
    const child = new FakeChild();
    const helper = new PasteHelper({ helperRoot: '.', fallback, spawnHelper: () => child as never, ackTimeoutMs: 10 });
    helper.start();
    child.line('ready');
    await helper.press();           // write 'paste', no 'ok' arrives -> timeout -> fallback
    ok('I9a no-ack falls back to one-shot', fellBack === 1);
    ok('I9b paste command was still sent', child.stdin.writes.join('') === 'paste\n');
    helper.stop();
  }

  // I10 OneShotPastePen: spawns the one-shot script and resolves when it closes
  {
    const child = new FakeChild();
    let spawnedScript = '';
    const pen = new OneShotPastePen('ROOT', (script) => { spawnedScript = script; return child as never; });
    const p = pen.press();
    ok('I10a spawned the paste script', /paste\.ps1$/.test(spawnedScript.replace(/\\/g, '/')));
    child.emit('close');
    await p;
    ok('I10b resolves on process close', true);
  }

  if (failures) { console.error(`\n${failures} inject test(s) failed`); process.exit(1); }
  console.log('\nALL INJECT TESTS PASSED');
}
main().catch((e) => { console.error('ERROR', e); process.exit(1); });
