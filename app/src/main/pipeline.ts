// Text pipeline from final transcript to inserted text:
//   clean-up (layer 2) -> dictionary spelling fix -> text replacements (layer 3)
//   -> continuation fix from focused-field context (layer 4).
import type { Formatter, FocusContext } from '../shared/types';
import { applyDictionary, applyReplacements, type Vocabulary } from './vocab';
import { applyContinuation } from './context';

export interface PipelineDeps {
  formatter: Formatter;
  vocab: Vocabulary;
  language?: string;
  /** Focused-field context captured at the hotkey press (layer 4). */
  focus?: FocusContext;
  /** Only send the surrounding text to the cloud formatter when the user opted in. */
  sendContextToLlm?: boolean;
}

/** Never throws: the formatter falls back internally, the other steps are pure. */
export async function processTranscript(raw: string, deps: PipelineDeps): Promise<string> {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  const formatted = await deps.formatter.format(trimmed, {
    language: deps.language,
    dictionary: deps.vocab.terms,
    focus: deps.sendContextToLlm ? deps.focus : undefined,
  });
  const spelled = applyDictionary(formatted, deps.vocab.terms);
  const replaced = applyReplacements(spelled, deps.vocab.replacements);
  return applyContinuation(replaced, deps.focus); // offline; uses precedingText only
}
