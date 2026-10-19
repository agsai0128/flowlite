// Offline engine: lets the whole pipeline run with no account/network.
// It ignores the audio and returns a canned transcript on finish().
import type { AsrEngine, AsrSession, AsrStartOptions } from '../../shared/types';

const CANNED =
  'this is a test of the dictation core loop press the hotkey speak and the text lands at your cursor';

export class MockAsrEngine implements AsrEngine {
  readonly name = 'mock';

  async start(opts: AsrStartOptions): Promise<AsrSession> {
    let bytes = 0;
    let partialTimer: NodeJS.Timeout | undefined;
    // Emit a growing partial every 400ms to exercise the partial path.
    const words = CANNED.split(' ');
    let shown = 0;
    partialTimer = setInterval(() => {
      shown = Math.min(words.length, shown + 3);
      opts.onPartial?.(words.slice(0, shown).join(' '));
    }, 400);

    return {
      sendAudio(chunk: Buffer) {
        bytes += chunk.length;
      },
      async finish() {
        if (partialTimer) clearInterval(partialTimer);
        // A real engine would transcribe `bytes` of audio; the mock returns text.
        void bytes;
        opts.onFinal?.(CANNED);
      },
    };
  }
}
