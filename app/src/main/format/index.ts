// Formatter factory. `auto` uses Claude when a key is present, else the rules.
import type { Formatter } from '../../shared/types';
import type { Config } from '../config';
import { RuleFormatter } from './RuleFormatter';
import { ClaudeFormatter } from './ClaudeFormatter';

/** A no-op formatter (formatter=off): insert the raw transcript as-is. */
class PassthroughFormatter implements Formatter {
  readonly name = 'off';
  async format(raw: string): Promise<string> { return (raw ?? '').trim(); }
}

export function createFormatter(cfg: Config): Formatter {
  const rules = new RuleFormatter();
  if (cfg.formatter === 'off') return new PassthroughFormatter();
  if (cfg.formatter === 'rules') return rules;

  const wantCloud = cfg.formatter === 'claude' || cfg.formatter === 'auto';
  if (wantCloud && cfg.anthropicApiKey) {
    return new ClaudeFormatter({
      apiKey: cfg.anthropicApiKey,
      model: cfg.formatModel,
      effort: cfg.formatEffort,
      timeoutMs: cfg.formatTimeoutMs,
      fallback: (raw) => rules.format(raw),
      log: (msg) => console.log(msg),
    });
  }
  if (cfg.formatter === 'claude') {
    console.warn('[format] formatter=claude but no ANTHROPIC_API_KEY; using rule-based formatter.');
  }
  return rules; // auto with no key, or claude with no key
}
