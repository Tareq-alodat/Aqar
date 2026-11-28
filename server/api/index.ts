import express, { Router, type ErrorRequestHandler, type Request } from "express";
import type { Knex } from "knex";
import { authenticate } from "../middleware/authenticate";
import { rateLimit } from "../middleware/rateLimit";
import type { Limiters } from "../services/rateLimitService";
import type { SubmissionDeps } from "../services/submissionService";
import type { ViewConfig } from "../services/viewService";
import { authRouter, type AuthApiDeps } from "./auth";
import { healthRouter, type HealthDeps } from "./health";
import { listingRouter } from "./listing";
import { myListingsRouter } from "./myListings";
import { searchRouter } from "./search";

export interface ApiDeps extends HealthDeps {
  /** Auth routes and session resolution; omitted only in tests of other routers. */
  auth?: AuthApiDeps;
  limiters?: Limiters;
  /** Map search, listings and areas; omitted only in tests of other routers. */
  db?: Knex;
  /** View counting (listing detail); needed with `db`. */
  views?: ViewConfig;
  /** Submit wizard (storage, phone keys); omitted only in tests of other routers. */
  submission?: SubmissionDeps;
}

/**
 * Endpoints with their own limit, not counted in the general one:
 * /map/points (60/min) and the listing view beacon (30/min).
 */
const hasOwnLimit = (req: Request) => req.path === "/map/points" || /^\/listings\/[^/]+\/view$/.test(req.path);

/** REST API mounted at /api/v1. */
export function createApiRouter(deps: ApiDeps): Router {
  const api = Router();
  // Limit first, so a flood costs no database work.
  if (deps.limiters) api.use(rateLimit(deps.limiters.api, { skip: hasOwnLimit }));
  api.use(express.json({ limit: "1mb" }));
  if (deps.auth) api.use(authenticate(deps.auth.service, deps.auth.cookies));

  api.use("/health", healthRouter(deps));
  if (deps.auth) api.use("/auth", authRouter(deps.auth));
  if (deps.db) api.use(searchRouter({ db: deps.db, limiters: deps.limiters }));
  if (deps.db && deps.views) api.use(listingRouter({ db: deps.db, views: deps.views, limiters: deps.limiters }));
  if (deps.submission) api.use(myListingsRouter({ ...deps.submission, limiters: deps.limiters }));

  api.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // Malformed JSON bodies are client errors.
    if ((err as { type?: string } | null)?.type === "entity.parse.failed") {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    // Never echo error details (they could contain request data) to clients.
    console.error("[api] unhandled error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "internal_error" });
  };
  api.use(errorHandler);

  return api;
}
