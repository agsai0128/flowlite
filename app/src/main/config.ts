// Runtime configuration: env vars + optional settings.json in the user-data dir.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildVocabulary, type Replacement } from './vocab';

export type FormatterMode = 'auto' | 'rules' | 'claude' | 'off';
export type FormatEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ActivationMode = 'toggle' | 'hold' | 'both';

export interface Config {
  engine: 'mock' | 'deepgram';
  deepgramApiKey?: string;
  language: string;
  hotkey: string;
  sampleRate: number;
  dryRunInject: boolean;
  // Activation gestures (hold-to-talk + double-tap via the native dictation key)
  activationMode: ActivationMode;
  dictationKey: string;
  holdThresholdMs: number;
  doubleTapWindowMs: number;
  maxSessionMs: number;
  // Layer 2 — transcript clean-up
  formatter: FormatterMode;
  anthropicApiKey?: string;
  formatModel: string;
  formatEffort: FormatEffort;
  formatTimeoutMs: number;
  // Layer 3 — personal dictionary and text replacements (validated)
  dictionary: string[];
  replacements: Replacement[];
  // Layer 4 — focused-field context awareness
  contextAwareness: boolean;
  sendContextToLlm: boolean;
  contextBlocklist: string[];
  contextTimeoutMs: number;
}

const DEFAULTS: Config = {
  engine: 'mock',
  language: 'en',
  hotkey: 'CommandOrControl+Shift+Space',
  sampleRate: 16000,
  dryRunInject: false,
  activationMode: 'both',
  dictationKey: 'CapsLock',
  holdThresholdMs: 300,
  doubleTapWindowMs: 400,
  maxSessionMs: 300000,
  formatter: 'auto',
  formatModel: 'claude-haiku-4-5',
  formatEffort: 'low',
  formatTimeoutMs: 8000,
  dictionary: [],
  replacements: [],
  contextAwareness: true,
  sendContextToLlm: false,
  contextBlocklist: [],
  contextTimeoutMs: 1500,
};

const ACTIVATION_MODES: readonly ActivationMode[] = ['toggle', 'hold', 'both'];

/** Clamp a value that came straight from JSON into [lo, hi], falling back when absent/NaN. */
function clampMs(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
}

/**
 * Load config. `userDataDir` is optional so this module can be used in a
 * headless test without Electron. A missing settings file is normal; a malformed
 * one logs a warning (never its contents — it may hold API keys) and falls back
 * to defaults.
 */
export function loadConfig(userDataDir?: string, warn: (msg: string) => void = (m) => console.warn(m)): Config {
  let fileCfg: Record<string, unknown> = {};
  if (userDataDir) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fileCfg = parsed as Record<string, unknown>;
      else warn('[config] settings.json must contain a JSON object; using defaults.');
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') { /* no settings file yet — fine */ }
      else if (e instanceof SyntaxError) warn('[config] settings.json is not valid JSON; using defaults until it is fixed.');
      else warn(`[config] could not read settings.json (${err.code ?? 'error'}); using defaults.`);
    }
  }
  const { dictionary, replacements, ...rest } = fileCfg;
  const cfg: Config = { ...DEFAULTS, ...(rest as Partial<Config>) };
  const vocab = buildVocabulary(dictionary, replacements, warn);
  cfg.dictionary = vocab.terms;
  cfg.replacements = vocab.replacements;

  // Coerce activation settings that come straight from JSON.
  cfg.activationMode = ACTIVATION_MODES.includes(cfg.activationMode) ? cfg.activationMode : 'both';
  if (typeof cfg.dictationKey !== 'string' || !cfg.dictationKey.trim()) cfg.dictationKey = 'CapsLock';
  cfg.holdThresholdMs = clampMs(cfg.holdThresholdMs, 100, 2000, 300);
  cfg.doubleTapWindowMs = clampMs(cfg.doubleTapWindowMs, 150, 1000, 400);
  cfg.maxSessionMs = clampMs(cfg.maxSessionMs, 10000, 1800000, 300000);

  // Coerce layer-4 settings that come straight from JSON.
  cfg.contextAwareness = cfg.contextAwareness !== false;
  cfg.sendContextToLlm = cfg.sendContextToLlm === true;
  cfg.contextBlocklist = Array.isArray(cfg.contextBlocklist)
    ? cfg.contextBlocklist.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    : [];
  cfg.contextTimeoutMs = Number.isFinite(cfg.contextTimeoutMs) ? Math.min(10000, Math.max(200, cfg.contextTimeoutMs)) : 1500;

  const envKey = process.env.DEEPGRAM_API_KEY;
  if (envKey) cfg.deepgramApiKey = envKey;
  // If a Deepgram key is available and the user didn't force an engine, use it.
  if (!rest.engine && cfg.deepgramApiKey) cfg.engine = 'deepgram';
  if (process.env.FLOWLITE_DRYRUN === '1') cfg.dryRunInject = true;
  if (!cfg.anthropicApiKey && process.env.ANTHROPIC_API_KEY) {
    cfg.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  }
  return cfg;
}
