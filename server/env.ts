import "dotenv/config";
import { z } from "zod";

/** A base64 string that decodes to exactly 32 bytes (AES-256 key / HMAC key). */
const key32 = z
  .string()
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded");

/** `KEY=` in a .env file means "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Port the Node app listens on (Caddy proxies to it in production).
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: optional(z.string().min(1)),
  // Separate database for `npm run test:db`; never the dev or production database.
  DATABASE_URL_TEST: optional(z.string().min(1)),
  UPLOAD_DIR: z.string().min(1).default("./uploads"),
  // Optional at startup so the app can boot without them; services that need them call requireSecrets().
  ENCRYPTION_KEY: optional(key32),
  PHONE_HASH_KEY: optional(key32),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
export const isProduction = env.NODE_ENV === "production";

export interface Secrets {
  encryptionKey: Buffer;
  phoneHashKey: Buffer;
}

/** Phone encryption/hash keys from env; throws (without echoing values) if missing. */
export function requireSecrets(): Secrets {
  if (!env.ENCRYPTION_KEY || !env.PHONE_HASH_KEY) {
    throw new Error("ENCRYPTION_KEY and PHONE_HASH_KEY must be set (32 bytes, base64). See .env.example.");
  }
  return {
    encryptionKey: Buffer.from(env.ENCRYPTION_KEY, "base64"),
    phoneHashKey: Buffer.from(env.PHONE_HASH_KEY, "base64"),
  };
}
