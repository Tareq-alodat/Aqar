import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizePhone } from "../../app/shared/phone";
import { decrypt, encrypt, hashPhone, protectPhone } from "./cryptoService";

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

describe("hashPhone", () => {
  it.each([
    ["JO", ["0791234567", "079 123 4567", "+962 79 123 4567", "00962791234567", "+962 0791234567", "٠٧٩١٢٣٤٥٦٧"]],
    ["KW", ["51234567", "5123 4567", "+965 5123 4567", "0096551234567"]],
    ["SA", ["0512345678", "051 234 5678", "+966 51 234 5678", "00966512345678", "+9660512345678"]],
    ["AE", ["0501234567", "050-123-4567", "+971 50 123 4567", "00971501234567"]],
  ] as const)("same %s number, different formats → same hash", (country, formats) => {
    const hashes = new Set(formats.map((f) => hashPhone(normalizePhone(f, country), hashKey)));
    expect(hashes.size).toBe(1);
  });

  it("differs between countries for the same local digits", () => {
    expect(hashPhone(normalizePhone("0512345678", "SA"), hashKey)).not.toBe(hashPhone(normalizePhone("0512345678", "AE"), hashKey));
  });

  it("only hashes the normalized form", () => {
    for (const raw of ["0791234567", "00962791234567", "+962 79 123 4567"]) {
      expect(() => hashPhone(raw, hashKey)).toThrow("normalized");
    }
  });

  it("depends on the key", () => {
    expect(hashPhone("+962791234567", hashKey)).not.toBe(hashPhone("+962791234567", randomBytes(32)));
  });
});

describe("protectPhone", () => {
  it("stores the normalized number", () => {
    const { encrypted, hash } = protectPhone("079 123 4567", "JO", { encryptionKey: key, phoneHashKey: hashKey });
    expect(decrypt(encrypted, key)).toBe("+962791234567");
    expect(hash).toBe(hashPhone("+962791234567", hashKey));
  });

  it("rejects a number that is invalid for the country", () => {
    expect(() => protectPhone("0791234567", "SA", { encryptionKey: key, phoneHashKey: hashKey })).toThrow("Invalid phone number");
  });
});
