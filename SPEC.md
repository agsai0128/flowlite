# SPEC.md — FlowLite behaviour spec

This is a **behaviour-only** specification for FlowLite, an original push-to-talk
dictation app. It describes what the app does, not how it is coded; the app is
implemented from *this document*.

## Scope
- **v1: the core loop (done).** Press a hotkey, speak, and the spoken words are
  inserted at the current text cursor in whatever app has focus.
- **Layer 2: transcript clean-up and formatting (done).** Between the final
  transcript and insertion, a formatter turns raw speech-to-text into the text the
  speaker meant to type. See § Transcript clean-up.
- **Layer 3: personal dictionary and text replacements (done).** Words and names
  the user wants recognised and spelled their way, and spoken trigger phrases that
  insert stored text. See § Personal dictionary and text replacements.
- **Layer 4: focused-field context awareness (this milestone).** Read the text
  field being dictated into so the inserted text continues naturally. See
  § Focused-field context.
- Later milestones: history UI, settings UI, learning new dictionary words from
  the user's edits.

## Architecture
Seven parts, each depending only on the interfaces below it:
1. **Transcription engine (swappable).** An interface `AsrEngine` that opens a
   streaming session, accepts mono 16 kHz PCM audio chunks, and emits partial and
   final transcripts. Implementations: an **offline mock** (default; returns a
   canned transcript so the app runs with no account) and a **cloud streaming**
   engine (WebSocket). The rest of the app depends only on the interface.
2. **Core orchestrator (Electron main process).** Owns a small state machine
   (`idle → listening → finalizing → idle`), the global hotkey, the transcription
   session, and text insertion.
3. **UI + capture (one small always-on-top window).** Captures the microphone and
   shows a listening indicator. It is **non-activating** so it never steals focus
   from the app you are dictating into.
4. **Text inserter (native, per-OS).** Inserts final text into the focused app.
   Windows v1: set the clipboard to the text, send a paste keystroke to the
   foreground window via a small native component, then restore the previous
   clipboard. A direct-typing fallback is a later milestone.
