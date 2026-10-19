// Reads the focused text field on Windows via a small UI Automation helper.
// Only the focused element is read — never other windows, input, or the clipboard.
// Never throws: any failure or timeout yields an empty context.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { ContextProvider, FocusContext } from '../../shared/types';

const MAX_PRECEDING = 300;
const MAX_SELECTED = 2000;

/** Parse the helper's JSON line into a FocusContext, keeping only string fields. */
export function parseFocus(raw: string): FocusContext {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: FocusContext = {};
    if (typeof o.app === 'string' && o.app.trim()) out.app = o.app.trim();
    if (typeof o.selectedText === 'string' && o.selectedText) out.selectedText = o.selectedText.slice(0, MAX_SELECTED);
    if (typeof o.precedingText === 'string' && o.precedingText) out.precedingText = o.precedingText.slice(-MAX_PRECEDING);
    return out;
  } catch {
    return {};
  }
}

export interface WindowsContextProviderOptions {
  appRoot: string;
  timeoutMs: number;
  /** Test seam: return the helper's raw stdout, or throw/hang. */
  run?: () => Promise<string>;
}

export class WindowsContextProvider implements ContextProvider {
  readonly name = 'windows-uia';
  constructor(private opts: WindowsContextProviderOptions) {}

  private runHelper(): Promise<string> {
    const script = join(this.opts.appRoot, 'helper', 'win', 'context.ps1');
    return new Promise((resolve) => {
      let out = '';
      const ps = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { windowsHide: true }
      );
      ps.stdout.on('data', (d) => { out += d.toString(); });
      ps.on('error', () => resolve(''));
      ps.on('close', () => resolve(out));
    });
  }

  async capture(): Promise<FocusContext> {
    const run = this.opts.run ?? (() => this.runHelper());
    try {
      const raw = await Promise.race([
        run(),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), this.opts.timeoutMs)),
      ]);
      return parseFocus(raw);
    } catch {
      return {};
    }
  }
}
