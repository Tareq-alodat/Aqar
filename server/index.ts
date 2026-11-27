import { createServer } from "./createServer";
import { getDb } from "./db/knex";
import { env, isProduction, requireAuthSecrets, requireSecrets } from "./env";

// Auth keys are required: refuse to start without them (SPEC §13).
const authSecrets = requireAuthSecrets();

if (!isProduction) console.log("Starting development server");
const { app } = await createServer({
  isProduction,
  port: env.PORT,
  publicBaseUrl: env.PUBLIC_BASE_URL,
  uploadDir: env.UPLOAD_DIR,
  db: getDb(),
  authSecrets,
  phoneSecrets: requireSecrets,
});

app.listen(env.PORT, () => {
  console.log(`Server is running on http://localhost:${env.PORT}`);
});
