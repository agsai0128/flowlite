// Inserts final text into the focused app on Windows using the clipboard-paste
// strategy: remember the clipboard, put our text on it, send a paste keystroke via the
// injected PastePen, then restore the clipboard. The keystroke and the clipboard are
// both ports (PastePen / Clipboard) so the ordering is testable without a desktop.
//
// In dryRun mode nothing is copied or pasted — it just logs. This keeps the core
// pipeline testable headlessly and is the safe default for CI.
import type { TextInjector } from '../../shared/types';
import type { Clipboard, PastePen } from './types';

/** Default clipboard adapter over Electron (lazy-required so tests can run under node). */
function electronClipboard(): Clipboard {
  const { clipboard } = require('electron') as typeof import('electron');
  return { readText: () => clipboard.readText(), writeText: (t) => clipboard.writeText(t) };
}

export interface WindowsInjectorOptions {
  dryRun: boolean;
  /** How the Ctrl+V keystroke is delivered. */
  pen: PastePen;
  /** Defaults to the Electron clipboard; injectable for tests. */
  clipboard?: Clipboard;
  /** ms to wait after pasting before restoring the clipboard. */
  restoreDelayMs?: number;
}

export class WindowsInjector implements TextInjector {
  constructor(private opts: WindowsInjectorOptions) {}

  async insertAtCursor(text: string): Promise<void> {
    if (!text) return;
    if (this.opts.dryRun) {
      console.log(`[inject:dry-run] would insert at cursor: ${JSON.stringify(text)}`);
      return;
    }
    const cb = this.opts.clipboard ?? electronClipboard();
    const previous = cb.readText();
    cb.writeText(text);
    await this.opts.pen.press();
    const delay = this.opts.restoreDelayMs ?? 100;
    await new Promise((r) => setTimeout(r, delay));
    cb.writeText(previous);
  }
}
