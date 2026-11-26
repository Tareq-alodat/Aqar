import { describe, expect, it } from "vitest";
import { fieldErrors, loginSchema, registerSchema } from "./auth";

const register = registerSchema("JO");

describe("auth schemas", () => {
  it("normalizes the email and treats an empty phone as absent", () => {
    const r = register.parse({ name: "  Sami  ", email: " Sami@Example.COM ", password: "12345678", phone: "  " });
    expect(r).toEqual({ name: "Sami", email: "sami@example.com", password: "12345678", phone: undefined });
  });

  it("accepts Jordanian phone formats", () => {
    for (const phone of ["0791234567", "79 123 4567", "06 512 3456", "+962 77 123 4567"]) {
      expect(register.safeParse({ name: "Sami", email: "s@e.com", password: "12345678", phone }).success).toBe(true);
    }
  });

  it("reports one code per field", () => {
    const r = register.safeParse({ name: "S", email: "nope", password: "short", phone: "0761234567" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrors(r.error)).toEqual({
        name: "name_invalid",
        email: "email_invalid",
        password: "password_too_short",
        phone: "phone_invalid",
      });
    }
  });

  it("handles missing form fields (null from FormData)", () => {
    const r = loginSchema.safeParse({ email: null, password: null });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error)).toEqual({ email: "email_invalid", password: "password_required" });
  });

  it("caps password length", () => {
    const r = register.safeParse({ name: "Sami", email: "s@e.com", password: "x".repeat(129) });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).password).toBe("password_too_long");
  });
});
