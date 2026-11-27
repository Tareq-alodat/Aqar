import { parseCookie } from "cookie";
import { Router, type Response } from "express";
import type { Knex } from "knex";
import { z } from "zod";
import { DEFAULT_LOCALE } from "../../app/shared/locales";
import { localeSchema } from "../../app/shared/schemas/routeParams";
import { requestMeta } from "../middleware/authenticate";
import { rateLimit } from "../middleware/rateLimit";
import { requireAuth } from "../middleware/requireAuth";
import { getListingDetail, saveListing, similarListings, unsaveListing, type Viewer } from "../services/listingService";
import type { Limiters } from "../services/rateLimitService";
import { recordView, VISITOR_COOKIE, visitorHash, type ViewConfig } from "../services/viewService";

export interface ListingApiDeps {
  db: Knex;
  views: ViewConfig;
  limiters?: Limiters;
}

const idParam = z.coerce.number().int().positive().max(2_147_483_647);
const langQuery = localeSchema.default(DEFAULT_LOCALE);

const viewerOf = (res: Response): Viewer | null => {
  const s = res.locals.session;
  return s ? { userId: s.user.id, role: s.user.role } : null;
};

/** Owner/admin previews of non-public listings: never cached or indexed. */
function markPreview(res: Response) {
  res.set("Cache-Control", "private, no-store");
  res.set("X-Robots-Tag", "noindex");
}

/**
 * Listing detail API (SPEC §10):
 * GET /listings/:id, GET /listings/:id/similar, POST /listings/:id/view,
 * PUT|DELETE /listings/:id/save.
 */
export function listingRouter({ db, views, limiters }: ListingApiDeps): Router {
  const router = Router();

  router.get("/listings/:id", async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      const lang = langQuery.safeParse(req.query.lang);
      if (!id.success || !lang.success) return void res.status(400).json({ error: "invalid_input" });
      const result = await getListingDetail(db, id.data, viewerOf(res), lang.data);
      if (!result) return void res.status(404).json({ error: "not_found" });
      if (result.access === "preview") markPreview(res);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/listings/:id/similar", async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      const lang = langQuery.safeParse(req.query.lang);
      if (!id.success || !lang.success) return void res.status(400).json({ error: "invalid_input" });
      // Same visibility as the listing itself: no similar listings for a listing the viewer cannot see.
      const detail = await getListingDetail(db, id.data, viewerOf(res), lang.data);
      if (!detail) return void res.status(404).json({ error: "not_found" });
      if (detail.access === "preview") markPreview(res);
      res.json({ items: await similarListings(db, id.data, lang.data) });
    } catch (error) {
      next(error);
    }
  });

  // Sent by the page after it loads. Always 204 (unless rate-limited), so it reveals nothing.
  const viewLimit = limiters ? [rateLimit(limiters.views)] : [];
  router.post("/listings/:id/view", ...viewLimit, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) return void res.status(400).json({ error: "invalid_input" });
      const cookieId = req.headers.cookie ? parseCookie(req.headers.cookie)[VISITOR_COOKIE] : undefined;
      await recordView(db, {
        propertyId: id.data,
        visitorHash: visitorHash({ cookieId, ip: requestMeta(req).ip }, views.secret),
        viewer: viewerOf(res),
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.put("/listings/:id/save", requireAuth, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) return void res.status(400).json({ error: "invalid_input" });
      const ok = await saveListing(db, res.locals.session!.user.id, id.data);
      if (!ok) return void res.status(404).json({ error: "not_found" });
      res.json({ saved: true });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/listings/:id/save", requireAuth, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) return void res.status(400).json({ error: "invalid_input" });
      await unsaveListing(db, res.locals.session!.user.id, id.data);
      res.json({ saved: false });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
