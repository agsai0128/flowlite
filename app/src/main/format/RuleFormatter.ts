// Offline, deterministic transcript clean-up. Always available; used on its own
// (formatter=rules) and as the safety net the cloud formatter falls back to.
// Pure string logic, no I/O — never throws. Works on raw ASR text and on text the
// engine has already punctuated/capitalised (e.g. Deepgram smart formatting).
import type { Formatter } from '../../shared/types';

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'hm', 'hmm']);

// Spoken punctuation commands -> the character they insert.
const PUNCT: Record<string, string> = {
  comma: ',',
  'question mark': '?',
  'exclamation mark': '!',
  'exclamation point': '!',
  'full stop': '.',
  colon: ':',
  semicolon: ';',
};

const BREAK = '\u0001'; // sentinel for a spoken line break
const TRAILING = /[.,!?;:]+$/; // punctuation an engine may attach to a word
const isBreak = (t: string) => t.includes(BREAK);
const isPunctOnly = (t: string) => /^[.,!?;:]+$/.test(t);
const bare = (t: string) => t.toLowerCase().replace(TRAILING, '');

/** Push a mark, superseding punctuation the engine put on the previous word. */
function pushMark(out: string[], mark: string) {
  if (out.length === 0 || isBreak(out[out.length - 1])) return; // never lead a line with punctuation
  const stripped = out[out.length - 1].replace(TRAILING, '');
  if (stripped) out[out.length - 1] = stripped; else out.pop();
  if (out.length === 0 || isBreak(out[out.length - 1])) return;
  out.push(mark);
}

/** Push a line break, dropping a comma/semicolon/colon right before it. */
function pushBreak(out: string[], token: string) {
  const last = out.length - 1;
  if (last >= 0 && !isBreak(out[last])) {
    const cleaned = out[last].replace(/[,;:]+$/, '');
    if (cleaned) out[last] = cleaned; else out.pop();
  }
  out.push(token);
}

export function formatTranscript(input: string): string {
  let s = (input ?? '').trim();
  if (!s) return '';

  // Spoken line-break commands become sentinel tokens.
  s = s.replace(/\bnew paragraph\b/gi, ` ${BREAK}${BREAK} `).replace(/\bnew line\b/gi, ` ${BREAK} `);

  const words = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (isBreak(w)) { pushBreak(out, w); continue; }
    if (isPunctOnly(w)) { pushMark(out, w); continue; } // stray engine punctuation
    const lower = bare(w);
    const next = words[i + 1];
    // Two-word commands ("question mark", "full stop", ...).
    const pair = next !== undefined ? PUNCT[`${lower} ${bare(next)}`] : undefined;
    if (pair !== undefined) { pushMark(out, pair); i++; continue; }
    if (PUNCT[lower] !== undefined) { pushMark(out, PUNCT[lower]); continue; }
    // "period" is punctuation only at the end or right before a line break.
    if (lower === 'period' && (next === undefined || isBreak(next))) { pushMark(out, '.'); continue; }
    // Drop standalone fillers, keeping ALL-CAPS words such as "ER".
    if (FILLERS.has(lower)) {
      const letters = w.replace(/[^A-Za-z]/g, '');
      const allCaps = letters.length > 1 && letters === letters.toUpperCase();
      if (!allCaps) continue;
    }
    out.push(w);
  }

  let text = out
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1') // no space before punctuation
    .replace(/,{2,}/g, ',') // collapse comma runs
    .replace(/,(?=[.?!])/g, '') // drop a comma right before . ? !
    .replace(/[ \t]{2,}/g, ' ');

  // Sentinels -> real line breaks; trim each line.
  text = text.replace(/\s*\u0001\u0001\s*/g, '\n\n').replace(/\s*\u0001\s*/g, '\n');
  text = text.split('\n').map((l) => l.trim()).join('\n').trim();

  // Standalone "i" and its contractions (not the "i" in "i.e.").
  text = text.replace(/\bi\b(?!\.\w)/g, 'I');

  // Capitalise the first letter of the text, each sentence, and each line.
  text = text.replace(/(^|[.!?]\s+|\n\s*)(\p{Ll})/gu, (_m, p: string, c: string) => p + c.toUpperCase());

  // Full stop for a 3+ word text that ends in a word (not after , ; : etc.).
  if (text.split(/\s+/).length >= 3 && /[\p{L}\p{N}"'’)\]]$/u.test(text)) text += '.';

  return text;
}

export class RuleFormatter implements Formatter {
  readonly name = 'rules';
  async format(raw: string): Promise<string> {
    try { return formatTranscript(raw); }
    catch { return (raw ?? '').trim(); }
  }
}
