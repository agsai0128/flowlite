// Packaging/startup tests (headless): login-item policy, hotkey label, persisted
// state, log filtering, and the generated icon files.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hotkeyLabel, readState, shouldEnableLoginItemOnFirstRun, writeState } from '../main/startup';
import { formatLogLine } from '../main/log';

let failures = 0;
function eq(name: string, got: string, want: string) {
  if (got !== want) { failures++; console.error(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
  else console.log(`PASS ${name}`);
}
function ok(name: string, cond: boolean) {
  if (!cond) { failures++; console.error(`FAIL ${name}`); } else console.log(`PASS ${name}`);
}

// Login-item policy: installed app, first run only, never in smoke/dev.
ok('P1 installed first run -> enable', shouldEnableLoginItemOnFirstRun(true, {}, false));
ok('P2 already initialised -> respect user choice', !shouldEnableLoginItemOnFirstRun(true, { loginItemInitialized: true }, false));
ok('P3 dev build -> never', !shouldEnableLoginItemOnFirstRun(false, {}, false));
ok('P4 smoke test -> never', !shouldEnableLoginItemOnFirstRun(true, {}, true));

// Hotkey display.
eq('P5 hotkey label', hotkeyLabel('CommandOrControl+Shift+Space'), 'Ctrl+Shift+Space');
eq('P6 hotkey label passthrough', hotkeyLabel('Alt+F9'), 'Alt+F9');

// Persisted state round-trip (temp dir, never the real user folder).
const dir = mkdtempSync(join(tmpdir(), 'flowlite-state-'));
eq('P7 missing state -> {}', JSON.stringify(readState(dir)), '{}');
writeState(dir, { loginItemInitialized: true });
ok('P8 state round-trip', readState(dir).loginItemInitialized === true);
rmSync(dir, { recursive: true, force: true });

// Log lines: timestamped, and dictated text from dry-run is never persisted.
const line = formatLogLine('warn', ['[vocab] dictionary[2] is not a string; skipped.'], new Date('2026-10-18T00:00:00Z'));
eq('P9 log line format', line ?? '', '2026-10-18T00:00:00.000Z warn  [vocab] dictionary[2] is not a string; skipped.\n');
ok('P10 dry-run text never persisted', formatLogLine('log', ['[inject:dry-run] would insert at cursor: "secret"']) === null);

// Generated icons are valid (run `npm run icons` first).
const ico = readFileSync(join(process.cwd(), 'build', 'icon.ico'));
ok('P11 ICO header: type 1 with 7 images', ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) === 7);
const PNG_SIG = '89504e470d0a1a0a';
for (const [file, size] of [['build/icon.png', 256], ['assets/tray.png', 16], ['assets/tray@2x.png', 32]] as const) {
  const png = readFileSync(join(process.cwd(), file));
  ok(`P12 ${file} is a ${size}px PNG`,
    png.subarray(0, 8).toString('hex') === PNG_SIG && png.readUInt32BE(16) === size && png.readUInt32BE(20) === size);
}

if (failures) { console.error(`\n${failures} startup test(s) failed`); process.exit(1); }
console.log('\nALL STARTUP TESTS PASSED');
