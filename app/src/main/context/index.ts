// Layer 4 factory + helpers. Context awareness is per-OS and swappable.
import type { ContextProvider, FocusContext } from '../../shared/types';
import type { Config } from '../config';
import { WindowsContextProvider } from './WindowsContextProvider';

export { applyContinuation } from './continuation';
export { parseFocus, WindowsContextProvider } from './WindowsContextProvider';

/** A provider that reads nothing (other OSes, or context awareness off). */
class NoopContextProvider implements ContextProvider {
  readonly name = 'none';
  async capture(): Promise<FocusContext> { return {}; }
}

/** Discard the whole context if its app matches a blocklist entry (case-insensitive substring). */
export function applyBlocklist(focus: FocusContext, blocklist: readonly string[]): FocusContext {
  const app = focus.app?.toLowerCase();
  if (app && blocklist.some((b) => b && app.includes(b.toLowerCase()))) return {};
  return focus;
}

export function createContextProvider(cfg: Config, appRoot: string): ContextProvider {
  if (cfg.contextAwareness && process.platform === 'win32') {
    return new WindowsContextProvider({ appRoot, timeoutMs: cfg.contextTimeoutMs });
  }
  return new NoopContextProvider();
}
