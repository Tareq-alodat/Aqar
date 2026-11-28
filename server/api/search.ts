import { Router, type Request, type Response } from "express";
import type { Knex } from "knex";
import { z } from "zod";
import { DEFAULT_LOCALE } from "../../app/shared/locales";
import {
  bboxSchema,
  cleanQuery,
  countryCodeSchema,
  parseMapSearch,
  polygonSchema,
  Q_MAX_LENGTH,
} from "../../app/shared/schemas/mapSearch";
import { localeSchema } from "../../app/shared/schemas/routeParams";
import { rateLimit } from "../middleware/rateLimit";
import { getAreaTree, getOutlines, getPathAt, suggestAreas } from "../services/areaService";
import type { Limiters } from "../services/rateLimitService";
import {
  assertValidPolygon,
  InvalidPolygonError,
  searchListings,
  searchPoints,
  type SearchArea,
} from "../services/searchService";

export interface SearchApiDeps {
  db: Knex;
  limiters?: Limiters;
}

/** Query string as plain strings; null if a parameter is repeated or nested (refused as invalid input). */
function queryRecord(req: Request): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v !== "string") return null;
    out[k] = v;
  }
  return out;
}

function badRequest(res: Response, fields?: string[]) {
  res.status(400).json(fields ? { error: "invalid_input", fields } : { error: "invalid_input" });
}

/**
 * Country + area + filters from a GET query; sends 400 and returns null on bad input.
 * Area: `poly`, else `near` (+ `radius`), else `bbox`; a text search (`q`) without
 * any of them covers the whole country (SPEC §5.6).
 */
function readSearchQuery(req: Request, res: Response) {
  const q = queryRecord(req);
  if (!q) return badRequest(res), null;
  const country = countryCodeSchema.safeParse(q.country);
  const { state, invalid } = parseMapSearch(q);
  const fields = [...invalid];
  if (!country.success) fields.push("country");

  let area: SearchArea | null = null;
  if (state.poly) area = { kind: "polygon", ring: state.poly };
  else if (state.near) area = { kind: "near", center: state.near, radiusM: state.radius * 1000 };
  else if (q.bbox === undefined && state.q) area = { kind: "country" };
  else {
    const bbox = bboxSchema.safeParse(q.bbox);
    if (bbox.success) area = { kind: "bbox", bbox: bbox.data };
    else fields.push("bbox");
  }
  if (fields.length || !country.success || !area) return badRequest(res, fields), null;
  return { q, country: country.data, state, area };
}

const postPointsSchema = z.object({
  country: countryCodeSchema,
  polygon: polygonSchema,
  filters: z.record(z.string(), z.string().max(500)).default({}),
});

const outlinesQuery = z.object({ country: countryCodeSchema, level: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/) });
const atQuery = z.object({
  country: countryCodeSchema,
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  z: z.coerce.number().min(0).max(22),
});
const suggestQuery = z.object({
  country: countryCodeSchema,
  q: z
    .string()
    .max(Q_MAX_LENGTH * 4)
    .transform((s) => cleanQuery(s) ?? "")
    .pipe(z.string().min(1).max(Q_MAX_LENGTH)),
});

/** /api/v1/map, /api/v1/listings, /api/v1/areas (SPEC §5.4). Public; published listings only. */
export function searchRouter({ db, limiters }: SearchApiDeps): Router {
  const router = Router();
  const withPolygonCheck = async (area: SearchArea, res: Response): Promise<boolean> => {
    if (area.kind !== "polygon") return true;
    try {
      await assertValidPolygon(db, area.ring);
      return true;
    } catch (error) {
      if (error instanceof InvalidPolygonError) {
        badRequest(res, ["poly"]);
        return false;
      }
      throw error;
    }
  };

  const pointsLimit = limiters ? [rateLimit(limiters.mapPoints)] : [];
  const suggestLimit = limiters ? [rateLimit(limiters.areasSuggest)] : [];

  router.get("/map/points", ...pointsLimit, async (req, res, next) => {
    try {
      const input = readSearchQuery(req, res);
      if (!input || !(await withPolygonCheck(input.area, res))) return;
      res.json(await searchPoints(db, input.country, input.area, input.state.filters, input.state.q));
    } catch (error) {
      next(error);
    }
  });

  router.post("/map/points", ...pointsLimit, async (req, res, next) => {
    try {
      const body = postPointsSchema.safeParse(req.body ?? {});
      if (!body.success) return badRequest(res, body.error.issues.map((i) => String(i.path[0] ?? "body")));
      const { state, invalid } = parseMapSearch(body.data.filters);
      // A drawn area and "near me" are mutually exclusive (§5.6).
      if (state.near) invalid.push("near");
      if (invalid.length) return badRequest(res, invalid);
      const area: SearchArea = { kind: "polygon", ring: body.data.polygon.coordinates[0]! as Array<[number, number]> };
      if (!(await withPolygonCheck(area, res))) return;
      res.json(await searchPoints(db, body.data.country, area, state.filters, state.q));
    } catch (error) {
      next(error);
    }
  });

  router.get("/listings", async (req, res, next) => {
    try {
      const input = readSearchQuery(req, res);
      if (!input) return;
      const lang = localeSchema.default(DEFAULT_LOCALE).safeParse(input.q.lang);
      if (!lang.success) return badRequest(res, ["lang"]);
      if (!(await withPolygonCheck(input.area, res))) return;
      const { filters, sort, page } = input.state;
      res.json(await searchListings(db, input.country, input.area, filters, sort, page, lang.data, input.state.q));
    } catch (error) {
      next(error);
    }
  });

  router.get("/areas/tree", async (req, res, next) => {
    try {
      const country = countryCodeSchema.safeParse(req.query.country);
      if (!country.success) return badRequest(res, ["country"]);
      res.set("Cache-Control", "public, max-age=3600").json(await getAreaTree(db, country.data));
    } catch (error) {
      next(error);
    }
  });

  router.get("/areas/outlines", async (req, res, next) => {
    try {
      const q = outlinesQuery.safeParse(req.query);
      if (!q.success) return badRequest(res, q.error.issues.map((i) => String(i.path[0])));
      const outlines = await getOutlines(db, q.data.country, q.data.level);
      if (!outlines) return void res.status(404).json({ error: "not_found" });
      res.set("Cache-Control", "public, max-age=3600").json(outlines);
    } catch (error) {
      next(error);
    }
  });

  router.get("/areas/at", async (req, res, next) => {
    try {
      const q = atQuery.safeParse(req.query);
      if (!q.success) return badRequest(res, q.error.issues.map((i) => String(i.path[0])));
      res.json({ path: await getPathAt(db, q.data.country, q.data, q.data.z) });
    } catch (error) {
      next(error);
    }
  });

  // Location autocomplete (§5.6): its own rate limit, so typing does not use the general budget.
  router.get("/areas/suggest", ...suggestLimit, async (req, res, next) => {
    try {
      const q = suggestQuery.safeParse(req.query);
      if (!q.success) return badRequest(res, [...new Set(q.error.issues.map((i) => String(i.path[0])))]);
      res.set("Cache-Control", "public, max-age=300").json({ items: await suggestAreas(db, q.data.country, q.data.q) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
