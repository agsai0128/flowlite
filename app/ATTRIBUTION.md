# Attribution

FlowLite is an original app (see `../SPEC.md`). Every asset is original or openly
licensed, and is listed here.

## Assets
| Asset | Source | License |
|---|---|---|
| App, installer and tray icon (`build/icon.*`, `assets/tray*.png`) | Original — drawn in code by `scripts/make-icon.mjs` | Same as FlowLite (MIT) |

No third-party icons, sounds, fonts, images or text are used.

## Runtime components (bundled in the installer)
| Component | License |
|---|---|
| Electron (incl. Chromium, Node.js) | MIT (Electron); see Electron's bundled LICENSES.chromium.html |
| ws | MIT |
| @anthropic-ai/sdk | MIT |
| NSIS installer stub (via electron-builder) | zlib/libpng license |

## Build tooling (not shipped)
| Tool | License |
|---|---|
| electron-builder | MIT |
| TypeScript | Apache-2.0 |
