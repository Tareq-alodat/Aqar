import path from "node:path";
import { pathToFileURL } from "node:url";
import compression from "compression";
import express, { type RequestHandler } from "express";
import morgan from "morgan";
import { env, isProduction, requireAuthSecrets, requireSecrets } from "./env";
import { createApiRouter } from "./api";
import { getDb } from "./db/knex";
import { provideServices } from "./loadContext";
import { authenticate } from "./middleware/authenticate";
import { originCheck } from "./middleware/originCheck";
import { createAuthCookies } from "./services/authCookies";
import { createAuthService } from "./services/authService";
import { checkDatabase } from "./services/healthService";
import { createLimiters } from "./services/rateLimitService";

const BUILD_PATH = path.resolve("build/server/index.js");

// Auth keys are required: refuse to start without them (SPEC §13).
const authSecrets = requireAuthSecrets();
const publicOrigin = new URL(env.PUBLIC_BASE_URL).origin;
const cookies = createAuthCookies({ secure: publicOrigin.startsWith("https:") });
const limiters = createLimiters();
const auth = createAuthService({ db: getDb(), secrets: authSecrets, limiters, phoneSecrets: requireSecrets });
const services = { auth, cookies };
// Compute the dummy password hash now rather than on the first failed login.
auth.warmUp().catch(() => console.error("[auth] could not prepare the dummy password hash"));

const allowedOrigins = isProduction
  ? [publicOrigin]
  : [publicOrigin, `http://localhost:${env.PORT}`, `http://127.0.0.1:${env.PORT}`];

const app = express();
app.disable("x-powered-by");
// Caddy runs on the same host in production: trust it for the client IP (rate limits).
if (isProduction) app.set("trust proxy", "loopback");
app.use(compression());
app.use(morgan(isProduction ? "tiny" : "dev"));
// CSRF: state-changing requests (API and page forms) must come from our own origin.
app.use(originCheck(allowedOrigins));

app.use("/api/v1", createApiRouter({ isProduction, checkDatabase, auth: { service: auth, cookies }, limiters }));

// Local image storage is development-only here; Caddy serves /uploads in production (SPEC §0).
if (!isProduction) {
  app.use("/uploads", express.static(path.resolve(env.UPLOAD_DIR)));
}

// Pages: resolve the session after static files, so assets cost no database query.
const pageAuth = [provideServices(services), authenticate(auth, cookies)];

if (isProduction) {
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
  );
  app.use(express.static("build/client", { maxAge: "1h" }));
  const build = (await import(pathToFileURL(BUILD_PATH).href)) as { app: RequestHandler };
  app.use(...pageAuth, build.app);
} else {
  console.log("Starting development server");
  const vite = await import("vite");
  const viteDevServer = await vite.createServer({
    server: { middlewareMode: true },
  });
  app.use(viteDevServer.middlewares);
  app.use(...pageAuth, async (req, res, next) => {
    try {
      const source = (await viteDevServer.ssrLoadModule("./server/app.ts")) as {
        app: RequestHandler;
      };
      await source.app(req, res, next);
    } catch (error) {
      if (error instanceof Error) viteDevServer.ssrFixStacktrace(error);
      next(error);
    }
  });
}

app.listen(env.PORT, () => {
  console.log(`Server is running on http://localhost:${env.PORT}`);
});
