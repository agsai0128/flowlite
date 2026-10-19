// FlowLite main process — orchestrates the v1 core loop:
//   hotkey -> listen (capture + stream) -> finalize -> insert text at cursor.
import { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, screen, type Tray } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { installFileLogger } from './log';
import { HIDDEN_ARG, hotkeyLabel, readState, shouldEnableLoginItemOnFirstRun, writeState } from './startup';
import { createTray, setLoginItem } from './tray';
import { loadConfig, type Config } from './config';
import { createEngine } from './asr';
import { createInjector } from './inject';
import { createFormatter } from './format';
import { processTranscript } from './pipeline';
import { createContextProvider } from './context';
import { GestureDetector, KeyHookSource, RealScheduler, resolveDictationKey } from './hotkey';
import { DictationSession, ElectronSessionView } from './session';

const APP_ROOT = join(__dirname, '..', '..'); // dist/main -> app root (app.asar when packaged)
// PowerShell can't run scripts from inside app.asar, so the installed app ships the
// native helpers as plain files next to it (resources/helper/win/*.ps1).
const HELPER_ROOT = app.isPackaged ? process.resourcesPath : APP_ROOT;
const SMOKE = process.env.FLOWLITE_SMOKE === '1';
const APP_ID = 'com.flowlite.dictation';

// Dev/test override: read settings.json from another folder (must run before 'ready').
if (process.env.FLOWLITE_USER_DATA) app.setPath('userData', process.env.FLOWLITE_USER_DATA);

// One instance only: a second launch (e.g. Start menu while running at login) exits.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let tray: Tray | null = null;

let cfg: Config;
let win: BrowserWindow | null = null;
let session: DictationSession | null = null;
let keyHook: KeyHookSource | null = null;
let holdAvailable = false;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const w = 340, h = 78;
  win = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round((width - w) / 2),
    y: height - h - 24,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false, // never steal focus from the app being dictated into
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // Allow microphone for our own window only.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });
  win.loadFile(join(__dirname, '..', 'renderer', 'recorder.html'));
}

/** The toggle hotkey delegates to the session, which owns the start/stop decision. */
function toggle() {
  session?.toggle();
}

/**
 * Wire the native dictation key to the gesture state machine. The hook reports raw
 * key down/up/other; the detector turns those into start/stop/discard/abort, which
 * drive the same session functions as the toggle. Interpretation is pure and tested
 * in hotkey.test.ts; this wiring is the untestable I/O edge.
 */
function setupDictationKey() {
  const key = resolveDictationKey(cfg.dictationKey, (m) => console.warn(m));
  const detector = new GestureDetector(
    { holdThresholdMs: cfg.holdThresholdMs, doubleTapWindowMs: cfg.doubleTapWindowMs, maxSessionMs: cfg.maxSessionMs },
    new RealScheduler(),
    (action) => {
      switch (action) {
        case 'start': void session?.start(); break;
        case 'stopInsert': session?.stop(); break;
        case 'cancelDiscard':
        case 'abort': session?.cancel(); break;
        case 'lockHandsFree': session?.handsFree(); break;
      }
    },
  );
  keyHook = new KeyHookSource({
    helperRoot: HELPER_ROOT,
    vk: key.vk,
    onEvent: (e) => { if (e === 'down') detector.keyDown(); else if (e === 'up') detector.keyUp(); else detector.otherKey(); },
    onAvailability: (up) => {
      if (up === holdAvailable) return;
      holdAvailable = up;
      console.log(`[flowlite] hold-to-talk ${up ? 'ready' : 'unavailable'} (${key.label})`);
      if (!up) tray?.setToolTip('FlowLite — hold-to-talk unavailable');
    },
    log: (m) => console.log('[flowlite]', m),
  });
  keyHook.start();
  // A missed key-up (lock screen / elevated-window focus steal) must not leave a
  // session open: ending on lock inserts what was said so far.
  powerMonitor.on('lock-screen', () => detector.forceStop());
  console.log(`[flowlite] dictation key: ${key.label} (vk=0x${key.vk.toString(16)}), mode=${cfg.activationMode}, hold>=${cfg.holdThresholdMs}ms, doubleTap<=${cfg.doubleTapWindowMs}ms`);
}

