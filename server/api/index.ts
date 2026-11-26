import express, { Router, type ErrorRequestHandler } from "express";
import { authenticate } from "../middleware/authenticate";
import { rateLimit } from "../middleware/rateLimit";
import type { Limiters } from "../services/rateLimitService";
import { authRouter, type AuthApiDeps } from "./auth";
import { healthRouter, type HealthDeps } from "./health";

export interface ApiDeps extends HealthDeps {
  /** Auth routes and session resolution; omitted only in tests of other routers. */
  auth?: AuthApiDeps;
  limiters?: Limiters;
}

/** REST API mounted at /api/v1. */
export function createApiRouter(deps: ApiDeps): Router {
  const api = Router();
  // Limit first, so a flood costs no database work.
  if (deps.limiters) api.use(rateLimit(deps.limiters.api));
  api.use(express.json({ limit: "1mb" }));
  if (deps.auth) api.use(authenticate(deps.auth.service, deps.auth.cookies));

  api.use("/health", healthRouter(deps));
  if (deps.auth) api.use("/auth", authRouter(deps.auth));

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
