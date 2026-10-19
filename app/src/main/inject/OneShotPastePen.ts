// Fallback paste pen: spawns the one-shot paste script once per press. This is the
// pre-warm behaviour, kept as the fallback for when the persistent helper is down.
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { PastePen } from './types';

export class OneShotPastePen implements PastePen {
  constructor(
    private readonly helperRoot: string,
    /** Test seam: supply a fake child process instead of spawning PowerShell. */
    private readonly spawnPaste?: (script: string) => ChildProcess,
  ) {}

  press(): Promise<void> {
    const script = join(this.helperRoot, 'helper', 'win', 'paste.ps1');
    return new Promise((resolve) => {
      let ps: ChildProcess;
      try {
        ps = this.spawnPaste
          ? this.spawnPaste(script)
          : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
      } catch (e) {
        console.error('[inject] one-shot paste failed:', (e as Error).message);
        resolve();
        return;
      }
      ps.on('error', (e) => { console.error('[inject] one-shot paste failed:', (e as Error).message); resolve(); });
      ps.on('close', () => resolve());
    });
  }
}
