import { z } from "zod";
import { normalizePhone, PHONE_RULES, type PhoneCountry } from "../phone";
import { emailSchema, PASSWORD_MAX, PASSWORD_MIN } from "./auth";

/**
 * Back-office input (SPEC §9), shared by the `/api/v1/backoffice` routes and
 * the back-office page actions. Error messages are codes translated with
 * `backoffice.errors.<code>`.
 */

export const BACKOFFICE_ERROR_CODES = [
  "invalid_input",
  "name_invalid",
  "email_invalid",
  "email_taken",
  "phone_invalid",
  "title_invalid",
  "reason_required",
  "area_invalid",
  "forbidden",
  "not_found",
  "not_assignable",
  "invalid_assignee",
  "already_in_state",
  "password_change_required",
] as const;
export type BackofficeErrorCode = (typeof BACKOFFICE_ERROR_CODES)[number];

export const BACKOFFICE_ERROR_STATUS: Record<BackofficeErrorCode, number> = {
  invalid_input: 400,
  name_invalid: 400,
  email_invalid: 400,
  email_taken: 409,
  phone_invalid: 400,
  title_invalid: 400,
  reason_required: 400,
  area_invalid: 400,
  forbidden: 403,
  not_found: 404,
  not_assignable: 409,
  invalid_assignee: 400,
  already_in_state: 409,
  password_change_required: 403,
};

export const PHONE_COUNTRIES = Object.keys(PHONE_RULES) as [PhoneCountry, ...PhoneCountry[]];

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
/** HTML checkboxes send "on" (or nothing); JSON sends booleans. */
const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());

const nameSchema = z.string({ error: "name_invalid" }).trim().min(2, { error: "name_invalid" }).max(80, { error: "name_invalid" });
const titleSchema = z.preprocess(emptyToNull, z.string({ error: "title_invalid" }).trim().max(80, { error: "title_invalid" }).nullable());

/** A non-empty reason (required for reassigning and deactivating; stored in the audit log). */
export const reasonSchema = z.string({ error: "reason_required" }).trim().min(1, { error: "reason_required" }).max(500, { error: "reason_required" });

/** Supervisor profile fields; the work mobile is normalized to E.164 for `phoneCountry`. */
const profileShape = {
  name: nameSchema,
  workPhone: z.string({ error: "phone_invalid" }).max(32, { error: "phone_invalid" }),
  phoneCountry: z.enum(PHONE_COUNTRIES).default("JO"),
  whatsapp: checkbox.default(false),
  titleAr: titleSchema.default(null),
  titleEn: titleSchema.default(null),
};

const withE164 = <T extends { workPhone: string; phoneCountry: PhoneCountry }>(v: T, ctx: z.RefinementCtx) => {
  try {
    return { ...v, workPhone: normalizePhone(v.workPhone, v.phoneCountry) };
  } catch {
    ctx.addIssue({ code: "custom", path: ["workPhone"], message: "phone_invalid" });
    return z.NEVER;
  }
};

export const supervisorCreateSchema = z.object({ ...profileShape, email: emailSchema }).transform(withE164);
export type SupervisorCreateInput = z.infer<typeof supervisorCreateSchema>;

export const supervisorUpdateSchema = z.object(profileShape).transform(withE164);
export type SupervisorUpdateInput = z.infer<typeof supervisorUpdateSchema>;

const idSchema = z.coerce.number({ error: "invalid_input" }).int({ error: "invalid_input" }).positive({ error: "invalid_input" }).max(2_147_483_647, { error: "invalid_input" });
export const idParamSchema = idSchema;

export const scopesSchema = z.object({
  areaIds: z.array(idSchema, { error: "area_invalid" }).max(500, { error: "area_invalid" }).transform((ids) => [...new Set(ids)].sort((a, b) => a - b)),
});
export type ScopesInput = z.infer<typeof scopesSchema>;

export const supervisorActiveSchema = z.object({ active: checkbox, reason: reasonSchema });

/** Reassign a listing (super_admin): a supervisor id, or null for the super_admin's queue. */
export const reassignSchema = z.object({
  supervisorId: z.preprocess(emptyToNull, idSchema.nullable()),
  reason: reasonSchema,
});
export type ReassignInput = z.infer<typeof reassignSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: "password_required" }).min(1, { error: "password_required" }).max(PASSWORD_MAX, { error: "password_too_long" }),
    newPassword: z
      .string({ error: "password_too_short" })
      .min(PASSWORD_MIN, { error: "password_too_short" })
      .max(PASSWORD_MAX, { error: "password_too_long" }),
    confirmPassword: z.string({ error: "password_mismatch" }),
  })
  .superRefine((v, ctx) => {
    if (v.newPassword !== v.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "password_mismatch" });
    else if (v.newPassword === v.currentPassword) ctx.addIssue({ code: "custom", path: ["newPassword"], message: "password_unchanged" });
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** First error code per field from a failed parse (unknown messages → `invalid_input`). */
export function issueCodes(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!out[field]) out[field] = /^[a-z_]+$/.test(issue.message) ? issue.message : "invalid_input";
  }
  return out;
}
