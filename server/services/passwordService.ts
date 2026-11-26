import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with Node's built-in scrypt (no native dependency).
 * Stored format: `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>`, so parameters
 * can be raised later without breaking existing hashes.
 */

const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// N * r * 128 bytes = 32 MiB for the defaults; leave headroom.
const MAX_MEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize("NFKC"), salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length === 0) throw new Error("Password must not be empty");
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Constant-time check; returns false (never throws) for malformed stored hashes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  try {
    const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
