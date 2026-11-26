import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, PARAMS, verifyPassword } from "./passwordService";

/** A hash in the stored format made with explicit (e.g. older) parameters. */
function legacyHash(password: string, N: number, r = 8, p = 1): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize("NFKC"), salt, 64, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

describe("passwordService", () => {
  it("hashes with N=2^17, r=8, p=1", () => {
    expect(PARAMS).toEqual({ N: 131072, r: 8, p: 1 });
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^scrypt\$131072\$8\$1\$/);
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

  it("still verifies hashes made with the old parameters (N=2^15)", async () => {
    const old = legacyHash("old password", 2 ** 15);
    expect(await verifyPassword("old password", old)).toBe(true);
    expect(await verifyPassword("old passwort", old)).toBe(false);
  });

  it("returns false for hashes costing more memory than the limit", async () => {
    const stored = legacyHash("x", 2 ** 4).replace(/^scrypt\$16\$/, `scrypt$${2 ** 20}$`);
    expect(await verifyPassword("x", stored)).toBe(false);
  });

  it("returns false for malformed stored hashes", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$abc")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1$1$1$$")).toBe(false);
    expect(await verifyPassword("x", "scrypt$abc$8$1$c2FsdA==$a2V5a2V5a2V5a2V5a2V5")).toBe(false);
  });

  it("rejects an empty password", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });

  describe("needsRehash", () => {
    it("is false for a current hash", async () => {
      expect(needsRehash(await hashPassword("pw"))).toBe(false);
    });

    it("is true for older or different parameters", () => {
      expect(needsRehash(legacyHash("pw", 2 ** 15))).toBe(true);
      expect(needsRehash(legacyHash("pw", 2 ** 17, 4))).toBe(true);
    });

    it("is true for malformed hashes", () => {
      expect(needsRehash("")).toBe(true);
      expect(needsRehash("bcrypt$abc")).toBe(true);
    });
  });
});
