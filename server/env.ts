import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // GoDaddy Node.js Hosting (and most hosts) provide the port via PORT.
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  UPLOAD_DIR: z.string().min(1).default("./uploads"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
export const isProduction = env.NODE_ENV === "production";
