import { normalizeSearchText, normalizeWithMap } from "./normalizeText";

/**
 * Contact details written into listing text (SPEC §8.1). All contact goes
 * through the listing's supervisor, so phone numbers, emails, links and
 * messaging/social handles in titles and descriptions are detected, masked in
 * every public output and left out of the search index.
 *
 * The patterns run on normalized text (`normalizeSearchText`: Western digits,
 * one alef, lower-case Latin), and use only regex syntax that JavaScript and
 * PostgreSQL (ARE) read the same way — no lookarounds, no `?` (it would also
 * clash with Knex placeholders) — so the migration builds the SQL function
 * `aqar_strip_contacts` from the same sources (`contactPatternsForSql`).
 * Each pattern is `(^|[^W])(body)([^W]|$)`: group 1 and the last group are
 * the word boundaries around the match, group 2 is the contact detail itself.
 */

export type ContactKind = "phone" | "email" | "url" | "handle" | "messenger";

export interface ContactMatch {
  kind: ContactKind;
  /** Range in the original text: `text.slice(start, end)`. */
  start: number;
  end: number;
  text: string;
}

export const CONTACT_MASK = "•••";

/** "Word" characters (normalized text): Latin, digits, underscore, Arabic letters. */
const W = "a-z0-9_ء-يٱ-ۓ";

/** Between phone digits: spaces, dots, dashes, underscores, brackets (at most two in a row). */
const PHONE_SEP = "[ .()_–—-]{0,2}";
const DIGIT = "[0-9]";

/** Top-level domains accepted without `http://` or `www.` (e.g. `aqar-homes.com`, `wa.me/…`). */
const TLDS = "com|net|org|info|biz|io|me|co|jo|sa|kw|ae|app|link|ly|site|online|store|shop";

/** Arabic prefixes glued to a word: ال، وال، بال، لل…، عال، و، ب، ل، ف، ع. */
const AR_PREFIX = "(ال|[وفبلك]ال|عال|[وفبلع]){0,1}";

const BODIES: Record<ContactKind, string> = {
  // 9+ digits, or + followed by 8+ digits: 0791234567, 079 123 4567, +962-7-9123-4567, 00962791234567, (06) 555 1234.
  // Prices, years and areas have fewer digits (a 1,500,000 price is 7; "2015-2016" is 8).
  phone: `\\+ {0,1}${DIGIT}(${PHONE_SEP}${DIGIT}){7,14}|${DIGIT}(${PHONE_SEP}${DIGIT}){8,14}`,
  email: "[a-z0-9._%+-]+@[a-z0-9-]+(\\.[a-z0-9-]+)*\\.[a-z]{2,}",
  url: `(https{0,1}://|www\\.)\\S+|[a-z0-9-]+(\\.[a-z0-9-]+)*\\.(${TLDS})(/\\S*){0,1}`,
  handle: "@[a-z0-9_.]{2,30}",
  // WhatsApp, Telegram, Instagram, Facebook in Arabic (common spellings, normalized) and Latin, plus a handle
  // after a colon ("تلغرام: aqar_jo") or with an @ ("WhatsApp @aqar").
  messenger:
    `(${AR_PREFIX}(وا{0,1}تس( {0,1}ا{0,1}ب){0,1}|تي{0,1}لي{0,1}[غجكق]رام|ان{0,1}ست{0,1}[غجقك]رام|انستا|فيس( {0,1}بوك){0,1})` +
    "|whats {0,1}app|whatsap|watsapp|telegram|instagram|insta|facebook|fb)" +
    "( {0,2}: {0,2}@{0,1}[a-z0-9_.]{3,30}| {1,2}@[a-z0-9_.]{2,30}){0,1}",
};

/** Detection order; overlapping matches are merged and reported with the kind of the first one. */
const KINDS: ContactKind[] = ["email", "url", "phone", "handle", "messenger"];

const wrap = (body: string) => `(^|[^${W}])(${body})([^${W}]|$)`;

/** The pattern sources for the SQL function (same order as detection). */
export function contactPatternsForSql(): string[] {
  return KINDS.map((k) => wrap(BODIES[k]));
}

const REGEXES = KINDS.map((kind) => ({ kind, re: new RegExp(wrap(BODIES[kind]), "g") }));

/** Contact details in `text`, in order; overlapping matches are merged into one. */
export function detectContacts(text: string): ContactMatch[] {
  if (!text) return [];
  const { text: norm, map } = normalizeWithMap(text);
  const found: Array<{ kind: ContactKind; s: number; e: number }> = [];
  for (const { kind, re } of REGEXES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm)) !== null) {
      const s = m.index + m[1]!.length;
      const e = s + m[2]!.length;
      found.push({ kind, s, e });
      // Continue right after the detail, so the boundary after it can start the next match.
      re.lastIndex = e > m.index ? e : m.index + 1;
    }
  }
  // By position (stable: on a tie the earlier kind comes first), merging overlaps.
  found.sort((a, b) => a.s - b.s);
  const merged: typeof found = [];
  for (const f of found) {
    const last = merged.at(-1);
    if (last && f.s < last.e) last.e = Math.max(last.e, f.e);
    else merged.push({ ...f });
  }
  return merged.map(({ kind, s, e }) => {
    const start = map[s]!;
    const end = e >= norm.length ? text.length : map[e]!;
    return { kind, start, end, text: text.slice(start, end) };
  });
}

export function hasContactDetails(text: string | null | undefined): boolean {
  return !!text && detectContacts(text).length > 0;
}

/** `text` with each detected contact detail replaced by `•••` (public output). */
export function maskContacts(text: string): string;
export function maskContacts(text: string | null): string | null;
export function maskContacts(text: string | null): string | null {
  if (!text) return text;
  const matches = detectContacts(text);
  if (matches.length === 0) return text;
  let out = "";
  let at = 0;
  for (const m of matches) {
    out += text.slice(at, m.start) + CONTACT_MASK;
    at = m.end;
  }
  return out + text.slice(at);
}

/** Normalized text with contact details removed — what the search index sees (mirrors `aqar_strip_contacts`). */
export function stripContactsForIndex(text: string): string {
  const norm = normalizeSearchText(text);
  const matches = detectContacts(norm);
  let out = "";
  let at = 0;
  for (const m of matches) {
    out += norm.slice(at, m.start) + " ";
    at = m.end;
  }
  return out + norm.slice(at);
}