5. **Formatter (swappable, layer 2).** An interface `Formatter` that turns the
   final raw transcript into clean text before insertion. Implementations: an
   **offline rule-based** formatter (always available) and a **cloud LLM**
   formatter (uses the user's own API key). The orchestrator depends only on the
   interface.
6. **Vocabulary (layer 3).** The user's dictionary and text replacements, read
   from settings. Supplies recognition hints to the engine, spelling context to the
   cloud formatter, and two deterministic offline steps after formatting: a
   dictionary spelling fix, then text replacements.
7. **Context provider (layer 4, per-OS, swappable).** An interface
   `ContextProvider` that reads the focused text field — the app name, any selected
   text, and the text just before the cursor. Implementations: a **Windows**
   provider (UI Automation via a small native component) and a **no-op** provider
   (other OSes, or when context awareness is off). Never throws; returns an empty
   context when anything is unavailable.

## Activation gestures (hold-to-talk & double-tap)
Two ways to start a session, both ending at the same `listening → finalizing`
machine below.

- **Toggle hotkey** (always available): a key chord (default Ctrl+Shift+Space)
  registered with the OS. One press starts, the next ends. Unchanged from v1.
- **Dictation key** (default **Caps Lock**): a single key read by a native
  low-level keyboard hook (the OS shortcut API cannot see key *hold* or *release*).
  It drives two gestures:
  - **Hold-to-talk**: key down starts listening *immediately* (so no first word is
    lost); releasing after at least the **hold threshold** (default 300 ms) ends the
    session and inserts.
  - **Double-tap**: a tap (a release before the hold threshold) opens a
    **double-tap window** (default 400 ms); a second press inside it locks a
    **hands-free** session that keeps listening until a single later tap ends it. A
    tap with no second press inside the window is an **accidental tap** and is
    **discarded** — nothing is inserted.

Rules, all offline and deterministic:
- The dictation key is **swallowed** by the hook, so Caps Lock does not toggle
  while it is the dictation key. Every other key passes through untouched.
- **Abort**: any *other* key pressed while the dictation key is held ends the
  session with nothing inserted (the keystroke was a shortcut, not dictation).
- **Session cap** (default 5 min) and **screen lock** both end any session and
  **insert** what was said so far (guard against a missed key-up).
- Gesture interpretation is a pure state machine; the hook is a dumb event source
  reporting only `down`/`up` of the dictation key and an anonymous `other` signal.
  It ignores injected (synthetic) events, so the app's own paste keystroke cannot
  trigger it.
- `activationMode` selects which entry points are live: `toggle`, `hold`, or
  `both` (default). `dictationKey` chooses the key (Caps Lock, Right Ctrl, Right
  Alt, F13–F24).

## State machine
- `idle`: hotkey registered; indicator hidden.
- hotkey pressed in `idle` → `listening`: re-read the vocabulary from settings,
  **capture the focused-field context once, now** (concurrently, so it adds no
  latency), open the engine session (with dictionary hints), show the indicator,
  start microphone capture. Context is captured at the moment of the hotkey press,
  while the target field still has focus (the indicator never takes focus).
- `listening`: audio chunks stream to the engine; partial transcripts update the
  indicator.
- hotkey pressed in `listening` → `finalizing`: stop capture, flush engine, wait
  for the final transcript.
- final transcript received → **format it** (layer 2) → **dictionary spelling fix**
  → **text replacements** (layer 3) → **continuation fix from the captured context**
  (layer 4) → insert text at cursor → `idle` (hide indicator). The hotkey is
  ignored while `finalizing`.
- If the hotkey stops a session while the engine is still connecting, the
  session is abandoned and the microphone is **never** started for it.
- Errors (no mic, engine failure, bad key) → show the message in the indicator for
  a few seconds, return to `idle`, then hide the indicator.

## Public API (internal interfaces)
```
AsrEngine.start({ sampleRate, language?, hints?, onPartial, onFinal, onError }) -> AsrSession
AsrSession.sendAudio(pcm16leChunk)
AsrSession.finish() -> Promise<void>

TextInjector.insertAtCursor(text) -> Promise<void>

Formatter.format(rawTranscript, { language?, dictionary? }) -> Promise<cleanText>   // never throws

buildVocabulary(dictionaryJson, replacementsJson) -> { terms, replacements }   // skips invalid entries
recognitionHints(terms) -> string[]
applyDictionary(text, terms) -> text
applyReplacements(text, replacements) -> text

ContextProvider.capture() -> Promise<FocusContext>   // { app?, selectedText?, precedingText? }; never throws
applyContinuation(text, focus) -> text               // offline leading-case/spacing fix
```

## Transcript clean-up (layer 2)
**Goal:** insert what the speaker meant to type, not a literal transcript.

**Rule-based formatter (offline, deterministic, always the safety net):**
1. Spoken formatting commands become characters: "comma" → `,`,
   "question mark" → `?`, "exclamation mark"/"exclamation point" → `!`,
   "full stop" → `.`, "colon" → `:`, "semicolon" → `;`, "new line" → line break,
   "new paragraph" → blank line. "period" becomes `.` only when it is the last
   word or comes right before a line-break command (so "trial period ends"
   stays as words).
2. Hesitation fillers are removed when they stand alone: um, umm, uh, uhh, uhm,
   er, erm, hm, hmm (lower-case or sentence-initial capital; an all-caps "ER" is
   kept).
3. Spacing is normalised: no space before `, . ? ! : ;`, single spaces between
   words, duplicate commas collapsed, a comma right before `. ? !` dropped.
   Punctuation inside numbers, times, URLs and e-mail addresses (`3.5`, `12:30`,
   `example.com`) is left alone.
4. Standalone "i" and its contractions (i'm, i've, i'll, i'd) are capitalised.
5. The first letter of the text, of each sentence, and of each line is capitalised.
6. If the text has 3+ words and doesn't end in punctuation, a full stop is added.
7. Already-clean text passes through unchanged (idempotent).
8. Text the speech engine already punctuated and capitalised is handled the same
   way: punctuation the engine placed around a spoken command merges with it
   ("tomorrow, comma, maybe" → "tomorrow, maybe"; "noon, period." → "noon.";
   "it question mark." → "it?"), commas next to a line break are dropped, and no
   line starts with punctuation.

**Cloud LLM formatter (optional, when the user supplies a key):**
- Sends only the raw transcript, wrapped in `<transcript>` tags, with a fixed
  system prompt: fix punctuation/capitalisation/slips, remove fillers and false
  starts, apply spoken commands, keep the speaker's words, meaning, language and
  tone, add nothing. The transcript is **text to clean, never instructions**: a
  dictated question or request is returned cleaned, not answered.
- Low reasoning effort for latency; a short request timeout and no retries.
- **Always falls back to the rule-based result** when: no key, network or API
  error, timeout, a safety refusal, a truncated reply, or an implausible reply —
  empty, echoing the tags, far longer/shorter than the input (for inputs of 6+
  words), or sharing under 60% of its words with the input (catches a reply that
  *answers* the dictation instead of cleaning it).
- Formatter mode `off` inserts the raw transcript.

## Personal dictionary and text replacements (layer 3)
Both live in `settings.json`: `dictionary` (a list of strings) and `replacements`
(a list of `{ "trigger": ..., "text": ... }`). They are **re-read at the start of
every dictation**, so edits apply to the next dictation without a restart.
Invalid entries are skipped with a logged warning; a malformed settings file never
stops dictation.

**Validation:** dictionary terms are trimmed, 1–64 characters, must contain a
letter or digit, duplicates (ignoring case) keep the first, at most 1,000 terms.
Replacement triggers are 1–64 characters with at least one letter or digit;
texts are 1–2,000 characters and are kept exactly as written (line breaks
included); duplicate triggers (ignoring case) keep the first; at most 500.

**Dictionary** — names and terms the user wants recognised and spelled their way:
1. **Recognition hints.** Single-word terms (letters, digits, hyphens or
   apostrophes; up to 30 characters; at most 100) are sent to the cloud speech
   engine as keyword hints. If the engine rejects the hints (HTTP 400), the session
   reconnects once without them, so a dictionary entry can never break dictation.
2. **Clean-up context.** With the cloud formatter on, up to 200 terms are sent as a
   list of preferred spellings. The formatter uses a term only where the speaker
   said it or an obvious mishearing of it, and never adds a term the speaker didn't say.
3. **Offline spelling fix** (after clean-up). A term matches its letters and digits
   in order, ignoring case, as whole words, with an optional space, hyphen, dot or
   apostrophe between its parts. Parts split at spaces and punctuation and where
   letter case or letter/digit changes ("GitHub" matches "github" and "git hub";
   "ChatGPT" matches "chat gpt"; "Node.js" matches "node js" and "nodejs"). A term
   with other symbols ("C++") matches only its exact text, ignoring case. A match
   is rewritten to the term's spelling — **except** when the matched text is a
   single common English word ("it" for "IT", "us" for "U.S."), or when it differs
   only in letter case from a term that is a single capitalised word ("Will",
   "Mark", "Siobhan"). Such terms rely on hints and clean-up context instead, so
   everyday words are never changed. Applying the fix twice changes nothing more.

**Text replacements** — say a trigger phrase, get the stored text:
1. Applied **last**, after clean-up and the dictionary fix, so the stored text is
   inserted exactly as written. Replacement texts are never sent anywhere.
2. A trigger matches ignoring case, as whole words; up to three spaces or
   punctuation characters between its words are tolerated (not line breaks).
3. One pass, longest trigger first: "my work email" wins over "my email", and
   inserted text is never matched again.
4. Punctuation around the trigger is kept ("send it to my email." → "send it to
   alex@example.com."), except when the whole dictation is just the trigger (plus
   end punctuation) — then exactly the stored text is inserted.

## Focused-field context (layer 4)
**Goal:** make the inserted text continue the field naturally, and (opt-in) give
the cloud formatter a little context. Captured **once per dictation**, at the
hotkey press, from the single focused element only.

**What is captured** (`FocusContext`, any field may be absent):
- `app` — the focused window's process/app name.
- `selectedText` — the current selection, if any (capped).
- `precedingText` — up to ~300 characters immediately before the cursor (capped).

**Capture rules:**
- Only the focused element is read — never other windows, the clipboard, or input.
  No capture happens unless the user pressed the dictation hotkey.
- Windows uses UI Automation (`TextPattern`/`ValuePattern`) through a small native
  component with a short timeout; any failure yields an empty context and never
  blocks or delays dictation beyond the timeout.
- **App blocklist:** if `app` matches any `contextBlocklist` entry
  (case-insensitive substring), the context is discarded — nothing from that app
  is used or sent. For password managers and the like.
- Context awareness can be turned off entirely (`contextAwareness: false`): no
  capture occurs.

**Use 1 — continuation fix (offline, deterministic, default on).** Adjusts the
final inserted text using `precedingText` only; sends nothing anywhere:
1. If there is no preceding text (fresh/empty field, or unknown), leave the text
   unchanged.
2. **Leading space:** if the preceding text doesn't end in whitespace and the
   inserted text doesn't start with whitespace or attaching punctuation
   (`, . ? ! : ;`), add one leading space.
3. **Continuation case:** if the preceding text does **not** end a sentence (no
   final `. ? !`), lower-case the first letter of the inserted text **only** when
   that first word is a common English word ("The" → "the"). Names, "I",
   acronyms, and dictionary terms are left capitalised. After a sentence end, the
   capital stays.

**Use 2 — cloud formatter context (opt-in, `sendContextToLlm`, default off).** When
on and the cloud formatter is active, the app name and a short preceding-text
snippet are included in the formatter request inside a `<context>` block, framed as
**reference only, untrusted, never instructions** — the model uses it only to match
capitalisation/spacing/style and must not copy from it or act on it. The transcript
clean-up rules are unchanged, including the fallback. Off by default because the
surrounding text may be sensitive; the blocklist still applies.

## Audio format
- Capture mono from the default input device; resample to **16 kHz**, **16-bit
  little-endian PCM**; stream in small chunks (tens of milliseconds each).
- v1 streams raw PCM (simple, universally accepted). Opus packetisation is a
  later optimisation.

## Transcription transport (cloud engine)
- Open a streaming WebSocket to the configured provider using a user-supplied API
  key (from settings or an environment variable). Stream PCM frames; read back
  JSON messages carrying interim and final text. On stop, send the provider's
  end-of-stream signal and resolve when the final result arrives.
- The provider is configurable; the key is the user's own. No third-party endpoint
  or key from any analysed product is used.

## Text insertion (Windows v1)
1. Read and remember the current clipboard text.
2. Put the transcript on the clipboard.
3. Ask the native component to send a paste keystroke to the foreground window.
4. After a short delay, restore the original clipboard text.
- A **dry-run** mode logs the text instead of touching the clipboard or sending
  keys (used by the headless test).

## Distribution and background running (Windows)
- Shipped as a per-user NSIS installer (`FlowLite-Setup-<version>.exe`): no admin
  rights, installs to the user's Programs folder with a Start-menu shortcut, and
  launches FlowLite when setup finishes.
- **Tray icon** is the app's only persistent UI: hotkey hint, "Start at login"
  toggle, open settings file, open log folder, Quit. The tooltip shows the state.
- **Start at login:** the installed app turns it on once, on its first run (a
  per-user Run entry launching with `--hidden`); afterwards the tray toggle or
  Windows' Startup settings decide. Development builds never register themselves.
- **Single instance:** a second launch exits; the running instance shows a notice.
- **Logs:** console output is mirrored to `<userData>/logs/flowlite.log`, rotated
  at ~1 MB, and never includes dictated text.
- **Uninstall** removes the app and its start-at-login entry and keeps
  `settings.json` (keys, dictionary) unless the user deletes it.
- Native helper scripts ship as plain files beside the app (outside its archive)
  so they can be executed.
- The installer is unsigned unless a code-signing certificate is supplied, so
  SmartScreen may warn on first run.

## Privacy requirements (must-haves)
- The hotkey listener reacts **only** to its own configured combination; it does
  not record or inspect other keystrokes.
- A visible indicator is shown the entire time the microphone is active.
- Audio and any transcripts stay on the local machine except the audio sent to the
  user's chosen transcription provider during an active session.
- With the cloud formatter enabled, the final transcript **text** (not audio) is
  sent to the user's chosen LLM provider once per dictation. The rule-based
  formatter sends nothing anywhere.
- Dictionary terms are sent to the speech provider as hints, and to the LLM
  provider when the cloud formatter is on. Replacement texts never leave the machine.
- Focused-field context is read only on a hotkey press, only from the focused
  element. The offline continuation fix sends nothing anywhere. Surrounding text is
  sent to the LLM only when `sendContextToLlm` is explicitly enabled, and never for
  apps on `contextBlocklist`.
- No telemetry.

## Configuration
`engine` (`mock` | cloud id), provider API key, `language`, `hotkey`
(default a Ctrl+Shift combo), `dryRunInject`, `sampleRate` (default 16000).
Layer 2: `formatter` (`auto` | `rules` | `claude` | `off`; `auto` = cloud when a
key is configured, else rules), LLM API key, `formatModel`, `formatEffort`,
`formatTimeoutMs`. Layer 3: `dictionary`, `replacements`. Layer 4:
`contextAwareness` (default true), `sendContextToLlm` (default false),
`contextBlocklist` (default []), `contextTimeoutMs` (default 1500).
Read from an optional `settings.json` in the app's user-data folder and/or
environment variables.

## Test cases (v1 acceptance)
1. **Pipeline (headless):** mock engine produces a non-empty final transcript; the
   inserter in dry-run reports it would insert that exact text. *(automated)*
2. Hotkey toggles `idle ↔ listening`; indicator shows/hides accordingly. *(manual)*
3. With a cloud key set, speaking a sentence yields a matching final transcript. *(manual)*
4. Final text appears at the cursor in a plain text editor; the previous clipboard
   is restored afterward. *(manual)*
5. No microphone device → a clear error in the indicator, return to `idle`. *(manual)*

### Layer 2 acceptance (automated unless noted)
6. Rules: "um so i think we should meet tomorrow comma maybe at noon period" →
   "So I think we should meet tomorrow, maybe at noon."
7. Rules: "what time is it question mark" → "What time is it?"
8. Rules: "first line new line second line" → "First line\nSecond line."
9. Rules: "the trial period ends friday" → "The trial period ends friday." ("period" kept as a word).
10. Rules are idempotent: formatting already-clean text returns it unchanged.
10b. Engine-punctuated input: "Um, so I think we should meet tomorrow, comma, maybe at noon, period."
     → "So I think we should meet tomorrow, maybe at noon."
10c. "What time is it question mark." → "What time is it?"
10d. "First line, new line, second line." → "First line\nSecond line."
11. LLM formatter (fake client): a normal reply is used; the request carries the
    fixed system prompt and the `<transcript>`-wrapped text.
12. LLM formatter falls back to the rules result on: thrown API/network error,
    refusal, truncated reply, and a reply that answers instead of cleaning.
13. Pipeline: mock engine → rules formatter → dry-run insert yields formatted text.
14. With a real key, dictating into Notepad inserts clean, punctuated text. *(manual)*

### Activation-gesture acceptance (automated unless noted)
The pure gesture state machine is driven by a fake clock; each case lists the
actions it must emit, in order.
- A1 **hold**: down, release after ≥ threshold → `start`, `stopInsert`.
- A2 **accidental tap**: down, release < threshold, no second press → `start`,
  then `cancelDiscard` when the double-tap window elapses.
- A3 **double-tap → hands-free**: down, short release, second down within window,
  later single tap → `start`, `lockHandsFree`, `stopInsert`.
- A4 **abort**: down, then another key while held → `start`, `abort`.
- A5 **threshold is inclusive**: held exactly = threshold → `stopInsert` (a hold).
- A6 **session cap mid-hold**: down, advance past the cap → `start`, `stopInsert`.
- A7 **screen lock**: force-stop while holding or hands-free → `stopInsert`.
- A8 **other key is ignored in hands-free**; a single tap still ends it.
- A9 **other key during the double-tap window** discards (`cancelDiscard`).
- A10 **auto-repeat** down while already pressed emits no second `start`.
- A11 **second tap just outside the window** → `start`, `cancelDiscard`, `start`
  (a fresh session), not a double-tap.
- A12 **no stray action**: after a normal end, advancing past the cap emits nothing.
- A13 helper line parsing: `down`/`up`/`other` map through; anything else → null.
- A14 restart backoff ladder: 1 s, 5 s, 30 s, then give up.
- A15 `dictationKey` resolves to the right virtual-key code; unknown → Caps Lock.
- A16 With `dictationKey` held, speaking then releasing inserts clean text, and
  Caps Lock does **not** turn on. *(manual)*
- A17 Double-tapping starts hands-free; a single tap ends and inserts. *(manual)*

### Layer 3 acceptance (automated unless noted)
15. Dictionary fix: "we use github and chat gpt" with ["GitHub", "ChatGPT"] →
    "we use GitHub and ChatGPT"; "Github is great." → "GitHub is great.".
16. "built with node js on nodejs" with ["Node.js"] → "built with Node.js on Node.js";
    "ask obrien" with ["O'Brien"] → "ask O'Brien"; "I like c++ a lot" with ["C++"] → "I like C++ a lot".
17. Guards: with ["Will"], "I will call you" is unchanged; with ["IT"], "it works"
    is unchanged; with ["U.S."], "tell us more" is unchanged; with ["SQL"],
    "postgresql" is unchanged but "sql query" → "SQL query".
18. Applying the dictionary fix twice gives the same result as once.
19. Replacements: "send it to my email." with {my email → alex@example.com} →
    "send it to alex@example.com."; the whole dictation "My email." → "alex@example.com".
20. "my work email please" with triggers "my email" and "my work email" uses the
    longer one; inserted text containing a trigger is not replaced again.
21. Replacement texts are inserted literally: multi-line text and "$1"/"$&" survive.
22. Triggers don't match inside words ("sig" doesn't touch "signal").
23. Validation skips non-strings, empty and over-long entries, and duplicates.
24. Hints: only single-word terms become hints, capped at 100.
25. Cloud engine: a 400 when connecting with hints reconnects once without them;
    a 401 is reported as a rejected API key.
