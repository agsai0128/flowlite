// Injector factory. Windows is the v1 target; other platforms get a dry-run
// logger until their native inserter is implemented.
import type { TextInjector } from '../../shared/types';
import type { Config } from '../config';
import { WindowsInjector } from './WindowsInjector';

export function createInjector(cfg: Config, appRoot: string): TextInjector {
  if (process.platform === 'win32') {
    return new WindowsInjector({ dryRun: cfg.dryRunInject, appRoot });
  }
  return {
    async insertAtCursor(text: string) {
      console.log(`[inject:${process.platform}] not implemented in v1; text: ${JSON.stringify(text)}`);
    },
  };
}
