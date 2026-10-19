// Injector factory. Windows is the v1 target; other platforms get a dry-run
// logger until their native inserter is implemented.
import type { TextInjector } from '../../shared/types';
import type { Config } from '../config';
import { WindowsInjector } from './WindowsInjector';
import { OneShotPastePen } from './OneShotPastePen';
import type { PastePen } from './types';

export { WindowsInjector } from './WindowsInjector';
export { OneShotPastePen } from './OneShotPastePen';
export { PasteHelper, nextPasteBackoff } from './PasteHelper';
export type { PasteHelperOptions } from './PasteHelper';
export type { PastePen, Clipboard } from './types';
export { parsePasteLine } from './types';

/**
 * Build the Windows text inserter. `pen` is the paste-keystroke delivery; callers
 * pass the persistent PasteHelper, and it defaults to the one-shot pen so the
 * inserter still works (at the old speed) if no warm helper is supplied.
 */
export function createInjector(cfg: Config, appRoot: string, pen?: PastePen): TextInjector {
  if (process.platform === 'win32') {
    return new WindowsInjector({ dryRun: cfg.dryRunInject, pen: pen ?? new OneShotPastePen(appRoot) });
  }
  return {
    async insertAtCursor(text: string) {
      console.log(`[inject:${process.platform}] not implemented in v1; text: ${JSON.stringify(text)}`);
    },
  };
}
