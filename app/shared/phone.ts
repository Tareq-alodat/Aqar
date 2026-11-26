import { toWesternDigits } from "./digits";

interface PhoneRule {
  /** Must equal `countries.phone_prefix` (a database test checks this). */
  prefix: `+${string}`;
  /**
   * Local formats people type. Each pattern captures the national number
   * (without the trunk `0`) that follows the prefix in E.164.
   */
  local: readonly RegExp[];
  /**
   * When set, numbers with this country's prefix must match one of these
   * national-number patterns, however they were typed. Countries without it
   * accept any E.164 number with their prefix.
   */
  national?: readonly RegExp[];
}

const JO_MOBILE = String.raw`7[789]\d{7}`; // 077 / 078 / 079
const JO_LANDLINE = String.raw`[2356]\d{7}`; // 02 / 03 / 05 / 06

/** Phone formats per country (SPEC §8). */
export const PHONE_RULES = {
  JO: {
    prefix: "+962",
    // 07[789]XXXXXXX, the same without the leading 0, or a landline 0[2356]XXXXXXX (leading 0 required).
    local: [new RegExp(`^0?(${JO_MOBILE})$`), new RegExp(`^0(${JO_LANDLINE})$`)],
    national: [new RegExp(`^${JO_MOBILE}$`), new RegExp(`^${JO_LANDLINE}$`)],
  },
  KW: { prefix: "+965", local: [/^([1-9]\d{7})$/] }, // XXXXXXXX (no trunk prefix)
  SA: { prefix: "+966", local: [/^0?(5\d{8})$/] }, // 05XXXXXXXX or 5XXXXXXXX
  AE: { prefix: "+971", local: [/^0?(5\d{8})$/] }, // 05XXXXXXXX or 5XXXXXXXX
} as const satisfies Record<string, PhoneRule>;

export type PhoneCountry = keyof typeof PHONE_RULES;

/** Canonical stored/hashed form: `+` and 8–15 digits, no leading zero. */
export const E164 = /^\+[1-9]\d{7,14}$/;

/** Spaces, dashes, brackets, dots and the bidi marks that come with pasted Arabic text. */
const SEPARATORS = /[\s\-().‎‏‪-‮⁦-⁩]/g;

function matchLocal(rule: PhoneRule, digits: string): string | null {
  for (const pattern of rule.local) {
    const m = pattern.exec(digits);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * Normalizes a phone number typed for a listing/user in `countryCode` to
 * E.164. Accepts the country's local formats (see PHONE_RULES) and
 * international input with `+` or `00` (any country). A trunk `0` typed after
 * the country's own code (`+962 0791234567`) is dropped. Arabic-Indic and
 * Persian digits are converted. Throws without echoing the input, so the
 * number never ends up in logs.
 */
export function normalizePhone(input: string, countryCode: string): string {
  const rule: PhoneRule | undefined = PHONE_RULES[countryCode as PhoneCountry];
  if (!rule) throw new Error(`No phone rules for country "${countryCode}"`);

  let phone = toWesternDigits(input).replace(SEPARATORS, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;

  if (!phone.startsWith("+")) {
    const national = matchLocal(rule, phone);
    if (!national) throw new Error("Invalid phone number");
    phone = rule.prefix + national;
  } else if (phone.startsWith(`${rule.prefix}0`)) {
    const national = matchLocal(rule, phone.slice(rule.prefix.length));
    if (national) phone = rule.prefix + national;
  }

  if (!E164.test(phone)) throw new Error("Invalid phone number");
  if (rule.national && phone.startsWith(rule.prefix)) {
    const national = phone.slice(rule.prefix.length);
    if (!rule.national.some((p) => p.test(national))) throw new Error("Invalid phone number");
  }
  return phone;
}
