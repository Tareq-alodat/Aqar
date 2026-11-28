import { describe, expect, it } from "vitest";
import { changePasswordSchema, issueCodes, reassignSchema, scopesSchema, supervisorActiveSchema, supervisorCreateSchema } from "./backoffice";

describe("back-office schemas", () => {
  it("normalizes the supervisor's work mobile to E.164 for the chosen country", () => {
    const ok = supervisorCreateSchema.parse({ name: "Salma", email: " S@X.test ", workPhone: "٠٧٩٠٠٠٠١٢٣", whatsapp: "on", titleAr: "" });
    expect(ok).toMatchObject({ email: "s@x.test", workPhone: "+962790000123", phoneCountry: "JO", whatsapp: true, titleAr: null, titleEn: null });
    expect(supervisorCreateSchema.parse({ name: "Salma", email: "s@x.test", workPhone: "55123456", phoneCountry: "KW" }).workPhone).toBe("+96555123456");
    const bad = supervisorCreateSchema.safeParse({ name: "S", email: "nope", workPhone: "123" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(issueCodes(bad.error)).toMatchObject({ name: "name_invalid", email: "email_invalid" });
  });

  it("requires a non-empty reason to deactivate or reassign", () => {
    expect(supervisorActiveSchema.safeParse({ active: "false", reason: "  " }).success).toBe(false);
    expect(supervisorActiveSchema.parse({ active: "true", reason: " Rehired " })).toEqual({ active: true, reason: "Rehired" });
    expect(reassignSchema.safeParse({ supervisorId: 3 }).success).toBe(false);
    expect(reassignSchema.parse({ supervisorId: "", reason: "queue" })).toEqual({ supervisorId: null, reason: "queue" });
    expect(reassignSchema.parse({ supervisorId: "7", reason: "x" }).supervisorId).toBe(7);
    expect(reassignSchema.safeParse({ supervisorId: -1, reason: "x" }).success).toBe(false);
    expect(supervisorActiveSchema.safeParse({ active: true, reason: "x".repeat(501) }).success).toBe(false);
  });

  it("dedupes and sorts scope area ids; caps the count", () => {
    expect(scopesSchema.parse({ areaIds: ["5", 3, 5] }).areaIds).toEqual([3, 5]);
    expect(scopesSchema.safeParse({ areaIds: Array.from({ length: 501 }, (_, i) => i + 1) }).success).toBe(false);
    expect(scopesSchema.safeParse({ areaIds: ["x"] }).success).toBe(false);
  });

  it("change password: confirmation must match and the new one must differ", () => {
    const mismatch = changePasswordSchema.safeParse({ currentPassword: "old-pass", newPassword: "new-password", confirmPassword: "other" });
    expect(!mismatch.success && issueCodes(mismatch.error)).toEqual({ confirmPassword: "password_mismatch" });
    const same = changePasswordSchema.safeParse({ currentPassword: "same-password", newPassword: "same-password", confirmPassword: "same-password" });
    expect(!same.success && issueCodes(same.error)).toEqual({ newPassword: "password_unchanged" });
    const short = changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "short", confirmPassword: "short" });
    expect(!short.success && issueCodes(short.error).newPassword).toBe("password_too_short");
    expect(changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "long-enough", confirmPassword: "long-enough" }).success).toBe(true);
  });
});
