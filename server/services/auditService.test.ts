import { describe, expect, it } from "vitest";
import { CHANGED, isPersonalField, sanitizeAuditValues } from "./auditService";
import { generateOneTimePassword } from "./supervisorService";

describe("audit values (SPEC §9: no personal data in before/after)", () => {
  it("records personal fields as changed, keeps the rest", () => {
    expect(
      sanitizeAuditValues({
        name: "Salma",
        email: "s@x.test",
        work_phone: "+962790000123",
        phone_e164: "+962790000123",
        owner_phone: "+962791111111",
        password: "secret",
        whatsapp: true,
        title_ar: "مشرفة",
        admin_area_ids: [1, 2],
        assigned_supervisor_id: null,
      }),
    ).toEqual({
      name: CHANGED,
      email: CHANGED,
      work_phone: CHANGED,
      phone_e164: CHANGED,
      owner_phone: CHANGED,
      password: CHANGED,
      whatsapp: true,
      title_ar: "مشرفة",
      admin_area_ids: [1, 2],
      assigned_supervisor_id: null,
    });
    expect(sanitizeAuditValues(undefined)).toBeNull();
    for (const k of ["contactName", "buyer_email", "PhoneNumber", "new_password"]) expect(isPersonalField(k)).toBe(true);
    for (const k of ["status", "is_active", "reason_code"]) expect(isPersonalField(k)).toBe(false);
  });
});

describe("one-time passwords", () => {
  it("are 4 groups of 5 unambiguous characters and do not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateOneTimePassword();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{5}(-[A-HJ-NP-Za-km-z2-9]{5}){3}$/);
      expect(p).not.toMatch(/[01OIl]/);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});
