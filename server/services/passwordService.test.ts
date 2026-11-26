import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./passwordService";

describe("passwordService", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("correct horse battery stapler", hash)).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("treats Unicode-equivalent passwords the same (NFKC)", async () => {
    const hash = await hashPassword("ﬁle"); // U+FB01 ligature
    expect(await verifyPassword("file", hash)).toBe(true);
  });

  it("returns false for malformed stored hashes", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$abc")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1$1$1$$")).toBe(false);
  });

  it("rejects an empty password", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });
});
