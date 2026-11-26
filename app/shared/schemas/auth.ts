import { z } from "zod";
import type { Role } from "../constants";
import { normalizePhone } from "../phone";

/**
 * Auth input (SPEC §13). Error messages are codes; the UI translates them
 * with `auth.errors.<code>`.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const AUTH_ERROR_CODES = [
  "name_invalid",
  "email_invalid",
  "password_too_short",
  "password_too_long",
  "password_required",
  "phone_invalid",
  "email_taken",
  "invalid_credentials",
  "account_suspended",
  "rate_limited",
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/** HTTP status for each error (API responses and page actions). */
export const AUTH_ERROR_STATUS: Record<AuthErrorCode, number> = {
  name_invalid: 400,
  email_invalid: 400,
  password_too_short: 400,
  password_too_long: 400,
  password_required: 400,
  phone_invalid: 400,
  email_taken: 409,
  invalid_credentials: 401,
  account_suspended: 403,
  rate_limited: 429,
};

/** Form fields send "" when left empty. */
const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const emailSchema = z
  .string({ error: "email_invalid" })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "email_invalid" }).max(254, { error: "email_invalid" }));

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: "password_required" })
    .min(1, { error: "password_required" })
    .max(PASSWORD_MAX, { error: "password_too_long" }),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Registration for a country (phone is optional and normalized for that country). */
export function registerSchema(countryCode: string) {
  return z.object({
    name: z.string({ error: "name_invalid" }).trim().min(2, { error: "name_invalid" }).max(80, { error: "name_invalid" }),
    email: emailSchema,
    password: z
      .string({ error: "password_too_short" })
      .min(PASSWORD_MIN, { error: "password_too_short" })
      .max(PASSWORD_MAX, { error: "password_too_long" }),
    phone: z.preprocess(
      emptyToUndefined,
      z
        .string({ error: "phone_invalid" })
        .max(32, { error: "phone_invalid" })
        .refine(
          (v) => {
            try {
              normalizePhone(v, countryCode);
              return true;
            } catch {
              return false;
            }
          },
          { error: "phone_invalid" },
        )
        .optional(),
    ),
  });
}
export type RegisterInput = z.infer<ReturnType<typeof registerSchema>>;

/** First error code per field, from a failed parse of the schemas above. */
export function fieldErrors(error: z.ZodError): Record<string, AuthErrorCode> {
  const out: Record<string, AuthErrorCode> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    const code = (AUTH_ERROR_CODES as readonly string[]).includes(issue.message) ? (issue.message as AuthErrorCode) : null;
    if (code && !out[field]) out[field] = code;
  }
  return out;
}

/** What pages may know about the signed-in user (root loader data is serialized into the HTML). */
export interface ClientUser {
  id: number;
  name: string;
  role: Role;
}
