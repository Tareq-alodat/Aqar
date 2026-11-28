/**
 * Search normalization (SPEC §5.6), the TypeScript twin of the SQL function
 * `aqar_normalize_ar` (migration `…_text_search`): remove Arabic diacritics
 * (U+064B–U+0652, U+0670) and tatweel (U+0640); أ إ آ → ا; ة → ه; ى → ي;
 * Arabic-Indic and Persian digits → Western; lower-case Latin.
 */

/** Characters removed by the normalization. */
export const ARABIC_MARKS_RE = /[ً-ْٰـ]/u;

function normalizeChar(c: string): string {
  const code = c.codePointAt(0)!;
  if ((code >= 0x064b && code <= 0x0652) || code === 0x0670 || code === 0x0640) return "";
  if (c === "أ" || c === "إ" || c === "آ") return "ا";
  if (c === "ة") return "ه";
  if (c === "ى") return "ي";
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  return c.toLowerCase();
}

export function normalizeSearchText(input: string): string {
  let out = "";
  for (const c of input) out += normalizeChar(c);
  return out;
}

/**
 * Normalized text plus, for each of its UTF-16 code units, the index in the
 * original text it came from (`map[normalized.length]` = `input.length`), so
 * matches found in the normalized text can be located in the original.
 */
export function normalizeWithMap(input: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let i = 0;
  for (const c of input) {
    const n = normalizeChar(c);
    for (let k = 0; k < n.length; k++) map.push(i);
    text += n;
    i += c.length;
  }
  map.push(input.length);
  return { text, map };
}
