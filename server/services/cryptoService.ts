import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { toWesternDigits } from "../../app/shared/digits";

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
 * Canonical phone form used before hashing/encrypting: Western digits, no
 * spaces/dashes/brackets, `00` international prefix → `+`.
 */
export function normalizePhone(input: string): string {
  let phone = toWesternDigits(input).replace(/[\s\-().]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (!/^\+[0-9]{8,15}$/.test(phone)) throw new Error("Invalid phone number");
  return phone;
}

/** Deterministic HMAC so admins can search by phone without decrypting. */
export function hashPhone(phone: string, key: Buffer): string {
  assertKey(key);
  return createHmac("sha256", key).update(normalizePhone(phone)).digest("hex");
}

/** Encrypt + hash in one step, as stored on users/properties. */
export function protectPhone(phone: string, keys: { encryptionKey: Buffer; phoneHashKey: Buffer }) {
  const normalized = normalizePhone(phone);
  return { encrypted: encrypt(normalized, keys.encryptionKey), hash: hashPhone(normalized, keys.phoneHashKey) };
}

function assertKey(key: Buffer) {
  if (key.length !== 32) throw new Error("Key must be 32 bytes");
}
