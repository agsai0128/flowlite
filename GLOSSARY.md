# FlowLite

An original push-to-talk dictation app: press a key, speak, and cleaned-up text is
inserted at the cursor in whatever app has focus.

## Language

### Session

**Dictation session**:
One activation of dictation, from the moment listening starts to the moment the
text is inserted at the cursor or discarded. A session is started by either
activation path (the toggle hotkey or the dictation key) and owns the
`idle → listening → finalizing` lifecycle.
_Avoid_: recording, request, capture (that is the audio layer, not the lifecycle).

**Session view**:
Everything a dictation session says to the outside world — the indicator window,
the renderer capture messages, and the tray tooltip — gathered behind one port so
the session never touches Electron directly.

### Activation

**Dictation key**:
The single physical key the user holds or taps to drive dictation (default: Caps
Lock). Distinct from the **toggle hotkey**, which is a key *chord* registered with
the OS. One key, read by the native hook, serves both the **hold** and
**double-tap** gestures.
_Avoid_: hotkey (reserve that for the chord), trigger.

**Toggle hotkey**:
A key chord (default Ctrl+Shift+Space) registered with the OS that starts a session
on one press and ends it on the next. A separate, always-available way in that
coexists with the dictation key.
_Avoid_: shortcut.

**Hold-to-talk**:
The gesture where the user holds the dictation key down, speaks, and releases to
end the session and insert the text. A release counts as hold-to-talk only once the
key has been down at least the **hold threshold**.

**Double-tap**:
Two quick taps of the dictation key, the second landing within the **double-tap
window**, which starts a **hands-free** session.

**Hands-free**:
A session that keeps listening with no key held, started by a double-tap and ended
by a single later tap of the dictation key (or the **session cap** or screen lock).

**Tap**:
A press-and-release of the dictation key shorter than the hold threshold. A lone
tap with no second tap inside the double-tap window is an **accidental tap**.

**Accidental tap**:
A single tap that is not followed by a second tap. Its brief session is discarded:
nothing is inserted.

**Hold threshold**:
The minimum time (default 300 ms) the dictation key must be held for a release to
count as hold-to-talk rather than a tap.

**Double-tap window**:
The time (default 400 ms) after a tap's release within which a second press is read
as a double-tap rather than an accidental tap.

**Session cap**:
The hard maximum length of any one session (default 5 minutes). On reaching it the
session ends and whatever was said is inserted, guarding against a missed key-up.

**Abort**:
Ending a hold session with nothing inserted because another key was pressed while
the dictation key was held — the keystroke was a shortcut, not dictation.
