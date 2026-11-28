import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express, { type Express } from "express";
import type { Knex } from "knex";
import morgan from "morgan";
import type { ServerBuild } from "react-router";
import type { AuthSecrets, Secrets } from "./env";
import { createApiRouter } from "./api";
import { LocalDiskStorage } from "./services/storageService";
import { DEFAULT_SUBMISSIONS_PER_DAY } from "../app/shared/constants";
import { createGetLoadContext } from "./loadContext";
import { authenticate } from "./middleware/authenticate";
import { originCheck } from "./middleware/originCheck";
import { createAuthCookies } from "./services/authCookies";
import { createAuthService } from "./services/authService";
import { checkDatabase } from "./services/healthService";
import { createLimiters, type Limiters } from "./services/rateLimitService";

export interface ServerOptions {
  isProduction: boolean;
  port: number;
  publicBaseUrl: string;
  uploadDir: string;
  db: Knex;
  authSecrets: AuthSecrets;
  phoneSecrets: () => Secrets;
  /** Rate limiters; tests pass their own (e.g. to lift the login limit). Defaults to SPEC §13 limits. */
  limiters?: Limiters;
  /** Listing submissions per user per rolling 24 h (default 10). */
  submissionsPerDay?: number;
  /** Vite's HMR websocket in development (tests turn it off). */
  hmr?: boolean;
  /** Request log lines (off in tests). */
  logRequests?: boolean;
}

export interface AqarServer {
  app: Express;
  close(): Promise<void>;
}

const BUILD_PATH = path.resolve("build/server/index.js");

/**
 * The Express app: origin check, /api/v1, /uploads (dev), static files
 * (production) and the React Router handler.
 *
 * The React Router handler and its `getLoadContext` are created here for both
 * modes, so loaders always receive the services of *this* process: in
 * development the route modules come from Vite (`virtual:react-router/server-build`,
 * reloaded on change), in production from the build. There is no second
 * Express app loaded through Vite.
 */
export async function createServer(o: ServerOptions): Promise<AqarServer> {
  const publicOrigin = new URL(o.publicBaseUrl).origin;
  const cookies = createAuthCookies({ secure: publicOrigin.startsWith("https:") });
  const limiters = o.limiters ?? createLimiters();
  const auth = createAuthService({ db: o.db, secrets: o.authSecrets, limiters, phoneSecrets: o.phoneSecrets });
  const views = { secret: o.authSecrets.refreshTokenSecret, secure: publicOrigin.startsWith("https:") };
  // Listing photos on the VPS disk under UPLOAD_DIR, served at /uploads (SPEC §0).
  const submission = {
    db: o.db,
    storage: new LocalDiskStorage(o.uploadDir),
    phoneSecrets: o.phoneSecrets,
    submissionsPerDay: o.submissionsPerDay ?? DEFAULT_SUBMISSIONS_PER_DAY,
  };
  const services = { auth, cookies, db: o.db, views, publicOrigin, submission };
  // Compute the dummy password hash now rather than on the first failed login.
  auth.warmUp().catch(() => console.error("[auth] could not prepare the dummy password hash"));

  const allowedOrigins = o.isProduction
    ? [publicOrigin]
    : [publicOrigin, `http://localhost:${o.port}`, `http://127.0.0.1:${o.port}`];

  const app = express();
  app.disable("x-powered-by");
  // Caddy runs on the same host in production: trust it for the client IP (rate limits).
  if (o.isProduction) app.set("trust proxy", "loopback");
  app.use(compression());
  if (o.logRequests ?? true) app.use(morgan(o.isProduction ? "tiny" : "dev"));
  // CSRF: state-changing requests (API and page forms) must come from our own origin.
  app.use(originCheck(allowedOrigins));

  app.use(
    "/api/v1",
    createApiRouter({ isProduction: o.isProduction, checkDatabase, auth: { service: auth, cookies }, limiters, db: o.db, views, submission }),
  );

  // Local image storage is development-only here; Caddy serves /uploads in production (SPEC §0).
  if (!o.isProduction) app.use("/uploads", express.static(path.resolve(o.uploadDir)));

  const getLoadContext = createGetLoadContext(services);
  // Pages: resolve the session after static files, so assets cost no database query.
  const pageAuth = authenticate(auth, cookies);

  if (o.isProduction) {
    app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
    app.use(express.static("build/client", { maxAge: "1h" }));
    const build = (await import(pathToFileURL(BUILD_PATH).href)) as ServerBuild;
    app.use(pageAuth, createRequestHandler({ build, getLoadContext }));
    return { app, close: async () => {} };
  }

  const vite = await import("vite");
  const viteDevServer = await vite.createServer({ server: { middlewareMode: true, hmr: o.hmr ?? true } });
  app.use(viteDevServer.middlewares);
  const handler = createRequestHandler({
    build: () => viteDevServer.ssrLoadModule("virtual:react-router/server-build") as Promise<ServerBuild>,
    getLoadContext,
  });
  app.use(pageAuth, async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (error instanceof Error) viteDevServer.ssrFixStacktrace(error);
      next(error);
    }
  });
  return { app, close: () => viteDevServer.close() };
}
