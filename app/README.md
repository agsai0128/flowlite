# FlowLite

An original push-to-talk dictation app: press a hotkey, speak, and your words are
inserted at the text cursor in whatever app has focus — cleaned up (layer 2), with
your own dictionary and text replacements applied (layer 3).

Built from `../SPEC.md` (a behaviour-only spec). An original project.

## Install on Windows (runs at startup)
```bash
cd app
npm install
npm run dist        # -> release/FlowLite-Setup-0.1.0.exe
```
Run `release\FlowLite-Setup-0.1.0.exe`:
- **SmartScreen:** the installer isn't code-signed, so Windows may say "Windows
  protected your PC" — click **More info → Run anyway**.
- Installs for your user only (no admin). FlowLite starts when setup finishes and
  **at every login** (turn that off from the tray).
- FlowLite lives in the **system tray** (click the `^` arrow if it's hidden).
  Right-click it for: Start at login, Open settings file, Open log folder, Quit.
- **API keys:** the installed app reads `%APPDATA%\FlowLite\settings.json` (tray →
  Open settings file) and Windows *user* environment variables. Keys set with
  `$env:...` in a terminal only last for that terminal — put them in settings.json.
- Logs: `%APPDATA%\FlowLite\logs\flowlite.log` (never contains dictated text).
- Uninstall from **Settings → Apps → FlowLite**. Your settings file is kept.

## Requirements
- Node.js 22+ and npm
- Windows 10/11 for text insertion (other OSes run but log instead of inserting in v1)

## Install & run
```bash
cd app
npm install
npm start          # builds, then launches Electron
```
Two ways to start dictating (both on by default):
- **Hold-to-talk / double-tap** with the **dictation key** (default **Caps Lock**):
  hold it while you speak and release to insert, or double-tap it to go **hands-free**
  (keeps listening with no key held; tap once more to stop). The dictation key is
  swallowed while in use, so Caps Lock won't toggle. Other keys: F13–F24, Right Ctrl,
  Right Alt (set `dictationKey`). Windows only.
- **Toggle hotkey** (default **Ctrl+Shift+Space**): press to start, press again to stop.

A small bar appears while listening (green dot = hands-free). With the default (mock)
engine you get a canned transcript, so you can see the full loop without any account.

## Use a real speech engine
Set a Deepgram API key (your own account) and restart:
```powershell
# Windows PowerShell
$env:DEEPGRAM_API_KEY = "<your key>"; npm start
```
```bash
# Git Bash / macOS / Linux
DEEPGRAM_API_KEY="<your key>" npm start
```
Or create `%APPDATA%/FlowLite/settings.json`:
```json
{ "engine": "deepgram", "deepgramApiKey": "<your key>", "language": "en" }
```
The engine is swappable — implement the `AsrEngine` interface in `src/main/asr/`
to use any other streaming provider.

## Transcript clean-up (layer 2)
Between the final transcript and insertion, FlowLite cleans the text up — spoken
punctuation ("comma", "question mark", "new line"), filler removal, capitalisation,
and sentence punctuation.

- **`rules`** (default when no LLM key): offline, deterministic, instant, private —
  nothing leaves the machine.
- **`claude`**: sends only the transcript text to Claude (your own key) for a
  smarter rewrite. It **always falls back to the rule-based result** on any error,
  timeout, refusal, or implausible reply, so clean-up never blocks insertion.
- **`auto`** (default): `claude` when a key is set, else `rules`. **`off`**: insert raw.

Enable the LLM formatter with your own Anthropic key:
```powershell
$env:ANTHROPIC_API_KEY = "<your key>"; npm start   # formatter becomes "claude"
```
The default clean-up model is `claude-haiku-4-5` (fast, cheap); set
`"formatModel": "claude-opus-5-5"` for the most capable clean-up. The
`formatEffort` setting is only sent to models that accept it (not Haiku 4.5).
Each Claude clean-up logs one line to the terminal: the time it took, or why it
fell back to the rules (never the dictated text). The
transcript is always wrapped and treated as text to clean, never as instructions —
a dictated question is cleaned, not answered.

## Personal dictionary & text replacements (layer 3)
Add these to `%APPDATA%\FlowLite\settings.json` (the terminal prints the exact
path at startup). Edits apply on your **next dictation** — no restart needed.
```json
{
  "dictionary": ["GitHub", "ChatGPT", "Kubernetes", "Siobhan", "Node.js"],
  "replacements": [
    { "trigger": "my email", "text": "alex@example.com" },
    { "trigger": "insert signature", "text": "Best regards,\nAlex" }
  ]
}
```
**Dictionary** — names and terms spelled your way:
- Single-word terms are sent to Deepgram as recognition hints (up to 100). If
  Deepgram ever rejects them, FlowLite reconnects without them, so a dictionary
  entry can't break dictation.
- With the Claude formatter on, terms are sent as preferred spellings (used only
  for words you actually said).
- An offline spelling fix runs after clean-up: "github", "git hub" → **GitHub**;
  "chat gpt" → **ChatGPT**; "node js" → **Node.js**. It never rewrites everyday
  words: a name like "Will" or an acronym like "IT"/"U.S." won't touch "will",
  "it" or "us" — those terms rely on the hints and Claude context instead.

**Replacements** — say the trigger, get the text exactly as written (line breaks
included). Matching ignores case and punctuation between the trigger's words;
longer triggers win ("my work email" before "my email"). If the whole dictation
is just the trigger, only the stored text is inserted. Replacement texts never
leave your machine.

Invalid entries are skipped with a `[vocab]` warning in the terminal; a broken
settings file logs a `[config]` warning and dictation keeps working.

## Focused-field context (layer 4)
FlowLite reads the text field you're dictating into — only on a hotkey press, only
the focused element — so the inserted text continues the field naturally.

- **Continuation fix (offline, default on, private):** if you dictate into the
  middle of a sentence, the inserted text gets a leading space and its first word
  is lower-cased when it's an ordinary word ("The" → "the"). Names, "I", acronyms
  and your dictionary terms stay capitalised. After a sentence end, the capital
  stays. This sends nothing anywhere.
- **Cloud context (opt-in, off by default):** set `"sendContextToLlm": true` to
  also give the Claude formatter the app name and a short snippet of the text
  before the cursor, so it matches style. The snippet is sent as **untrusted
  reference** the model may not act on. Off by default because surrounding text can
  be sensitive.
- **App blocklist:** `"contextBlocklist": ["1password", "keepass"]` discards all
  context (and never sends anything) for apps whose name contains those strings.
- Turn the whole feature off with `"contextAwareness": false`.

On Windows this uses UI Automation through `helper/win/context.ps1`; on failure or
timeout it yields no context and never delays dictation.

## Test (headless, no GUI/mic/network)
```bash
npm test              # all suites: format, vocab, asr, context, pipeline
npm run test:format   # layer-2 clean-up + Claude-fallback logic + context block
npm run test:vocab    # layer-3 dictionary, replacements, validation, hints
npm run test:asr      # cloud engine: hints, 400 retry, 401 message (fake socket)
npm run test:context  # layer-4 continuation fix, provider parsing/timeout, blocklist
npm run test:startup  # start-at-login policy, log filtering, icon files
npm run test:pipeline # mock engine -> clean-up -> dictionary -> replacements -> continuation -> dry-run insert
```

## Settings (`settings.json`)
| key | default | meaning |
|---|---|---|
| `engine` | `mock` | `mock` or `deepgram` |
| `deepgramApiKey` | — | your key (or `DEEPGRAM_API_KEY` env) |
| `language` | `en` | recognition language |
| `hotkey` | `CommandOrControl+Shift+Space` | toggle-hotkey accelerator (Electron) |
| `activationMode` | `both` | `both` / `toggle` / `hold` (which entry points are live) |
| `dictationKey` | `CapsLock` | hold/double-tap key: `CapsLock`, `RightCtrl`, `RightAlt`, `F13`–`F24` |
| `holdThresholdMs` | `300` | min hold (ms) to count as hold-to-talk vs a tap |
| `doubleTapWindowMs` | `400` | max gap (ms) for a second tap to be a double-tap |
| `maxSessionMs` | `300000` | hard cap (ms) on one session (guards a missed key-up) |
| `sampleRate` | `16000` | capture/stream rate (Hz) |
| `dryRunInject` | `false` | log text instead of pasting |
| `formatter` | `auto` | `auto` / `rules` / `claude` / `off` |
| `anthropicApiKey` | — | your key (or `ANTHROPIC_API_KEY` env) for `claude` |
| `formatModel` | `claude-haiku-4-5` | LLM for clean-up (`claude-opus-5-5` = most capable) |
| `formatEffort` | `low` | reasoning effort for clean-up (only sent to models that accept it) |
| `formatTimeoutMs` | `8000` | per-request clean-up timeout |
| `dictionary` | `[]` | your terms and names (layer 3) |
| `replacements` | `[]` | `{ "trigger", "text" }` pairs (layer 3) |
| `contextAwareness` | `true` | read the focused field for the continuation fix (layer 4) |
| `sendContextToLlm` | `false` | also send app + preceding text to the cloud formatter |
| `contextBlocklist` | `[]` | app-name substrings for which no context is read/sent |
| `contextTimeoutMs` | `1500` | max time to read the focused field |

## Layout
```
src/main/        orchestrator, config, pipeline, asr/ (engines), format/ (clean-up),
                 vocab/ (dictionary + replacements), context/ (focused field), inject/,
                 hotkey/ (dictation-key gesture state machine + native hook client)
src/renderer/    capture + indicator window
src/shared/      interfaces
helper/win/      native helpers: paste.ps1 (Win32 keybd_event), context.ps1 (UI
                 Automation), keyhook.ps1 (WH_KEYBOARD_LL hold/double-tap hook)
src/test/        headless tests (format, vocab, asr, context, startup, hotkey, pipeline)
```

## Privacy
The toggle hotkey reacts only to its own combination. The dictation-key hook
(`keyhook.ps1`) must watch the low-level keyboard stream to detect a hold or
double-tap, but it reports **only** the dictation key's down/up plus an anonymous
"another key was pressed" signal — never which other key, never any typed content —
and it ignores synthetic keystrokes. The indicator is visible whenever the mic is
active. Audio leaves the
machine only to your chosen transcription provider during an active session.
Dictionary terms go to Deepgram as hints, and to Claude when the Claude formatter
is on; replacement texts never leave the machine. The focused field is read only on
a hotkey press; the continuation fix is offline, and surrounding text is sent to the
cloud formatter only if you set `sendContextToLlm` (never for blocklisted apps). No
telemetry.