26. Cloud formatter request includes the preferred-spellings list only when the
    dictionary is non-empty.
27. Pipeline: mock engine → format → dictionary → replacements → dry-run insert.
28. Live: a dictionary name is spelled correctly and a trigger inserts its text in
    Notepad. *(manual)*

### Layer 4 acceptance (automated unless noted)
29. Continuation, mid-sentence: preceding "I was thinking" + "The cat sat." →
    " the cat sat." (leading space added, "The"→"the").
30. Continuation, after a sentence: preceding "Done. " + "Next item." → "Next item."
    (capital kept; no extra leading space because preceding ends in whitespace).
31. Continuation protects names/I/acronyms: preceding "ping" + "Alex is here." →
    " Alex is here."; preceding "tell" + "I will." → " I will." (not "i will").
32. No preceding text → text unchanged. Empty/whitespace preceding → unchanged except
    the leading-space rule does not add a space.
33. Leading space skipped when the inserted text starts with attaching punctuation
    (", ." etc.) or the preceding text already ends in whitespace.
34. Provider parsing (fake reader): valid JSON maps to `{app, selectedText,
    precedingText}`; malformed output, a timeout, or a throw yields `{}`.
35. Blocklist: a captured `app` matching `contextBlocklist` discards the whole
    context (empty result), case-insensitively.
36. Cloud request: with `sendContextToLlm` on and a context present, the request
    carries a `<context>` block after the transcript tags; with it off, no context
    is sent. Context text has angle brackets stripped.
37. Pipeline: mock engine → format → dictionary → replacements → continuation, with
    a preceding-text context, inserts naturally continued text. *(automated)*
38. Live: dictate into the middle of an existing sentence in Notepad; the inserted
    text joins without a double capital or a missing space. *(manual)*

### Distribution acceptance (automated unless noted)
39. Login-item policy: the installed app's first run enables start-at-login once;
    it is not re-enabled after the user turns it off; dev builds and smoke tests
    never register it.
40. Log lines are timestamped; the dry-run line carrying dictated text is never
    written to disk.
41. Generated icons are valid PNG/ICO files at the expected sizes.
42. The packaged (unpacked) build boots, finds its helper scripts outside the
    archive, loads its window, and registers the hotkey and tray.
43. Install → log in → dictate works; the tray toggle changes start-at-login;
    uninstall removes the startup entry and keeps settings. *(manual)*
