import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { E164, normalizePhone } from "../../app/shared/phone";

/**
 * Phone privacy (SPEC §8, CLAUDE.md rule 1): AES-256-GCM ciphertext for the
 * real number, HMAC-SHA256 for admin lookup. Never log inputs or outputs.
 *
 * Ciphertext format: `v1:<iv b64>:<auth tag b64>:<ciphertext b64>`.
 */

const VERSION = "v1";
const IV_BYTES = 12;

export function encrypt(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

/** Throws if the ciphertext was tampered with or the key is wrong (GCM auth tag check). */
export function decrypt(payload: string, key: Buffer): string {
  assertKey(key);
  const [version, iv, tag, data] = payload.split(":");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unrecognized ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/**
 * Deterministic HMAC so admins can search by phone without decrypting. Takes
 * only the normalized E.164 form (`normalizePhone`), so every way of typing
 * the same number gives the same hash; anything else throws.
 */
export function hashPhone(normalized: string, key: Buffer): string {
  assertKey(key);
  if (!E164.test(normalized)) throw new Error("hashPhone expects a normalized E.164 number (see normalizePhone)");
  return createHmac("sha256", key).update(normalized).digest("hex");
}

/**
 * Normalize for the listing's/user's country, then encrypt + hash, as stored
 * on users/properties.
 */
export function protectPhone(phone: string, countryCode: string, keys: { encryptionKey: Buffer; phoneHashKey: Buffer }) {
  const normalized = normalizePhone(phone, countryCode);
  return { encrypted: encrypt(normalized, keys.encryptionKey), hash: hashPhone(normalized, keys.phoneHashKey) };
}

function assertKey(key: Buffer) {
  if (key.length !== 32) throw new Error("Key must be 32 bytes");
}
