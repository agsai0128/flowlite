# 1. Hold-to-talk via a low-level keyboard hook that swallows the dictation key

Date: 2026-10-19

## Status

Accepted

## Context

Hold-to-talk and double-tap need key **down** and **up** timing. Electron's
`globalShortcut` only fires on a chord press — it cannot observe a key being held
or released — so it cannot drive these gestures. On Windows, the standard way to
observe raw key down/up globally is a low-level keyboard hook (`WH_KEYBOARD_LL`),
not the OS shortcut API.

The default dictation key is **Caps Lock**. Caps Lock is comfortable to hold, is
present on every keyboard, and carries no modifier-chord meaning. But it has a
side effect no other candidate key has: pressing it toggles the Caps Lock state
(the LED and subsequent capitalisation).

## Decision

Run one long-lived native helper (`helper/win/keyhook.ps1`) that installs a
`WH_KEYBOARD_LL` hook, and have its callback **swallow** the dictation key (return
a non-zero value instead of calling the next hook) so Caps Lock no longer toggles
while it serves as the dictation key. The helper reports only `down`/`up` for the
dictation key and an anonymous `other` signal for any other key; it never reports
which other key was pressed, and it ignores injected (synthetic) events so the
app's own paste keystroke cannot trigger it.

All gesture *interpretation* (hold vs tap vs double-tap, the thresholds, abort,
the session cap) lives in a pure, clock-injected state machine in the main process
(`src/main/hotkey/gesture.ts`), not in the helper. The helper is a dumb event
source.

## Consequences

- Holding Caps Lock to dictate no longer flips Caps Lock on. This is intended, but
  it is surprising, hence this record. If the user rebinds the dictation key to a
  non-toggling key (e.g. Right Ctrl, F13), swallowing is harmless.
- Swallowing is scoped to the dictation key only; every other key passes through
  untouched, so normal typing and shortcuts are unaffected.
- A low-level hook requires a message loop, so the helper is a persistent process
  (1–2 s to start), not a per-call script like the paste/context helpers. If it
  fails, the app falls back to the toggle hotkey and retries with backoff.
- The gesture logic being pure and in-process makes the behaviour fully unit
  testable without the OS hook; the helper stays small enough to verify by reading.
