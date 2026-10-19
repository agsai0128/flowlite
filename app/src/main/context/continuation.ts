// Layer 4 offline continuation fix: make the inserted text join the field's
// existing text naturally, using only the captured preceding text. Pure, no I/O,
// sends nothing anywhere. Never throws.
import type { FocusContext } from '../../shared/types';
import { COMMON_WORDS } from '../vocab/dictionary';

const ATTACHING = /^[,.!?;:]/; // punctuation that should hug the previous word
const ENDS_SENTENCE = /[.!?]["')\]]?$/; // preceding text ends a sentence

/** First whitespace-delimited token of a string (may carry trailing punctuation). */
function firstToken(s: string): string {
  const m = s.match(/^\s*(\S+)/);
  return m ? m[1] : '';
}

export function applyContinuation(text: string, focus?: FocusContext): string {
  const prev = focus?.precedingText;
  if (!text || prev === undefined || prev === null) return text;
  if (prev.trim() === '' && !/\S/.test(prev)) {
    // Field is effectively empty: no leading space, keep as-is.
    if (prev.length === 0) return text;
  }

  let out = text;

  // Continuation case: mid-sentence -> lower-case a common first word only.
  const prevRightTrimmed = prev.replace(/\s+$/u, '');
  const midSentence = prevRightTrimmed !== '' && !ENDS_SENTENCE.test(prevRightTrimmed);
  if (midSentence) {
    const token = firstToken(out);
    const word = token.replace(/[^\p{L}\p{N}'’]/gu, '');
    const lower = word.toLowerCase();
    const isI = lower === 'i' || lower.startsWith("i'") || lower.startsWith('i’');
    if (word && !isI && COMMON_WORDS.has(lower) && /^\p{Lu}/u.test(out)) {
      out = out.replace(/^(\s*)(\p{Lu})/u, (_m, ws: string, c: string) => ws + c.toLowerCase());
    }
  }

  // Leading space: join to preceding text when neither side already has a boundary.
  const needSpace =
    prevRightTrimmed !== '' && !/\s$/u.test(prev) && !/^\s/u.test(out) && !ATTACHING.test(out);
  if (needSpace) out = ' ' + out;

  return out;
}
