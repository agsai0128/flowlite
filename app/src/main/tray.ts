// System tray: shows that FlowLite is running (it has no other window when idle)
// and offers start-at-login, settings, logs, and Quit.
import { app, Menu, Tray, nativeImage, shell } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HIDDEN_ARG, LOGIN_ITEM_NAME, hotkeyLabel } from './startup';

export function loginItemEnabled(): boolean {
  return app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin;
}

export function setLoginItem(on: boolean): void {
  app.setLoginItemSettings({ openAtLogin: on, args: [HIDDEN_ARG], name: LOGIN_ITEM_NAME });
}

function openSettingsFile(userDataDir: string): void {
  const file = join(userDataDir, 'settings.json');
  if (!existsSync(file)) writeFileSync(file, '{}\n'); // create only when missing
  if (process.platform === 'win32') {
    spawn('notepad.exe', [file], { detached: true, stdio: 'ignore' }).unref();
  } else {
    void shell.openPath(file);
  }
}

export interface TrayOptions {
  iconPath: string;
  hotkey: string;
  userDataDir: string;
  logDir: string;
}

export function createTray(opts: TrayOptions): Tray {
  const tray = new Tray(nativeImage.createFromPath(opts.iconPath));
  const label = hotkeyLabel(opts.hotkey);
  const rebuild = () => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `FlowLite — press ${label} to dictate`, enabled: false },
        { type: 'separator' },
        {
          label: app.isPackaged ? 'Start at login' : 'Start at login (installed app only)',
          type: 'checkbox',
          enabled: app.isPackaged,
          checked: app.isPackaged && loginItemEnabled(),
          click: (item) => {
            setLoginItem(item.checked);
            console.log(`[flowlite] start at login ${item.checked ? 'enabled' : 'disabled'} from tray`);
            rebuild();
          },
        },
        { label: 'Open settings file', click: () => openSettingsFile(opts.userDataDir) },
        { label: 'Open log folder', click: () => void shell.openPath(opts.logDir) },
        { type: 'separator' },
        { label: 'Quit FlowLite', click: () => app.quit() },
      ])
    );
  };
  rebuild();
  tray.setToolTip(`FlowLite — ${label} to dictate`);
  return tray;
}
