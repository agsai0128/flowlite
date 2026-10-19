// Layer 2 acceptance tests (headless): rule-based clean-up + Claude fallback logic.
import { formatTranscript, RuleFormatter } from '../main/format/RuleFormatter';
import { ClaudeFormatter, buildUserContent, supportsEffort } from '../main/format/ClaudeFormatter';

let failures = 0;
function eq(name: string, got: string, want: string) {
  if (got !== want) { failures++; console.error(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
  else console.log(`PASS ${name}`);
}
function ok(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL ${name}`); } else console.log(`PASS ${name}`);
}

async function main() {
  // --- Rule-based (cases 6-10) ---
  eq('6 fillers+comma+period',
    formatTranscript('um so i think we should meet tomorrow comma maybe at noon period'),
    'So I think we should meet tomorrow, maybe at noon.');
  eq('7 question mark',
    formatTranscript('what time is it question mark'),
    'What time is it?');
  eq('8 new line',
    formatTranscript('first line new line second line'),
    'First line\nSecond line.');
  eq('9 period-as-word',
    formatTranscript('the trial period ends friday'),
    'The trial period ends friday.');
  const clean = formatTranscript('the trial period ends friday');
  eq('10 idempotent', formatTranscript(clean), clean);

  // Engine-punctuated input (e.g. Deepgram smart formatting) — cases 10b-10d.
  eq('10b engine-punctuated commands',
    formatTranscript('Um, so I think we should meet tomorrow, comma, maybe at noon, period.'),
    'So I think we should meet tomorrow, maybe at noon.');
  eq('10c question mark with engine period',
    formatTranscript('What time is it question mark.'),
    'What time is it?');
  eq('10d commas around new line',
    formatTranscript('First line, new line, second line.'),
    'First line\nSecond line.');
  const intact = 'The meeting is at 12:30, costs $4,000 and the notes are on example.com, version 3.5.';
  eq('10e numbers, times and URLs untouched', formatTranscript(intact), intact);
  eq('10f ALL-CAPS ER kept', formatTranscript('she works in the ER at night'), 'She works in the ER at night.');

  // --- Claude formatter fallback logic (cases 11-12), fake callModel, rules fallback ---
  const rules = new RuleFormatter();
  type CallModel = (raw: string, dictionary: readonly string[], focus?: { app?: string; precedingText?: string }) => Promise<{ text: string; truncated: boolean; refused: boolean }>;
  const mk = (callModel: CallModel) =>
    new ClaudeFormatter({ apiKey: 'test', model: 'claude-opus-5-5', effort: 'low', timeoutMs: 8000,
      fallback: (raw) => rules.format(raw), callModel });

  const rawQ = 'hello world this is a test transcript';
  const normal = mk(async () => ({ text: 'Hello world, this is a test transcript.', truncated: false, refused: false }));
  eq('11 normal reply used', await normal.format(rawQ), 'Hello world, this is a test transcript.');

  // Layer 4: focus reaches callModel only when the pipeline passes ctx.focus.
  let sawFocus: unknown = 'unset';
  const focusAware = mk(async (_r, _d, f) => { sawFocus = f; return { text: 'Hello world, this is a test transcript.', truncated: false, refused: false }; });
  await focusAware.format(rawQ, { focus: { app: 'notepad', precedingText: 'Hi ' } });
  ok('36d focus forwarded to the model call', JSON.stringify(sawFocus) === JSON.stringify({ app: 'notepad', precedingText: 'Hi ' }));
  await focusAware.format(rawQ);
  ok('36e no focus forwarded when ctx omits it', sawFocus === undefined);

  const refused = mk(async () => ({ text: 'ignored', truncated: false, refused: true }));
  eq('12a refusal -> rules fallback', await refused.format(rawQ), await rules.format(rawQ));

  const truncated = mk(async () => ({ text: 'half a rep', truncated: true, refused: false }));
  eq('12b truncated -> rules fallback', await truncated.format(rawQ), await rules.format(rawQ));

  const answered = mk(async () => ({
    text: 'Photosynthesis is the process by which green plants and some other organisms use sunlight to synthesise foods with carbon dioxide and water, producing oxygen as a byproduct in their chloroplasts.',
    truncated: false, refused: false,
  }));
  const rawAsk = 'explain how photosynthesis works in plants please';
  eq('12c answer (ballooned) -> rules fallback', await answered.format(rawAsk), await rules.format(rawAsk));

  const echo = mk(async () => ({ text: '<transcript>hello world this is a test transcript</transcript>', truncated: false, refused: false }));
  eq('12d tag echo -> rules fallback', await echo.format(rawQ), await rules.format(rawQ));

  const threw = mk(async () => { throw new Error('network down'); });
  eq('12e thrown error -> rules fallback', await threw.format(rawQ), await rules.format(rawQ));

  // --- Layer 3: request content + model capability (case 26) ---
  eq('26a no dictionary -> transcript only', buildUserContent('hi there', []), '<transcript>\nhi there\n</transcript>');
  eq('26b dictionary -> preferred spellings first',
    buildUserContent('hi there', ['GitHub', 'Siob<h>an']),
    '<preferred_spellings>\nGitHub\nSiobhan\n</preferred_spellings>\n\n<transcript>\nhi there\n</transcript>');
  ok('26c effort sent to Opus 5.5', supportsEffort('claude-opus-5-5'));
  ok('26d effort not sent to Haiku 4.5', !supportsEffort('claude-haiku-4-5'));

  // Layer 4: a <context> block is appended after the transcript, tags stripped.
  eq('36a context block appended',
    buildUserContent('hello', [], { app: 'notepad', precedingText: 'Dear team, ' }),
    '<transcript>\nhello\n</transcript>\n\n<context app="notepad">\nDear team, \n</context>');
  eq('36b no focus -> no context block', buildUserContent('hello', []), '<transcript>\nhello\n</transcript>');
  ok('36c angle brackets stripped from context',
    !buildUserContent('hello', [], { app: 'a<b>c', precedingText: 'x<script>y' }).includes('<script>'));

  // A dictionary spelling that replaces a misheard word is still plausible.
  const spelled = mk(async () => ({ text: 'We deploy everything to Kubernetes every friday morning.', truncated: false, refused: false }));
  const rawK = 'we deploy everything to cooper netties every friday morning';
  eq('26e dictionary word counts as plausible',
    await spelled.format(rawK, { dictionary: ['Kubernetes'] }),
    'We deploy everything to Kubernetes every friday morning.');

  if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
  console.log('\nALL FORMAT TESTS PASSED');
}
main().catch((e) => { console.error('ERROR', e); process.exit(1); });
