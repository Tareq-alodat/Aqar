import { z } from "zod";
import type { AddressFieldKind, AddressVisibility } from "../constants";
import { toWesternDigits } from "../digits";

/**
 * Typed address fields (SPEC §2.3). `properties.address` stores
 * `{ field_key: value }` for the country's active `text` / `number` fields;
 * area levels come from the pin and identifiers live in property_identifiers.
 */

/** One active row of a country's address settings joined with its catalog entry. */
export interface CountryAddressField {
  field_key: string;
  kind: AddressFieldKind;
  label_ar: string;
  label_en: string;
  pattern: string | null;
  position: number;
  is_required: boolean;
  visibility: AddressVisibility;
}

const isTyped = (f: CountryAddressField) => f.kind === "text" || f.kind === "number";

/** Zod schema for `properties.address`, built from the country's settings. Unknown keys are rejected. */
export function buildAddressSchema(fields: readonly CountryAddressField[]) {
  const shape: Record<string, z.ZodType<string | undefined>> = {};
  for (const field of fields.filter(isTyped)) {
    let check = z.string().min(1).max(200);
    if (field.pattern) check = check.regex(new RegExp(field.pattern));
    if (field.kind === "number") check = check.regex(/^[0-9]+$/);
    const value = z.string().trim().transform(toWesternDigits).pipe(check);
    shape[field.field_key] = field.is_required ? value : value.optional();
  }
  return z.strictObject(shape);
}

/**
 * The address fields the public may see for a listing (SPEC §4.3): only
 * `public` ones. `exact_only` fields would locate the property as precisely as
 * the pin, and every listing is public as an approximate area, so they are
 * never public (shared at viewing time, a later milestone); `admin_only` never.
 */
export function publicAddress(fields: readonly CountryAddressField[], address: Readonly<Record<string, unknown>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (!isTyped(field)) continue;
    const visible = field.visibility === "public";
    const value = address[field.field_key];
    if (visible && typeof value === "string" && value) out[field.field_key] = value;
  }
  return out;
}
