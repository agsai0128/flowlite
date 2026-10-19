// Cloud streaming engine over WebSocket. The provider and key are the user's own.
// Deepgram is used as the default cloud provider because it has a simple,
// well-documented streaming WebSocket API; the AsrEngine interface lets you swap
// in any other streaming provider without touching the rest of the app.
import WebSocket from 'ws';
import type { AsrEngine, AsrSession, AsrStartOptions } from '../../shared/types';

const MAX_HINTS = 100;

/** Opens a socket and resolves once it is connected. Injectable for tests. */
export type SocketOpener = (url: string, headers: Record<string, string>) => Promise<WebSocket>;

const openSocket: SocketOpener = (url, headers) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
  });

/** Streaming URL; dictionary hints become repeated `keywords` parameters. */
export function buildListenUrl(opts: { sampleRate: number; language?: string }, hints: readonly string[] = []): string {
  const params = new URLSearchParams({
    encoding: 'linear16',
    sample_rate: String(opts.sampleRate),
    channels: '1',
    model: 'nova-2',
    language: opts.language ?? 'en',
    interim_results: 'true',
    smart_format: 'true',
  });
  for (const hint of hints.slice(0, MAX_HINTS)) params.append('keywords', hint);
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const friendly = (e: unknown) => {
  const msg = messageOf(e);
  return new Error(/\b401\b/.test(msg) ? 'Deepgram rejected the API key (401)' : msg);
};

export class DeepgramAsrEngine implements AsrEngine {
  readonly name = 'deepgram';
  constructor(private apiKey: string, private open: SocketOpener = openSocket) {}

  /** Connect with hints; if Deepgram rejects them (400), reconnect once without. */
  private async connect(opts: AsrStartOptions): Promise<WebSocket> {
    const headers = { Authorization: `Token ${this.apiKey}` };
    const hints = opts.hints ?? [];
    try {
      return await this.open(buildListenUrl(opts, hints), headers);
    } catch (e) {
      if (hints.length === 0 || !/\b400\b/.test(messageOf(e))) throw friendly(e);
      console.warn('[asr] Deepgram rejected the dictionary hints (400); reconnecting without them.');
      try {
        return await this.open(buildListenUrl(opts, []), headers);
      } catch (e2) {
        throw friendly(e2);
      }
    }
  }

  async start(opts: AsrStartOptions): Promise<AsrSession> {
    const ws = await this.connect(opts);
    let lastFinal = '';

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        const alt = msg?.channel?.alternatives?.[0];
        const text: string = alt?.transcript ?? '';
        if (!text) return;
        if (msg.is_final) {
          lastFinal = (lastFinal ? lastFinal + ' ' : '') + text;
          opts.onPartial?.(lastFinal);
        } else {
          opts.onPartial?.((lastFinal ? lastFinal + ' ' : '') + text);
        }
      } catch {
        /* ignore keep-alive / non-JSON frames */
      }
    });
    ws.on('error', (e) => opts.onError?.(e instanceof Error ? e : new Error(String(e))));

    return {
      sendAudio(chunk: Buffer) {
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
      },
      finish() {
        return new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            opts.onFinal?.(lastFinal.trim());
            try { ws.close(); } catch { /* already closing */ }
            resolve();
          };
          // Ask Deepgram to flush, then finalize on its close or a safety timeout.
          try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* closed */ }
          const t = setTimeout(done, 3000);
          ws.once('close', () => { clearTimeout(t); done(); });
        });
      },
    };
  }
}
