// Layer 3 acceptance tests (headless): dictionary fix, replacements, validation, hints.
import { applyDictionary, applyReplacements, buildVocabulary, recognitionHints } from '../main/vocab';

let failures = 0;
function eq(name: string, got: string, want: string) {
  if (got !== want) { failures++; console.error(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
  else console.log(`PASS ${name}`);
}
function ok(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL ${name}`); } else console.log(`PASS ${name}`);
}

// --- Dictionary spelling fix (15-18) ---
eq('15a split + casing', applyDictionary('we use github and chat gpt', ['GitHub', 'ChatGPT']), 'we use GitHub and ChatGPT');
eq('15b sentence start', applyDictionary('Github is great.', ['GitHub']), 'GitHub is great.');
eq('16a dotted term', applyDictionary('built with node js on nodejs', ['Node.js']), 'built with Node.js on Node.js');
eq('16b apostrophe', applyDictionary('ask obrien', ["O'Brien"]), "ask O'Brien");
eq('16c symbols exact', applyDictionary('I like c++ a lot', ['C++']), 'I like C++ a lot');
eq('16d camel case', applyDictionary('Iphone broke but my iphone case is fine', ['iPhone']), 'iPhone broke but my iPhone case is fine');
eq('17a single capitalised word', applyDictionary('I will call you', ['Will']), 'I will call you');
eq('17b acronym vs common word', applyDictionary('it works', ['IT']), 'it works');
eq('17c dotted acronym vs common word', applyDictionary('tell us more', ['U.S.']), 'tell us more');
eq('17d whole words only', applyDictionary('postgresql and sql query', ['SQL']), 'postgresql and SQL query');
const terms = ['GitHub', 'ChatGPT', 'Node.js'];
const once = applyDictionary('we use github, chat gpt and node js', terms);
eq('18 idempotent', applyDictionary(once, terms), once);

// --- Replacements (19-22) ---
const email = [{ trigger: 'my email', text: 'alex@example.com' }];
eq('19a mid-sentence keeps punctuation', applyReplacements('send it to my email.', email), 'send it to alex@example.com.');
eq('19b whole dictation is the trigger', applyReplacements('My email.', email), 'alex@example.com');
const both = [
  { trigger: 'my email', text: 'alex@example.com' },
  { trigger: 'my work email', text: 'alex@work.example (not my email)' },
];
eq('20 longest first, no re-scan', applyReplacements('my work email please', both), 'alex@work.example (not my email) please');
eq('21a multi-line text', applyReplacements('thanks insert signature', [{ trigger: 'insert signature', text: 'Best,\nAlex' }]), 'thanks Best,\nAlex');
eq('21b dollar signs literal', applyReplacements('the price is my rate', [{ trigger: 'my rate', text: '$1 and $& flat' }]), 'the price is $1 and $& flat');
eq('22 not inside words', applyReplacements('the signal is strong', [{ trigger: 'sig', text: '-- Alex' }]), 'the signal is strong');
eq('22b case + punctuation between words', applyReplacements('MY, EMAIL is below', email), 'alex@example.com is below');

// --- Validation (23) ---
const warnings: string[] = [];
const v = buildVocabulary(
  ['GitHub', 42, '', 'x'.repeat(65), 'github', '  Kubernetes  ', '!!!'],
  [
    { trigger: 'my email', text: 'a@b.example' },
    { trigger: 'MY EMAIL', text: 'duplicate' },
    { trigger: '', text: 'x' },
    { trigger: 'ok', text: '   ' },
    'not an object',
  ],
  (m) => warnings.push(m)
);
eq('23a valid terms kept, trimmed, deduped', JSON.stringify(v.terms), JSON.stringify(['GitHub', 'Kubernetes']));
eq('23b valid replacements kept', JSON.stringify(v.replacements), JSON.stringify([{ trigger: 'my email', text: 'a@b.example' }]));
ok('23c each invalid entry warned', warnings.length === 9);
ok('23d warnings never include replacement text', !warnings.some((w) => w.includes('a@b.example') || w.includes('duplicate"')));
const w2: string[] = [];
const v2 = buildVocabulary('GitHub', { a: 1 }, (m) => w2.push(m));
ok('23e non-lists ignored with a warning', v2.terms.length === 0 && v2.replacements.length === 0 && w2.length === 2);
const v3 = buildVocabulary(undefined, undefined, () => { throw new Error('should not warn'); });
ok('23f absent keys are fine', v3.terms.length === 0 && v3.replacements.length === 0);

// --- Hints (24) ---
eq('24a single-word terms only',
  JSON.stringify(recognitionHints(['GitHub', 'New York', 'C++', 'Kubernetes', 'Node.js', "O'Brien"])),
  JSON.stringify(['GitHub', 'Kubernetes', "O'Brien"]));
ok('24b capped at 100', recognitionHints(Array.from({ length: 150 }, (_, i) => `Term${i}`)).length === 100);

if (failures) { console.error(`\n${failures} vocab test(s) failed`); process.exit(1); }
console.log('\nALL VOCAB TESTS PASSED');
