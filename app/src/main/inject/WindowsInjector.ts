// Inserts final text into the focused app on Windows using the clipboard-paste
// strategy: remember the clipboard, put our text on it, send a paste keystroke to
// the foreground window via a small native component, then restore the clipboard.
//
// In dryRun mode nothing is typed or copied — it just logs. This keeps the core
// pipeline testable headlessly and is the safe default for CI.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { TextInjector } from '../../shared/types';

export interface WindowsInjectorOptions {
  dryRun: boolean;
  /** Absolute path to the app root (to locate the helper script). */
  appRoot: string;
  /** ms to wait after sending paste before restoring the clipboard. */
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
    // Lazy-require electron so this module also loads under plain node (tests).
    const { clipboard } = require('electron') as typeof import('electron');
    const previous = clipboard.readText();
    clipboard.writeText(text);
    await this.sendPasteKeystroke();
    const delay = this.opts.restoreDelayMs ?? 180;
    await new Promise((r) => setTimeout(r, delay));
    clipboard.writeText(previous);
  }

  private sendPasteKeystroke(): Promise<void> {
    const script = join(this.opts.appRoot, 'helper', 'win', 'paste.ps1');
    return new Promise((resolve) => {
      const ps = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { windowsHide: true }
      );
      ps.on('error', (e) => { console.error('[inject] helper failed:', e.message); resolve(); });
      ps.on('close', () => resolve());
    });
  }
}
