// Shared types used across main, preload, and renderer.

export type AppState = 'idle' | 'listening' | 'finalizing';

export interface AsrStartOptions {
  sampleRate: number;
  language?: string;
  /** Dictionary terms to boost recognition of (engines may ignore). */
  hints?: readonly string[];
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (err: Error) => void;
}

export interface AsrSession {
  /** Push one chunk of mono 16-bit little-endian PCM. */
  sendAudio(chunk: Buffer): void;
  /** Flush and close the session; resolves once the final result is delivered. */
  finish(): Promise<void>;
}

export interface AsrEngine {
  readonly name: string;
  start(opts: AsrStartOptions): Promise<AsrSession>;
}

export interface TextInjector {
  insertAtCursor(text: string): Promise<void>;
}

/** What was read from the focused text field at the hotkey press (layer 4). */
export interface FocusContext {
  app?: string;
  selectedText?: string;
  /** Up to ~300 chars immediately before the cursor. */
  precedingText?: string;
}

/** Reads the focused field. Never throws; returns {} when unavailable. */
export interface ContextProvider {
  readonly name: string;
  capture(): Promise<FocusContext>;
}

export interface FormatContext {
  language?: string;
  /** The user's preferred spellings (layer 3). */
  dictionary?: readonly string[];
  /** Focused-field context, only when the user opted into sending it (layer 4). */
  focus?: FocusContext;
}

/** Turns a raw transcript into clean text. Implementations must not throw. */
export interface Formatter {
  readonly name: string;
  format(raw: string, ctx?: FormatContext): Promise<string>;
}
