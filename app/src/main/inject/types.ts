// Seams for text insertion. The injector keeps the clipboard-paste strategy; these
// ports make the two side-effecting pieces — the paste keystroke and the clipboard —
// swappable, so the save/write/press/restore ordering is testable without a desktop.

/** Sends one paste chord (Ctrl+V) to the foreground window; resolves when sent. */
export interface PastePen {
  press(): Promise<void>;
}

/** The system clipboard, narrowed to what the injector uses. */
export interface Clipboard {
  readText(): string;
  writeText(text: string): void;
}

export type PasteLine = 'ready' | 'ok';

/** Parse one line of the persistent paste helper's stdout. Null for noise/partials. */
export function parsePasteLine(line: string): PasteLine | null {
  const t = line.trim();
  return t === 'ready' || t === 'ok' ? t : null;
}
