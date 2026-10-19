// Personal dictionary: recognition hints for the speech engine, and the
// deterministic, offline spelling fix applied after clean-up. Pure string logic.
import { EDGE_L, EDGE_R, escapeRe } from './regex';

const MAX_HINTS = 100;
const MAX_HINT_LENGTH = 30;

// Everyday English words the spelling fix must never rewrite ("it" for the
// term "IT", "us" for "U.S."). Original list of very frequent words.
export const COMMON_WORDS = new Set(
  (
    'a about after again all also am an and any are as at back be because been before but by can come could ' +
    'day did do does down even first for from get give go good had has have he her here him his how i if in ' +
    'into is it its just know like look make man many may me more most much my new no not now of off oh ok ' +
    'okay on one only or other our out over people right said say see she so some take than that the their ' +
    'them then there these they thing think this those time to too two up us use very want was way we well ' +
    'were what when where which who why will with work would year yes yet you your'
  ).split(' ')
);

const SEPARATORS = /[\s\-.'’]+/u; // between a term's parts
const SEP = "[\\s\\-.'’]?"; // optional separator when matching
const PLAIN_TERM = /^[\p{L}\p{N}\s\-.'’]+$/u; // otherwise: exact-text match
const SINGLE_CAPITALISED = /^\p{Lu}\p{Ll}+$/u; // "Will", "Siobhan"
const HINT_TERM = /^[\p{L}\p{N}][\p{L}\p{N}'’-]*$/u; // single word

/** Split a term into parts at separators and at case / letter-digit changes. */
export function termParts(term: string): string[] {
  const parts: string[] = [];
  for (const chunk of term.split(SEPARATORS).filter(Boolean)) {
    const marked = chunk
      .replace(/(\p{Ll})(\p{Lu})/gu, '$1\u0000$2') // iPhone -> i|Phone
      .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1\u0000$2') // GPTModel -> GPT|Model
      .replace(/(\p{L})(\p{N})/gu, '$1\u0000$2') // B2 -> B|2
      .replace(/(\p{N})(\p{L})/gu, '$1\u0000$2'); // 2B -> 2|B
    parts.push(...marked.split('\u0000').filter(Boolean));
  }
  return parts;
}

function termRegex(term: string): RegExp | null {
  if (PLAIN_TERM.test(term)) {
    const parts = termParts(term);
    if (parts.length === 0) return null;
    return new RegExp(EDGE_L + parts.map(escapeRe).join(SEP) + EDGE_R, 'giu');
  }
  const left = /^[\p{L}\p{N}]/u.test(term) ? EDGE_L : '';
  const right = /[\p{L}\p{N}]$/u.test(term) ? EDGE_R : '';
  return new RegExp(left + escapeRe(term) + right, 'giu');
}

/** Rewrite dictionary terms to the user's spelling. Idempotent. */
export function applyDictionary(text: string, terms: readonly string[]): string {
  if (!text || terms.length === 0) return text;
  let out = text;
  for (const term of [...terms].sort((a, b) => b.length - a.length)) {
    const re = termRegex(term);
    if (!re) continue;
    out = out.replace(re, (m: string) => {
      if (m === term) return m;
      const singleToken = !/[\s\-.'’]/u.test(m);
      if (singleToken && COMMON_WORDS.has(m.toLowerCase())) return m; // everyday word
      if (m.toLowerCase() === term.toLowerCase() && SINGLE_CAPITALISED.test(term)) return m; // "will" vs "Will"
      return term;
    });
  }
  return out;
}

/** Single-word terms suitable as speech-engine keyword hints (max 100). */
export function recognitionHints(terms: readonly string[]): string[] {
  return terms.filter((t) => t.length <= MAX_HINT_LENGTH && HINT_TERM.test(t)).slice(0, MAX_HINTS);
}
