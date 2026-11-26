import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { Semaphore } from "./concurrency";

/**
 * Password hashing with Node's built-in scrypt (no native dependency).
 * Stored format: `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>`, so parameters
 * can be raised without breaking existing hashes: verifyPassword reads the
 * parameters from the stored hash, and needsRehash tells login to re-hash.
 */

export const PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
/**
 * scrypt needs about 128·N·r bytes (128 MiB at the current parameters) plus
 * small buffers; allow twice that. Stored hashes costing more than this fail
 * verification instead of exhausting memory.
 */
const MAX_MEM = 2 * 128 * PARAMS.N * PARAMS.r;

interface StoredHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

/**
 * At most two scrypt runs at once (~256 MiB peak); further logins queue. Keeps
 * memory bounded on the VPS no matter how many requests arrive together.
 */
export const SCRYPT_CONCURRENCY = 2;
const scryptSlots = new Semaphore(SCRYPT_CONCURRENCY);

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return scryptSlots.run(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scryptCb(password.normalize("NFKC"), salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
      }),
  );
}

/** Running/queued scrypt calls (tests and diagnostics). */
export function scryptStats() {
  return scryptSlots.stats;
}

function parse(stored: string): StoredHash | null {
  const [algo, n, r, p, saltB64, keyB64, ...rest] = stored.split("$");
  if (algo !== "scrypt" || rest.length > 0 || !saltB64 || !keyB64) return null;
  if (![n, r, p].every((v) => v !== undefined && /^[1-9]\d{0,9}$/.test(v))) return null;
  const key = Buffer.from(keyB64, "base64");
  if (key.length < 16) return null;
  return { N: Number(n), r: Number(r), p: Number(p), salt: Buffer.from(saltB64, "base64"), key };
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length === 0) throw new Error("Password must not be empty");
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/**
 * Constant-time check using the parameters stored with the hash, so hashes
 * made with older (cheaper) parameters keep working. Returns false (never
 * throws) for malformed stored hashes.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const h = parse(stored);
  if (!h) return false;
  try {
    const actual = await scrypt(password, h.salt, h.key.length, { N: h.N, r: h.r, p: h.p, maxmem: MAX_MEM });
    return timingSafeEqual(actual, h.key);
  } catch {
    return false;
  }
}

/**
 * True when a stored hash was made with other parameters than the current
 * ones (or is not a valid scrypt hash). Login (milestone 3) calls it after a
 * successful verifyPassword and, if true, stores hashPassword(password).
 */
export function needsRehash(stored: string): boolean {
  const h = parse(stored);
  return !h || h.N !== PARAMS.N || h.r !== PARAMS.r || h.p !== PARAMS.p || h.key.length !== KEY_LENGTH;
}
