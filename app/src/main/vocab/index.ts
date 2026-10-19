// Layer 3 vocabulary: validation of the user's settings, plus re-exports.
import type { Replacement, Vocabulary } from './types';

export type { Replacement, Vocabulary } from './types';
export { applyDictionary, recognitionHints } from './dictionary';
export { applyReplacements } from './replacements';

const MAX_TERMS = 1000;
const MAX_TERM_LENGTH = 64;
const MAX_REPLACEMENTS = 500;
const MAX_TRIGGER_LENGTH = 64;
const MAX_TEXT_LENGTH = 2000;
const HAS_ALNUM = /[\p{L}\p{N}]/u;

/**
 * Validate the `dictionary` and `replacements` values from settings.json.
 * Invalid entries are skipped with a warning. Warnings name entries by index
 * only — never their contents (replacement texts may be personal).
 */
export function buildVocabulary(
  dictionary: unknown,
  replacements: unknown,
  warn: (msg: string) => void = (m) => console.warn(m)
): Vocabulary {
  const terms: string[] = [];
  const seenTerms = new Set<string>();
  if (dictionary !== undefined) {
    if (!Array.isArray(dictionary)) {
      warn('[vocab] "dictionary" must be a list of strings; ignoring it.');
    } else {
      for (const [i, entry] of dictionary.entries()) {
        if (typeof entry !== 'string') { warn(`[vocab] dictionary[${i}] is not a string; skipped.`); continue; }
        const term = entry.trim();
        if (!term || term.length > MAX_TERM_LENGTH || !HAS_ALNUM.test(term)) {
          warn(`[vocab] dictionary[${i}] must be 1-${MAX_TERM_LENGTH} characters with a letter or digit; skipped.`);
          continue;
        }
        const key = term.toLowerCase();
        if (seenTerms.has(key)) { warn(`[vocab] dictionary[${i}] is a duplicate; skipped.`); continue; }
        if (terms.length >= MAX_TERMS) { warn(`[vocab] more than ${MAX_TERMS} dictionary terms; the rest are ignored.`); break; }
        seenTerms.add(key);
        terms.push(term);
      }
    }
  }

  const reps: Replacement[] = [];
  const seenTriggers = new Set<string>();
  if (replacements !== undefined) {
    if (!Array.isArray(replacements)) {
      warn('[vocab] "replacements" must be a list of { "trigger", "text" } objects; ignoring it.');
    } else {
      for (const [i, entry] of replacements.entries()) {
        const rec = entry as { trigger?: unknown; text?: unknown } | null;
        if (!rec || typeof rec !== 'object' || typeof rec.trigger !== 'string' || typeof rec.text !== 'string') {
          warn(`[vocab] replacements[${i}] needs string "trigger" and "text"; skipped.`);
          continue;
        }
        const trigger = rec.trigger.trim();
        if (!trigger || trigger.length > MAX_TRIGGER_LENGTH || !HAS_ALNUM.test(trigger)) {
          warn(`[vocab] replacements[${i}].trigger must be 1-${MAX_TRIGGER_LENGTH} characters with a letter or digit; skipped.`);
          continue;
        }
        if (!rec.text.trim() || rec.text.length > MAX_TEXT_LENGTH) {
          warn(`[vocab] replacements[${i}].text must be 1-${MAX_TEXT_LENGTH} characters; skipped.`);
          continue;
        }
        const key = trigger.toLowerCase();
        if (seenTriggers.has(key)) { warn(`[vocab] replacements[${i}] repeats an earlier trigger; skipped.`); continue; }
        if (reps.length >= MAX_REPLACEMENTS) { warn(`[vocab] more than ${MAX_REPLACEMENTS} replacements; the rest are ignored.`); break; }
        seenTriggers.add(key);
        reps.push({ trigger, text: rec.text });
      }
    }
  }

  return { terms, replacements: reps };
}
