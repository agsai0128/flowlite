// Headless acceptance test for the full pipeline (no GUI, no mic, no network):
//   mock engine -> clean-up -> dictionary spelling -> replacements -> dry-run insert.
import { MockAsrEngine } from '../main/asr/MockAsrEngine';
import { WindowsInjector } from '../main/inject/WindowsInjector';
import { RuleFormatter } from '../main/format/RuleFormatter';
import { processTranscript } from '../main/pipeline';
import { buildVocabulary } from '../main/vocab';

async function main() {
  let finalText = '';
  const partials: string[] = [];

  const engine = new MockAsrEngine();
  const session = await engine.start({
    sampleRate: 16000,
    hints: ['FlowLite'],
    onPartial: (t) => partials.push(t),
    onFinal: (t) => { finalText = t; },
  });

  // Simulate ~0.5s of 16 kHz PCM16 as 5 x 100ms chunks (3200 bytes each).
  for (let i = 0; i < 5; i++) session.sendAudio(Buffer.alloc(3200));
  await new Promise((r) => setTimeout(r, 900)); // allow partials to tick
  await session.finish();

  // Layers 2-4 exactly as the app runs them, including a mid-sentence context.
  const vocab = buildVocabulary(['HotKey'], [{ trigger: 'core loop', text: 'core loop (v1)' }]);
  const text = await processTranscript(finalText, {
    formatter: new RuleFormatter(), vocab, language: 'en',
    focus: { precedingText: 'I was saying' },
  });

  // Dry-run inserter works without Electron (the pen is never pressed in dry-run).
  const injector = new WindowsInjector({ dryRun: true, pen: { press: async () => {} } });
  await injector.insertAtCursor(text);

  console.log(`partials observed: ${partials.length}`);
  console.log(`final transcript: ${JSON.stringify(finalText)}`);
  console.log(`inserted text:    ${JSON.stringify(text)}`);
  const fail = (why: string) => { console.error(`FAIL: ${why}`); process.exit(1); };
  if (!finalText.trim()) fail('empty final transcript');
  if (partials.length === 0) fail('no partial transcripts emitted');
  if (!/[.!?]$/.test(text) || text[0] !== text[0].toUpperCase()) fail('formatter did not capitalize/punctuate');
  if (!text.includes('HotKey')) fail('dictionary spelling not applied');
  if (!text.includes('core loop (v1)')) fail('text replacement not applied');
  if (!text.startsWith(' this')) fail('continuation fix not applied (expected leading space + lowercase)');
  console.log('PASS: mock engine -> clean-up -> dictionary -> replacements -> continuation -> dry-run insert.');
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
