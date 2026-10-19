// The dictation key the native hook watches, by name → Windows virtual-key code.
// Only keys that are comfortable to hold and free of modifier-chord meaning are
// offered. Caps Lock is the default (the hook swallows it, so it won't toggle).

export interface KeyDef {
  /** Windows virtual-key code. */
  vk: number;
  /** Human-readable label for the tray/logs. */
  label: string;
}

export const DICTATION_KEYS: Record<string, KeyDef> = {
  CapsLock: { vk: 0x14, label: 'Caps Lock' },
  RightCtrl: { vk: 0xa3, label: 'Right Ctrl' }, // VK_RCONTROL
  RightAlt: { vk: 0xa5, label: 'Right Alt' },   // VK_RMENU
};
// F13..F24 are VK 0x7c..0x87 (F1 = 0x70).
for (let n = 13; n <= 24; n++) {
  DICTATION_KEYS['F' + n] = { vk: 0x70 + (n - 1), label: 'F' + n };
}

/** Resolve a configured key name; unknown names fall back to Caps Lock with a warning. */
export function resolveDictationKey(name: string, warn: (msg: string) => void = () => {}): KeyDef {
  const def = DICTATION_KEYS[name];
  if (def) return def;
  warn(`[hotkey] unknown dictationKey ${JSON.stringify(name)}; using Caps Lock`);
  return DICTATION_KEYS.CapsLock;
}
