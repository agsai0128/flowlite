// Small regex helpers shared by the dictionary and replacement steps.

/** Escape regex syntax characters (safe under the `u` flag). */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Not preceded / followed by a letter or digit (Unicode-aware whole-word edges). */
export const EDGE_L = '(?<![\\p{L}\\p{N}])';
export const EDGE_R = '(?![\\p{L}\\p{N}])';
