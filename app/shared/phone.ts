import { toWesternDigits } from "./digits";

/**
 * Phone formats per country (SPEC §8). `prefix` must equal
 * `countries.phone_prefix` (a database test checks this); `local` matches the
 * national format people type, capturing the number without its trunk `0`.
 */
export const PHONE_RULES = {
  JO: { prefix: "+962", local: /^0(7\d{8})$/ }, // 07XXXXXXXX
  KW: { prefix: "+965", local: /^([1-9]\d{7})$/ }, // XXXXXXXX (no trunk prefix)
  SA: { prefix: "+966", local: /^0(5\d{8})$/ }, // 05XXXXXXXX
  AE: { prefix: "+971", local: /^0(5\d{8})$/ }, // 05XXXXXXXX
} as const satisfies Record<string, { prefix: `+${string}`; local: RegExp }>;

export type PhoneCountry = keyof typeof PHONE_RULES;

/** Canonical stored/hashed form: `+` and 8–15 digits, no leading zero. */
export const E164 = /^\+[1-9]\d{7,14}$/;

/** Spaces, dashes, brackets, dots and the bidi marks that come with pasted Arabic text. */
const SEPARATORS = /[\s\-().‎‏‪-‮⁦-⁩]/g;

/**
 * Normalizes a phone number typed for a listing/user in `countryCode` to
 * E.164. Accepts the country's local format (e.g. JO `0791234567`) and
 * international input with `+` or `00` (any country). A trunk `0` typed after
 * the country's own code (`+962 0791234567`) is dropped. Arabic-Indic and
 * Persian digits are converted. Throws without echoing the input, so the
 * number never ends up in logs.
 */
export function normalizePhone(input: string, countryCode: string): string {
  const rules: { prefix: string; local: RegExp } | undefined = PHONE_RULES[countryCode as PhoneCountry];
  if (!rules) throw new Error(`No phone rules for country "${countryCode}"`);

  let phone = toWesternDigits(input).replace(SEPARATORS, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;

  if (!phone.startsWith("+")) {
    const local = rules.local.exec(phone);
    if (!local) throw new Error("Invalid phone number");
    phone = rules.prefix + local[1];
  } else if (phone.startsWith(`${rules.prefix}0`)) {
    const local = rules.local.exec(phone.slice(rules.prefix.length));
    if (local) phone = rules.prefix + local[1];
  }

  if (!E164.test(phone)) throw new Error("Invalid phone number");
  return phone;
}
