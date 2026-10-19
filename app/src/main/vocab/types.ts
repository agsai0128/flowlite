// Layer 3 — the user's personal dictionary and text replacements.

/** Say `trigger`, get `text` inserted exactly as written. */
export interface Replacement {
  trigger: string;
  text: string;
}

export interface Vocabulary {
  /** Dictionary terms, spelled the way the user wants them. */
  terms: string[];
  replacements: Replacement[];
}
