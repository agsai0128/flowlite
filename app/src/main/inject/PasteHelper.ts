// Persistent ("warm") paste pen. One long-lived helper process does its one-time
// Add-Type setup at startup and then waits on stdin; each press() signals it and
// resolves on the "ok" ack. If the warm helper is down (never started, crashed, or
// between backoff attempts), press() falls back to the one-shot pen so a paste never
// silently fails. Lifecycle (start/stop/backoff) mirrors KeyHookSource.
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { PastePen } from './types';
import { parsePasteLine } from './types';

const ACK_TIMEOUT_MS = 1500;

/** Restart backoff ladder: 1s, 5s, 30s, then stay on the one-shot fallback. */
export function nextPasteBackoff(attempt: number): number | null {
  const ladder = [1000, 5000, 30000];
  return attempt < ladder.length ? ladder[attempt] : null;
}

export interface PasteHelperOptions {
  helperRoot: string;
  /** Used when the warm helper is unavailable. */
  fallback: PastePen;
  log?: (msg: string) => void;
  ackTimeoutMs?: number;
  /** Test seam: supply a fake child process instead of spawning PowerShell. */
  spawnHelper?: (script: string) => ChildProcess;
}

export class PasteHelper implements PastePen {
  private child: ChildProcess | null = null;
  private ready = false;
  private attempt = 0;
  private stopped = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: { resolve: () => void; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private readonly opts: PasteHelperOptions) {}

  start(): void { this.stopped = false; this.attempt = 0; this.spawnOnce(); }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.settlePending();
    try { this.child?.stdin?.end(); } catch { /* already closing */ }
    this.child?.kill();
    this.child = null;
    this.ready = false;
  }

  private spawnOnce(): void {
    const script = join(this.opts.helperRoot, 'helper', 'win', 'paste-helper.ps1');
    let child: ChildProcess;
    try {
      child = this.opts.spawnHelper
        ? this.opts.spawnHelper(script)
        : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
    } catch (e) {
      this.opts.log?.(`paste-helper: spawn failed (${(e as Error).message})`);
      this.scheduleRestart();
      return;
    }
    this.child = child;

    let buf = '';
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const ev = parsePasteLine(line);
        if (ev === 'ready') { this.ready = true; this.attempt = 0; this.opts.log?.('paste-helper: ready'); }
        else if (ev === 'ok') this.settlePending();
      }
    });
    child.on('error', (e) => this.opts.log?.(`paste-helper: ${(e as Error).message}`));
    child.on('close', () => {
      this.child = null;
      this.ready = false;
      this.settlePending(); // don't leave an insert hanging if the process dies mid-press
      if (!this.stopped) this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    const delay = nextPasteBackoff(this.attempt++);
    if (delay === null) { this.opts.log?.('paste-helper: unavailable; using one-shot fallback until next launch'); return; }
    this.restartTimer = setTimeout(() => this.spawnOnce(), delay);
  }

  private settlePending(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const { resolve } = this.pending;
    this.pending = null;
    resolve();
  }

  async press(): Promise<void> {
    // Warm helper down or busy with another press → one-shot fallback.
    if (!this.ready || !this.child?.stdin?.writable || this.pending) {
      return this.opts.fallback.press();
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => { this.pending = null; resolve(); }, this.opts.ackTimeoutMs ?? ACK_TIMEOUT_MS);
      this.pending = { resolve, timer };
      this.child!.stdin!.write('paste\n');
    });
  }
}
