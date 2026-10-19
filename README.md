# FlowLite

An original push-to-talk dictation app for Windows: press a key, speak, and your
words are inserted — cleaned up — at the text cursor in whatever app has focus.

- Two ways to dictate: **hold-to-talk / double-tap** on a dictation key (default
  Caps Lock), or a **toggle hotkey** (default Ctrl+Shift+Space).
- **Transcript clean-up**: offline punctuation/filler rules, or an optional cloud
  LLM formatter using your own API key.
- **Personal dictionary & text replacements**, and **focused-field context** so the
  inserted text continues the sentence you're in.
- Swappable speech engine (offline mock by default; Deepgram cloud optional).
- Ships as a tray app with a Windows installer.

## Repository layout

```
app/           the FlowLite application (Electron + TypeScript) — see app/README.md
SPEC.md        behaviour-only specification the app is built from
GLOSSARY.md    domain vocabulary
docs/adr/      architecture decision records
```

## Getting started

```bash
cd app
npm install
npm start        # builds, then launches Electron
```

See [`app/README.md`](app/README.md) for settings, engines, packaging, and privacy
notes.

## License

MIT — see [LICENSE](LICENSE).
