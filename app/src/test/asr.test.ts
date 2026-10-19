// Cloud engine tests (headless, no network): hint URLs, 400 retry, 401 message,
// and final-transcript assembly — using a fake socket in place of a real connection.
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { DeepgramAsrEngine, buildListenUrl } from '../main/asr/DeepgramAsrEngine';

let failures = 0;
function eq(name: string, got: string, want: string) {
  if (got !== want) { failures++; console.error(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
  else console.log(`PASS ${name}`);
}
function ok(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL ${name}`); } else console.log(`PASS ${name}`);
}

class FakeSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  sent: unknown[] = [];
  send(d: unknown) {
    this.sent.push(d);
    if (typeof d === 'string' && d.includes('CloseStream')) setImmediate(() => this.emit('close'));
  }
  close() { this.emit('close'); }
}
const asSocket = (s: FakeSocket) => s as unknown as WebSocket;

async function main() {
  const url = buildListenUrl({ sampleRate: 16000, language: 'en' }, ['GitHub', 'Kubernetes']);
  ok('24c hints become keywords params', url.includes('keywords=GitHub') && url.includes('keywords=Kubernetes'));
  ok('24d no hints, no keywords', !buildListenUrl({ sampleRate: 16000 }, []).includes('keywords='));

  // 25a: a 400 with hints reconnects once without them.
  const urls: string[] = [];
  const retrying = new DeepgramAsrEngine('test-key', async (u) => {
    urls.push(u);
    if (u.includes('keywords=')) throw new Error('Unexpected server response: 400');
    return asSocket(new FakeSocket());
  });
  const session = await retrying.start({ sampleRate: 16000, hints: ['GitHub'] });
  ok('25a reconnected without hints after 400',
    urls.length === 2 && urls[0].includes('keywords=') && !urls[1].includes('keywords='));
  await session.finish();

  // 25b: a 401 is reported as a rejected key (no retry).
  let attempts = 0;
  const rejected = new DeepgramAsrEngine('test-key', async () => {
    attempts++;
    throw new Error('Unexpected server response: 401');
  });
  let msg = '';
  try { await rejected.start({ sampleRate: 16000, hints: ['GitHub'] }); } catch (e) { msg = (e as Error).message; }
  eq('25b 401 reported as rejected key', msg, 'Deepgram rejected the API key (401)');
  ok('25b no retry on 401', attempts === 1);

  // 25c: final segments are joined; interim results don't leak into the final text.
  const sock = new FakeSocket();
  const engine = new DeepgramAsrEngine('test-key', async () => asSocket(sock));
  let finalText = '';
  const s2 = await engine.start({ sampleRate: 16000, onFinal: (t) => { finalText = t; } });
  const frame = (isFinal: boolean, transcript: string) =>
    sock.emit('message', Buffer.from(JSON.stringify({ is_final: isFinal, channel: { alternatives: [{ transcript }] } })));
  frame(true, 'hello world');
  frame(false, 'interim words');
  frame(true, 'second part');
  await s2.finish();
  eq('25c final segments joined', finalText, 'hello world second part');

  if (failures) { console.error(`\n${failures} asr test(s) failed`); process.exit(1); }
  console.log('\nALL ASR TESTS PASSED');
}
main().catch((e) => { console.error('ERROR', e); process.exit(1); });
