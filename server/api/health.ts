import { Router } from "express";
import type { DbStatus } from "../services/healthService";

export interface HealthDeps {
  isProduction: boolean;
  checkDatabase: () => Promise<DbStatus>;
}

export function healthRouter({ isProduction, checkDatabase }: HealthDeps): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    // Production: status only. Details (env, uptime, DB) are for development.
    if (isProduction) {
      res.json({ status: "ok" });
      return;
    }
    res.json({
      status: "ok",
      env: process.env.NODE_ENV ?? "development",
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      db: await checkDatabase(),
    });
  });

  return router;
}
