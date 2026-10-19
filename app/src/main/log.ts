// File logger: mirrors console output to <userData>/logs/flowlite.log so the
// installed (terminal-less) app is diagnosable. Never persists dictated text — the
// dry-run insert line (which echoes text) is excluded. Rotates at ~1 MB.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 1024 * 1024;
const NOT_PERSISTED = '[inject:dry-run]';

function stringify(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.message;
  try { return JSON.stringify(a); } catch { return String(a); }
}

/** One log line, or null when the message must not be written to disk. */
export function formatLogLine(level: string, args: unknown[], now: Date = new Date()): string | null {
  const msg = args.map(stringify).join(' ');
  if (msg.includes(NOT_PERSISTED)) return null;
  return `${now.toISOString()} ${level.padEnd(5)} ${msg}\n`;
}

/** Tee console.log/warn/error into a rotating file. Returns the log file path. */
export function installFileLogger(dir: string): string {
  const file = join(dir, 'flowlite.log');
  try { mkdirSync(dir, { recursive: true }); } catch { return file; }
  const write = (level: string, args: unknown[]) => {
    const line = formatLogLine(level, args);
    if (!line) return;
    try {
      try {
        if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'flowlite.old.log'));
      } catch { /* no file yet */ }
      appendFileSync(file, line);
    } catch { /* logging must never break the app */ }
  };
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => { original(...args); write(level, args); };
  }
  return file;
}
