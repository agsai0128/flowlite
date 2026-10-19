// Layer 4 acceptance tests (headless): continuation fix, provider parsing/timeout, blocklist.
import { applyContinuation, parseFocus, applyBlocklist, WindowsContextProvider } from '../main/context';

let failures = 0;
function eq(name: string, got: string, want: string) {
  if (got !== want) { failures++; console.error(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
  else console.log(`PASS ${name}`);
}
function ok(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL ${name}`); } else console.log(`PASS ${name}`);
}

async function main() {
  // --- Continuation (29-33) ---
  eq('29 mid-sentence: space + de-capitalise common word',
    applyContinuation('The cat sat.', { precedingText: 'I was thinking' }), ' the cat sat.');
  eq('30 after sentence + trailing space: keep capital, no extra space',
    applyContinuation('Next item.', { precedingText: 'Done. ' }), 'Next item.');
  eq('31a protect a name',
    applyContinuation('Alex is here.', { precedingText: 'ping' }), ' Alex is here.');
  eq('31b protect "I"',
    applyContinuation('I will.', { precedingText: 'tell' }), ' I will.');
  eq('31c protect an acronym',
    applyContinuation('API keys rotate.', { precedingText: 'the' }), ' API keys rotate.');
  eq('32a no preceding text -> unchanged',
    applyContinuation('Hello there.', {}), 'Hello there.');
  eq('32b empty preceding -> unchanged, no space',
    applyContinuation('Hello there.', { precedingText: '' }), 'Hello there.');
  eq('33a attaching punctuation -> no leading space',
    applyContinuation(', and then we left.', { precedingText: 'we waited' }), ', and then we left.');
  eq('33b preceding ends with whitespace -> no extra space',
    applyContinuation('the end.', { precedingText: 'this is ' }), 'the end.');
  eq('33c mid-sentence after space still de-capitalises',
    applyContinuation('The list continues.', { precedingText: 'items: ' }), 'the list continues.');

  // --- Provider parsing + timeout (34) ---
  eq('34a valid JSON maps through',
    JSON.stringify(parseFocus('{"app":"notepad","selectedText":"sel","precedingText":"hello "}')),
    JSON.stringify({ app: 'notepad', selectedText: 'sel', precedingText: 'hello ' }));
  eq('34b malformed -> {}', JSON.stringify(parseFocus('not json')), '{}');
  eq('34c empty -> {}', JSON.stringify(parseFocus('')), '{}');
  ok('34d preceding capped to last 300 chars',
    (parseFocus(JSON.stringify({ precedingText: 'x'.repeat(500) })).precedingText ?? '').length === 300);

  const good = new WindowsContextProvider({ appRoot: '.', timeoutMs: 1000, run: async () => '{"app":"Code"}' });
  eq('34e provider returns parsed context', JSON.stringify(await good.capture()), JSON.stringify({ app: 'Code' }));
  const threw = new WindowsContextProvider({ appRoot: '.', timeoutMs: 1000, run: async () => { throw new Error('helper blew up'); } });
  eq('34f provider swallows throws', JSON.stringify(await threw.capture()), '{}');
  const hangs = new WindowsContextProvider({ appRoot: '.', timeoutMs: 50, run: () => new Promise<string>(() => {}) });
  const t0 = Date.now();
  eq('34g provider times out to {}', JSON.stringify(await hangs.capture()), '{}');
  ok('34h timeout was honoured', Date.now() - t0 < 800);

  // --- Blocklist (35) ---
  eq('35a matching app discards context',
    JSON.stringify(applyBlocklist({ app: '1Password', precedingText: 'secret' }, ['1password'])), '{}');
  eq('35b non-matching app kept',
    JSON.stringify(applyBlocklist({ app: 'notepad' }, ['1password'])), JSON.stringify({ app: 'notepad' }));
  eq('35c no app -> kept',
    JSON.stringify(applyBlocklist({ precedingText: 'hi' }, ['1password'])), JSON.stringify({ precedingText: 'hi' }));

  if (failures) { console.error(`\n${failures} context test(s) failed`); process.exit(1); }
  console.log('\nALL CONTEXT TESTS PASSED');
}
main().catch((e) => { console.error('ERROR', e); process.exit(1); });