function wireIpc() {
  ipcMain.on('audio-chunk', (_e, chunk: ArrayBuffer | Uint8Array) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBuffer);
    session?.sendAudio(buf);
  });
  ipcMain.on('capture-stopped', () => session?.captureStopped());
  ipcMain.on('capture-error', (_e, msg: string) => session?.captureError(msg));
}

app.on('second-instance', () => {
  tray?.displayBalloon({ title: 'FlowLite is already running', content: 'Right-click the tray icon for options.' });
});

app.whenReady().then(() => {
  if (!gotLock) return;
  const userData = app.getPath('userData');
  const logDir = join(userData, 'logs');
  installFileLogger(logDir);
  app.setAppUserModelId(APP_ID);

  cfg = loadConfig(userData);
  const engine = createEngine(cfg);
  const injector = createInjector(cfg, HELPER_ROOT);
  const formatter = createFormatter(cfg);
  const contextProvider = createContextProvider(cfg, HELPER_ROOT);
  // The session speaks to Electron only through this view (window + renderer + tray).
  const view = new ElectronSessionView({ getWindow: () => win, getTray: () => tray, hotkeyLabel: hotkeyLabel(cfg.hotkey) });
  session = new DictationSession({
    config: cfg,
    reloadVocabulary: () => { const fresh = loadConfig(userData); return { terms: fresh.dictionary, replacements: fresh.replacements }; },
    engine, injector, formatter, processTranscript, contextProvider, view, scheduler: new RealScheduler(),
  });
  console.log(`[flowlite] v${app.getVersion()} packaged=${app.isPackaged} engine=${engine.name} formatter=${formatter.name} context=${contextProvider.name} sendContextToLlm=${cfg.sendContextToLlm} hotkey=${cfg.hotkey} dryRunInject=${cfg.dryRunInject}`);
  console.log(`[flowlite] vocabulary: ${cfg.dictionary.length} dictionary terms, ${cfg.replacements.length} replacements`);
  console.log(`[flowlite] settings file: ${join(userData, 'settings.json')}`);
  const helperDir = join(HELPER_ROOT, 'helper', 'win');
  const helpersFound = ['paste.ps1', 'context.ps1'].every((f) => existsSync(join(helperDir, f)));
  console.log(`[flowlite] helpers: ${helperDir} (${helpersFound ? 'found' : 'MISSING'})`);

  createWindow();
  wireIpc();

  // Entry point 1: the OS toggle hotkey (unless activation is hold-only).
  let ok = true;
  if (cfg.activationMode !== 'hold') {
    ok = globalShortcut.register(cfg.hotkey, toggle);
    if (!ok) console.error(`[flowlite] failed to register hotkey ${cfg.hotkey}`);
  }

  // Entry point 2: the native dictation key (hold-to-talk + double-tap), Windows only.
  if (cfg.activationMode !== 'toggle' && process.platform === 'win32') {
    setupDictationKey();
  }

  tray = createTray({ iconPath: join(APP_ROOT, 'assets', 'tray.png'), hotkey: cfg.hotkey, userDataDir: userData, logDir });

  // Installed app: turn on start-at-login once, on first run; afterwards the tray toggle rules.
  const persisted = readState(userData);
  if (shouldEnableLoginItemOnFirstRun(app.isPackaged, persisted, SMOKE)) {
    setLoginItem(true);
    writeState(userData, { ...persisted, loginItemInitialized: true });
    console.log('[flowlite] start at login enabled (first run)');
  }

  // Launched by hand (not at login): say where FlowLite lives now.
  if (!process.argv.includes(HIDDEN_ARG) && !SMOKE) {
    tray.displayBalloon({
      title: 'FlowLite is running',
      content: `Press ${hotkeyLabel(cfg.hotkey)} to dictate. Right-click the tray icon for options.`,
    });
  }

  // Smoke mode: verify the main process boots (window + renderer + hotkey + tray), then quit.
  if (SMOKE) {
    win?.webContents.once('did-finish-load', () => console.log('[flowlite] SMOKE: renderer loaded'));
    console.log(`[flowlite] SMOKE: initialized ok (hotkey registered=${ok}, tray=${tray ? 'yes' : 'no'})`);
    setTimeout(() => app.quit(), 2500);
  }
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); keyHook?.stop(); });
// Keep running with no visible window (tray/background-style app): by subscribing
// and not calling app.quit(), the app stays alive when the hidden window closes.
app.on('window-all-closed', () => { /* keep running in background */ });
