// Text replacements: say a trigger phrase, get the stored text. Applied last, in a
// single pass (longest trigger first), so inserted text is never re-scanned.
import type { Replacement } from './types';
import { EDGE_L, EDGE_R, escapeRe } from './regex';

// Up to three spaces/punctuation characters between a trigger's words (not newlines).
const GAP = '[^\\p{L}\\p{N}\\n]{1,3}';

function triggerWords(trigger: string): string[] {
  return trigger.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function applyReplacements(text: string, replacements: readonly Replacement[]): string {
  if (!text || replacements.length === 0) return text;

  const entries = replacements
    .map((r) => {
      const words = triggerWords(r.trigger);
      return { r, words: words.length, body: words.map(escapeRe).join(GAP) };
    })
    .filter((e) => e.words > 0)
    .sort((a, b) => b.words - a.words || b.r.trigger.length - a.r.trigger.length);
  if (entries.length === 0) return text;

  // The whole dictation is just one trigger (plus end punctuation): insert exactly the text.
  const core = text.trim().replace(/[.!?]+$/u, '').trim();
  for (const e of entries) {
    if (new RegExp(`^${e.body}$`, 'iu').test(core)) return e.r.text;
  }

  // One pass over all triggers; a function replacer keeps "$1"/"$&" literal.
  const combined = new RegExp(`${EDGE_L}(?:${entries.map((e) => `(${e.body})`).join('|')})${EDGE_R}`, 'giu');
  return text.replace(combined, (...args: unknown[]) => {
    const groups = args.slice(1, 1 + entries.length);
    const i = groups.findIndex((g) => g !== undefined);
    return i >= 0 ? entries[i].r.text : String(args[0]);
  });
}
