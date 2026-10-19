// Start-at-login policy and small persisted app state (kept apart from the user's
// settings.json, which holds their keys and is never rewritten by the app).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Registry value name for the Run entry (also removed by the uninstaller). */
export const LOGIN_ITEM_NAME = 'FlowLite';
/** Passed when launched at login, so no "FlowLite is running" balloon appears. */
export const HIDDEN_ARG = '--hidden';

export interface PersistedState {
  loginItemInitialized?: boolean;
}

export function readState(dir: string): PersistedState {
  try {
    const o: unknown = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as PersistedState) : {};
  } catch {
    return {};
  }
}

export function writeState(dir: string, state: PersistedState): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  } catch { /* non-fatal */ }
}

/**
 * The installed app turns on start-at-login once, on its first run. After that
 * the user's choice (tray toggle / Windows Startup settings) is respected. The dev
 * build and smoke tests never register a login item.
 */
export function shouldEnableLoginItemOnFirstRun(isPackaged: boolean, state: PersistedState, smoke: boolean): boolean {
  return isPackaged && !smoke && !state.loginItemInitialized;
}

/** Display form of an Electron accelerator on Windows: "CommandOrControl+Shift+Space" -> "Ctrl+Shift+Space". */
export function hotkeyLabel(accelerator: string): string {
  return accelerator
    .split('+')
    .map((k) => (/^(CommandOrControl|CmdOrCtrl|Control|Ctrl)$/i.test(k) ? 'Ctrl' : k))
    .join('+');
}
