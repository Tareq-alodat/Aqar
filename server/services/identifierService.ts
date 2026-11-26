import type { Knex } from "knex";
import { z } from "zod";
import type { Category } from "../../app/shared/constants";
import { toWesternDigits } from "../../app/shared/digits";

/**
 * Property/unit identifiers (SPEC §2.4). Never public: callers must only
 * return these to the listing's owner/agent or to admins (CLAUDE.md rule 2).
 * Personal civil IDs are never accepted.
 */

export interface IdentifierPart {
  key: string;
  label_ar: string;
  label_en: string;
  required: boolean;
  numeric: boolean;
}

/** An `identifier`-kind row of `address_fields`. */
export interface IdentifierScheme {
  key: string;
  pattern: string | null;
  strip_leading_zeros: boolean;
  parts: IdentifierPart[] | null;
  group_parts: number | null;
}

/** Single-part schemes take a string; multi-part schemes take `{ partKey: value }`. */
export type IdentifierInput = string | Record<string, string | undefined>;

export interface NormalizedIdentifier {
  /** As entered (trimmed), parts joined with "/". */
  value: string;
  /** Comparison key, parts normalized separately and joined with "/". */
  value_normalized: string;
}

export class IdentifierError extends Error {
  constructor(
    readonly code: "required" | "invalid" | "not_allowed",
    readonly part?: string,
  ) {
    super(part ? `${code}: ${part}` : code);
  }
}

const SEPARATOR = "/";

/** The apartment part of `jo_land_parcel` applies to apartment listings only. */
function partApplies(part: IdentifierPart, category: Category | undefined): boolean {
  return part.key !== "apartment" || category === "apartment";
}
function partRequired(part: IdentifierPart, category: Category | undefined): boolean {
  return part.required || (part.key === "apartment" && category === "apartment");
}

/** Western digits, trimmed, inner whitespace collapsed. */
function clean(raw: string): string {
  return toWesternDigits(raw.normalize("NFKC")).trim().replace(/\s+/g, " ");
}

function normalizeNumeric(value: string, stripZeros: boolean): string {
  const digits = value.replace(/\s/g, "");
  if (!/^[0-9]+$/.test(digits)) throw new IdentifierError("invalid");
  return stripZeros ? digits.replace(/^0+(?=\d)/, "") : digits;
}

/**
 * Text parts (directorate, village, basin names): uppercase Latin, fold
 * Arabic letter variants that are commonly typed interchangeably
 * (أ إ آ ٱ → ا, ة → ه, ى → ي) and drop tatweel, so the same name typed two ways
 * compares equal.
 */
function normalizeText(value: string): string {
  return value
    .toUpperCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ـ/g, "");
}

export function normalizeIdentifier(scheme: IdentifierScheme, input: IdentifierInput, category?: Category): NormalizedIdentifier {
  if (!scheme.parts) {
    if (typeof input !== "string") throw new IdentifierError("invalid");
    const value = clean(input);
    if (!value) throw new IdentifierError("required");
    let normalized = value.replace(/\s/g, "").toUpperCase();
    if (scheme.strip_leading_zeros && /^[0-9]+$/.test(normalized)) normalized = normalized.replace(/^0+(?=\d)/, "");
    if (scheme.pattern && !new RegExp(scheme.pattern).test(normalized)) throw new IdentifierError("invalid");
    return { value, value_normalized: normalized };
  }

  if (typeof input === "string") throw new IdentifierError("invalid");
  const values: string[] = [];
  const normalized: string[] = [];
  for (const part of scheme.parts) {
    const raw = clean(input[part.key] ?? "");
    if (!partApplies(part, category)) {
      if (raw) throw new IdentifierError("not_allowed", part.key);
      continue;
    }
    if (!raw) {
      if (partRequired(part, category)) throw new IdentifierError("required", part.key);
      continue;
    }
    if (raw.includes(SEPARATOR)) throw new IdentifierError("invalid", part.key);
    let norm: string;
    try {
      norm = part.numeric ? normalizeNumeric(raw, scheme.strip_leading_zeros) : normalizeText(raw);
    } catch {
      throw new IdentifierError("invalid", part.key);
    }
    values.push(raw);
    normalized.push(norm);
  }
  return { value: values.join(SEPARATOR), value_normalized: normalized.join(SEPARATOR) };
}

/** Key shared by all units in the same building, or null if the scheme has no grouping. */
export function buildingKey(scheme: IdentifierScheme, valueNormalized: string): string | null {
  if (!scheme.group_parts) return null;
  const parts = valueNormalized.split(SEPARATOR);
  return parts.length >= scheme.group_parts ? parts.slice(0, scheme.group_parts).join(SEPARATOR) : null;
}

export interface IdentifierMatch {
  property_id: number;
  value: string;
  verified_at: Date | null;
}

export interface IdentifierMatches {
  /** Other listings with the same full normalized key. */
  duplicates: IdentifierMatch[];
  /** Other listings in the same building (same grouping key, different full key). Not duplicates. */
  sameBuilding: IdentifierMatch[];
}

/** Admin-only lookup for the moderation view (SPEC §9). */
export async function findIdentifierMatches(
  db: Knex,
  args: { countryCode: string; scheme: IdentifierScheme; valueNormalized: string; excludePropertyId?: number },
): Promise<IdentifierMatches> {
  const base = () =>
    db("property_identifiers")
      .select("property_id", "value", "verified_at")
      .where({ country_code: args.countryCode, scheme: args.scheme.key })
      .modify((q) => {
        if (args.excludePropertyId !== undefined) q.whereNot("property_id", args.excludePropertyId);
      })
      .orderBy("property_id");

  const duplicates: IdentifierMatch[] = await base().where("value_normalized", args.valueNormalized);

  const key = buildingKey(args.scheme, args.valueNormalized);
  const sameBuilding: IdentifierMatch[] = key
    ? await base()
        .where((q) => q.where("value_normalized", key).orWhereLike("value_normalized", `${escapeLike(key)}${SEPARATOR}%`))
        .whereNot("value_normalized", args.valueNormalized)
    : [];

  return { duplicates, sameBuilding };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const partSchema = z.object({
  key: z.string(),
  label_ar: z.string(),
  label_en: z.string(),
  required: z.boolean(),
  numeric: z.boolean(),
});

/** Loads an identifier scheme from the catalog. */
export async function getIdentifierScheme(db: Knex, key: string): Promise<IdentifierScheme | null> {
  const row = await db("address_fields")
    .select("key", "pattern", "strip_leading_zeros", "parts", "group_parts")
    .where({ key, kind: "identifier" })
    .first();
  if (!row) return null;
  return { ...row, parts: row.parts ? z.array(partSchema).parse(row.parts) : null };
}
