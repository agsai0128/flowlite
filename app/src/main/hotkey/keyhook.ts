// Node side of the native dictation-key hook: spawns keyhook.ps1, parses its
// line-based output into gesture events, and keeps it alive with backoff. The
// interpretation of those events lives in GestureDetector; this is only the pipe.
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

export type HookEvent = 'down' | 'up' | 'other';

/** Parse one line of helper stdout. Returns null for noise/partial lines. */
export function parseHookLine(line: string): HookEvent | null {
  const t = line.trim();
  return t === 'down' || t === 'up' || t === 'other' ? t : null;
}

/** Restart backoff ladder: 1s, 5s, 30s, then give up until the next app launch. */
export function nextBackoffDelay(attempt: number): number | null {
  const ladder = [1000, 5000, 30000];
  return attempt < ladder.length ? ladder[attempt] : null;
}

export interface KeyHookOptions {
  helperRoot: string;
  vk: number;
  onEvent: (e: HookEvent) => void;
  onAvailability?: (up: boolean) => void;
  log?: (msg: string) => void;
  /** Test seam: supply a fake child process instead of spawning PowerShell. */
  spawnHook?: (script: string, vk: number) => ChildProcess;
}

export class KeyHookSource {
  private child: ChildProcess | null = null;
  private attempt = 0;
  private stopped = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: KeyHookOptions) {}

  start(): void {
    this.stopped = false;
    this.attempt = 0;
    this.spawnOnce();
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.child?.kill();
    this.child = null;
  }

  private spawnOnce(): void {
    const script = join(this.opts.helperRoot, 'helper', 'win', 'keyhook.ps1');
    let child: ChildProcess;
    try {
      child = this.opts.spawnHook
        ? this.opts.spawnHook(script, this.opts.vk)
        : spawn(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Vk', String(this.opts.vk)],
            { windowsHide: true },
          );
    } catch (e) {
      this.opts.log?.(`keyhook: spawn failed (${(e as Error).message})`);
      this.scheduleRestart();
      return;
    }
    this.child = child;
    this.opts.onAvailability?.(true);

    let buf = '';
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const ev = parseHookLine(line);
        if (ev) { this.attempt = 0; this.opts.onEvent(ev); }
      }
    });
    child.on('error', (e) => this.opts.log?.(`keyhook: ${(e as Error).message}`));
    child.on('close', () => {
      this.child = null;
      this.opts.onAvailability?.(false);
      if (!this.stopped) this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    const delay = nextBackoffDelay(this.attempt++);
    if (delay === null) {
      this.opts.log?.('keyhook: unavailable; falling back to toggle hotkey until next launch');
      this.opts.onAvailability?.(false);
      return;
    }
    this.opts.log?.(`keyhook: retrying in ${delay} ms`);
    this.restartTimer = setTimeout(() => this.spawnOnce(), delay);
  }
}
