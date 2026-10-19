// Production SessionView: drives the real indicator window, renderer IPC, and tray
// tooltip. Every method here is one of the Electron calls main.ts used to make
// inline; nothing else about the session reaches Electron. Window/tray are read
// through getters because they are created at different points during app start-up.
import type { BrowserWindow, Tray } from 'electron';
import type { SessionView } from './types';

export interface ElectronViewDeps {
  getWindow: () => BrowserWindow | null;
  getTray: () => Tray | null;
  /** Display form of the toggle hotkey, for the idle tooltip. */
  hotkeyLabel: string;
}

export class ElectronSessionView implements SessionView {
  constructor(private readonly deps: ElectronViewDeps) {}

  private send(channel: string, ...args: unknown[]): void {
    this.deps.getWindow()?.webContents.send(channel, ...args);
  }

  private tooltip(state: 'listening' | 'finalizing' | 'idle'): void {
    const label = this.deps.hotkeyLabel;
    this.deps.getTray()?.setToolTip(state === 'idle' ? `FlowLite — ${label} to dictate` : `FlowLite — ${state}`);
  }

  startCapture(): void { this.send('control', 'start'); }
  stopCapture(): void { this.send('control', 'stop'); }

  enterListening(): void {
    this.send('state', 'listening');
    this.deps.getWindow()?.showInactive();
    this.tooltip('listening');
  }
  enterFinalizing(): void { this.send('state', 'finalizing'); this.tooltip('finalizing'); }
  enterIdle(): void { this.send('state', 'idle'); this.tooltip('idle'); }
  hide(): void { this.deps.getWindow()?.hide(); }

  partial(text: string): void { this.send('partial', text); }
  handsFree(): void { this.send('handsfree'); }
  error(text: string): void { this.send('error', text); }
}
