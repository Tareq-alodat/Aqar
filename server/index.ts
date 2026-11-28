import { createServer } from "./createServer";
import { getDb } from "./db/knex";
import { COMMISSION_TERMS_VERSION } from "../app/shared/terms";
import { companyLegalFromEnv, env, isProduction, requireAuthSecrets, requireSecrets } from "./env";
import { assertLaunchReady } from "./launchChecks";

// Auth keys are required: refuse to start without them (SPEC §13).
const authSecrets = requireAuthSecrets();
// Production launch guard (SPEC §20): reviewed terms and the company's legal details.
if (isProduction) assertLaunchReady({ termsVersion: COMMISSION_TERMS_VERSION, company: companyLegalFromEnv() });

if (!isProduction) console.log("Starting development server");
const { app } = await createServer({
  isProduction,
  port: env.PORT,
  publicBaseUrl: env.PUBLIC_BASE_URL,
  uploadDir: env.UPLOAD_DIR,
  db: getDb(),
  authSecrets,
  phoneSecrets: requireSecrets,
  submissionsPerDay: env.SUBMISSIONS_PER_DAY,
});

app.listen(env.PORT, () => {
  console.log(`Server is running on http://localhost:${env.PORT}`);
});
