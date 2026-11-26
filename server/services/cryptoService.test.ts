import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hashPhone, normalizePhone, protectPhone } from "./cryptoService";

const key = randomBytes(32);
const hashKey = randomBytes(32);

describe("encrypt / decrypt", () => {
  it("round-trips", () => {
    expect(decrypt(encrypt("+962791234567", key), key)).toBe("+962791234567");
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("+962791234567", key)).not.toBe(encrypt("+962791234567", key));
  });

  it("does not contain the plaintext", () => {
    expect(encrypt("+962791234567", key)).not.toContain("962791234567");
  });

  it("rejects a tampered ciphertext", () => {
    const [v, iv, tag, data] = encrypt("+962791234567", key).split(":");
    const flipped = Buffer.from(data!, "base64");
    flipped[0]! ^= 1;
    expect(() => decrypt([v, iv, tag, flipped.toString("base64")].join(":"), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    expect(() => decrypt(encrypt("+962791234567", key), randomBytes(32))).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encrypt("x", randomBytes(16))).toThrow("32 bytes");
  });
});

describe("normalizePhone", () => {
  it.each([
    ["+962 79 123 4567", "+962791234567"],
    ["00962791234567", "+962791234567"],
    ["+٩٦٢٧٩١٢٣٤٥٦٧", "+962791234567"],
    ["+962-(79)-123.4567", "+962791234567"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["0791234567", "+12", "+962abc", ""])("rejects %j", (input) => {
    expect(() => normalizePhone(input)).toThrow();
  });
});

describe("hashPhone", () => {
  it("is stable across formatting", () => {
    expect(hashPhone("+962 79 123 4567", hashKey)).toBe(hashPhone("00962791234567", hashKey));
  });

  it("depends on the key", () => {
    expect(hashPhone("+962791234567", hashKey)).not.toBe(hashPhone("+962791234567", randomBytes(32)));
  });
});

describe("protectPhone", () => {
  it("stores the normalized number", () => {
    const { encrypted, hash } = protectPhone("00962 79 123 4567", { encryptionKey: key, phoneHashKey: hashKey });
    expect(decrypt(encrypted, key)).toBe("+962791234567");
    expect(hash).toBe(hashPhone("+962791234567", hashKey));
  });
});
