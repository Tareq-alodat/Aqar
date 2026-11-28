import { Router, type NextFunction, type Request, type Response } from "express";
import type { Knex } from "knex";
import { z } from "zod";
import {
  BACKOFFICE_ERROR_STATUS,
  idParamSchema,
  issueCodes,
  reassignSchema,
  scopesSchema,
  supervisorActiveSchema,
  supervisorCreateSchema,
  supervisorUpdateSchema,
  type BackofficeErrorCode,
} from "../../app/shared/schemas/backoffice";
import { requestMeta } from "../middleware/authenticate";
import { AssignmentError, reassignListing } from "../services/assignmentService";
import { getStaffAccess, type Actor } from "../services/scopeService";
import {
  createSupervisor,
  getSupervisor,
  listSupervisors,
  resetSupervisorPassword,
  scopeAreaTree,
  scopeCountries,
  setSupervisorActive,
  setSupervisorScopes,
  SupervisorError,
  updateSupervisor,
} from "../services/supervisorService";
import { hashIp } from "../services/tokenService";

/**
 * /api/v1/backoffice (SPEC §9). Staff only: the super_admin, or a supervisor
 * with an active profile. Every response is `private, no-store`. Supervisor
 * management and reassignment are super_admin only.
 */

export interface BackofficeDeps {
  db: Knex;
  /** Key for the IP hash stored with audit entries. */
  ipHashSecret: Buffer;
}

const countrySchema = z.object({ country: z.string().regex(/^[A-Za-z]{2}$/).transform((v) => v.toUpperCase()).default("JO") });

export function backofficeRouter(deps: BackofficeDeps): Router {
  const router = Router();
  const { db } = deps;

  router.use(async (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    const user = res.locals.session?.user;
    if (!user) return void res.status(401).json({ error: "unauthenticated" });
    try {
      if ((await getStaffAccess(db, user)) !== "ok") return void res.status(403).json({ error: "forbidden" });
      next();
    } catch (error) {
      next(error);
    }
  });

  const actor = (res: Response): Actor => ({ id: res.locals.session!.user.id, role: res.locals.session!.user.role });
  const ctx = (req: Request) => ({ ipHash: hashIp(requestMeta(req).ip, deps.ipHashSecret) });
  const superAdminOnly = (_req: Request, res: Response, next: NextFunction) => {
    if (res.locals.session!.user.role !== "super_admin") return void res.status(403).json({ error: "forbidden" });
    next();
  };

  const fail = (res: Response, next: NextFunction, error: unknown) => {
    if (error instanceof SupervisorError || error instanceof AssignmentError) {
      const code = error.code as BackofficeErrorCode;
      return void res.status(BACKOFFICE_ERROR_STATUS[code]).json({ error: code });
    }
    next(error);
  };

  const handle =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await fn(req, res);
      } catch (error) {
        fail(res, next, error);
      }
    };

  const withId =
    (fn: (req: Request, res: Response, id: number) => Promise<void>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      const id = idParamSchema.safeParse(req.params.id);
      if (!id.success) return void res.status(404).json({ error: "not_found" });
      try {
        await fn(req, res, id.data);
      } catch (error) {
        fail(res, next, error);
      }
    };

  const invalid = (res: Response, error: z.ZodError) => res.status(400).json({ error: "invalid_input", fields: issueCodes(error) });

  // ── Supervisors (super_admin) ───────────────────────────────────────────
  router.use("/supervisors", superAdminOnly);
  router.use("/areas", superAdminOnly);

  router.get(
    "/supervisors",
    handle(async (_req, res) => {
      res.json({ supervisors: await listSupervisors(db, actor(res)) });
    }),
  );

  router.post(
    "/supervisors",
    handle(async (req, res) => {
      const input = supervisorCreateSchema.safeParse(req.body ?? {});
      if (!input.success) return void invalid(res, input.error);
      const created = await createSupervisor(db, actor(res), input.data, ctx(req));
      // The one-time password is in this response only; it is never stored or logged.
      res.status(201).json(created);
    }),
  );

  router.get(
    "/supervisors/:id",
    withId(async (_req, res, id) => {
      res.json({ supervisor: await getSupervisor(db, actor(res), id) });
    }),
  );

  router.patch(
    "/supervisors/:id",
    withId(async (req, res, id) => {
      const input = supervisorUpdateSchema.safeParse(req.body ?? {});
      if (!input.success) return void invalid(res, input.error);
      await updateSupervisor(db, actor(res), id, input.data, ctx(req));
      res.json({ supervisor: await getSupervisor(db, actor(res), id) });
    }),
  );

  router.put(
    "/supervisors/:id/scopes",
    withId(async (req, res, id) => {
      const input = scopesSchema.safeParse(req.body ?? {});
      if (!input.success) return void invalid(res, input.error);
      const result = await setSupervisorScopes(db, actor(res), id, input.data, ctx(req));
      res.json(result);
    }),
  );

  router.post(
    "/supervisors/:id/active",
    withId(async (req, res, id) => {
      const input = supervisorActiveSchema.safeParse(req.body ?? {});
      if (!input.success) return void invalid(res, input.error);
      res.json(await setSupervisorActive(db, actor(res), id, input.data, ctx(req)));
    }),
  );

  router.post(
    "/supervisors/:id/password-reset",
    withId(async (req, res, id) => {
      res.json(await resetSupervisorPassword(db, actor(res), id, ctx(req)));
    }),
  );

  router.get(
    "/areas",
    handle(async (req, res) => {
      const q = countrySchema.safeParse(req.query);
      if (!q.success) return void invalid(res, q.error);
      res.json({ countries: await scopeCountries(db), areas: await scopeAreaTree(db, q.data.country) });
    }),
  );

  // ── Listing assignment (super_admin) ────────────────────────────────────
  router.post(
    "/listings/:id/assignment",
    superAdminOnly,
    withId(async (req, res, id) => {
      const input = reassignSchema.safeParse(req.body ?? {});
      if (!input.success) return void invalid(res, input.error);
      res.json(await reassignListing(db, actor(res), id, { ...input.data, ...ctx(req) }));
    }),
  );

  router.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return router;
}
