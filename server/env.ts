import "dotenv/config";
import { z } from "zod";
import type { PartialCompanyLegal } from "../app/shared/companyLegal";

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
  /** Listing submissions allowed per user per rolling 24 h (SPEC §7). */
  SUBMISSIONS_PER_DAY: z.coerce.number().int().min(1).max(1000).default(10),
  // Optional at startup so the app can boot without them; services that need them call requireSecrets().
  ENCRYPTION_KEY: optional(key32),
  PHONE_HASH_KEY: optional(key32),
  // Auth (SPEC §13). Optional here so tests and scripts can import env; the server requires them at startup.
  JWT_SECRET: optional(key32),
  REFRESH_TOKEN_SECRET: optional(key32),
  // Public origin of the site: CSRF origin check and Secure cookies (https).
  PUBLIC_BASE_URL: z.url().default("http://localhost:3000"),
  // Operating company's legal details (footer, invoices). Required in production (server/launchChecks.ts).
  COMPANY_LEGAL_NAME_AR: optional(z.string().trim().min(2).max(200)),
  COMPANY_LEGAL_NAME_EN: optional(z.string().trim().min(2).max(200)),
  COMPANY_CR_NUMBER: optional(z.string().trim().regex(/^[0-9A-Za-z/-]{1,40}$/, "letters, digits, / or - only")),
  COMPANY_TAX_NUMBER: optional(z.string().trim().regex(/^[0-9]{5,20}$/, "digits only")),
  COMPANY_SALES_TAX_REGISTERED: optional(z.enum(["true", "false"])),
  COMPANY_DLS_LICENSE_NUMBER: optional(z.string().trim().regex(/^[0-9A-Za-z/-]{1,40}$/, "letters, digits, / or - only")),
  // Basemap styles (SPEC §1): OpenFreeMap, no API key. Empty means the default below.
  MAP_STYLE_URL_DARK: optional(z.url()).transform((v) => v ?? "https://tiles.openfreemap.org/styles/dark"),
  MAP_STYLE_URL_LIGHT: optional(z.url()).transform((v) => v ?? "https://tiles.openfreemap.org/styles/positron"),
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

export interface AuthSecrets {
  /** HS256 key for access tokens. */
  jwtSecret: Buffer;
  /** HMAC key for refresh-token and IP hashes. */
  refreshTokenSecret: Buffer;
}

/** Auth keys from env; throws (without echoing values) if missing. The server calls it at startup. */
export function requireAuthSecrets(): AuthSecrets {
  if (!env.JWT_SECRET || !env.REFRESH_TOKEN_SECRET) {
    throw new Error("JWT_SECRET and REFRESH_TOKEN_SECRET must be set (32 bytes, base64). See .env.example.");
  }
  if (env.JWT_SECRET === env.REFRESH_TOKEN_SECRET) {
    throw new Error("JWT_SECRET and REFRESH_TOKEN_SECRET must be different keys.");
  }
  return {
    jwtSecret: Buffer.from(env.JWT_SECRET, "base64"),
    refreshTokenSecret: Buffer.from(env.REFRESH_TOKEN_SECRET, "base64"),
  };
}

/** The company's legal details that are set (any may be missing outside production). */
export function companyLegalFromEnv(e: Env = env): PartialCompanyLegal {
  const out: PartialCompanyLegal = {};
  if (e.COMPANY_LEGAL_NAME_AR) out.nameAr = e.COMPANY_LEGAL_NAME_AR;
  if (e.COMPANY_LEGAL_NAME_EN) out.nameEn = e.COMPANY_LEGAL_NAME_EN;
  if (e.COMPANY_CR_NUMBER) out.commercialRegistrationNumber = e.COMPANY_CR_NUMBER;
  if (e.COMPANY_TAX_NUMBER) out.taxNumber = e.COMPANY_TAX_NUMBER;
  if (e.COMPANY_SALES_TAX_REGISTERED) out.salesTaxRegistered = e.COMPANY_SALES_TAX_REGISTERED === "true";
  if (e.COMPANY_DLS_LICENSE_NUMBER) out.dlsLicenseNumber = e.COMPANY_DLS_LICENSE_NUMBER;
  return out;
}
