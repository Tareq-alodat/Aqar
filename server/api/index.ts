import express, { Router, type ErrorRequestHandler } from "express";
import { healthRouter, type HealthDeps } from "./health";

export type ApiDeps = HealthDeps;

/** REST API mounted at /api/v1. */
export function createApiRouter(deps: ApiDeps): Router {
  const api = Router();
  api.use(express.json({ limit: "1mb" }));

  api.use("/health", healthRouter(deps));

  api.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // Never echo error details (they could contain request data) to clients.
    console.error("[api] unhandled error:", err instanceof Error ? err.message : "unknown");
    res.status(500).json({ error: "internal_error" });
  };
  api.use(errorHandler);

  return api;
}
