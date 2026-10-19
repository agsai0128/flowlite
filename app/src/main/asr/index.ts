// Engine factory: pick an AsrEngine from config, with a safe fallback to mock.
import type { AsrEngine } from '../../shared/types';
import type { Config } from '../config';
import { MockAsrEngine } from './MockAsrEngine';
import { DeepgramAsrEngine } from './DeepgramAsrEngine';

export function createEngine(cfg: Config): AsrEngine {
  if (cfg.engine === 'deepgram') {
    if (cfg.deepgramApiKey) return new DeepgramAsrEngine(cfg.deepgramApiKey);
    console.warn('[asr] engine=deepgram but no API key; falling back to mock engine.');
  }
  return new MockAsrEngine();
}
