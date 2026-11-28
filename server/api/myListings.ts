import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "../../app/shared/constants";
import { DEFAULT_COUNTRY, toCountryCode } from "../../app/shared/countries";
import { reorderSchema, saveStepSchema, submitSchema, typeStepSchema } from "../../app/shared/schemas/listingForm";
import { requireAuth } from "../middleware/requireAuth";
import { ImageError } from "../services/imageService";
import { take, type Limiters } from "../services/rateLimitService";
import {
  addImage,
  createDraft,
  deleteDraft,
  deleteImage,
  getDraft,
  reorderImages,
  saveStep,
  SubmissionError,
  submitDraft,
  type Lister,
  type SubmissionDeps,
} from "../services/submissionService";

/**
 * The lister's own listings (submit wizard, SPEC §7). Owner-only: someone
 * else's listing is a 404. Responses may contain the true pin and private
 * address fields of the lister's own listing, so they are never cached.
 */

export interface MyListingsApiDeps extends SubmissionDeps {
  limiters?: Limiters;
}

const idParam = z.coerce.number().int().positive().max(2_147_483_647);

const STATUS: Record<SubmissionError["code"], number> = {
  forbidden: 403,
  not_found: 404,
  not_editable: 409,
  submission_rate_limited: 429,
  draft_limit: 409,
  out_of_area: 400,
  too_many_photos: 409,
  incomplete: 400,
  terms_outdated: 409,
  phone_required: 400,
  phone_invalid: 400,
  invalid_order: 400,
};

const lister = (res: Response): Lister => {
  const u = res.locals.session!.user;
  return { id: u.id, role: u.role };
};

function fail(res: Response, next: NextFunction, error: unknown) {
  if (error instanceof SubmissionError) {
    if (error.retryAfterS) res.set("Retry-After", String(error.retryAfterS));
    res.status(STATUS[error.code]).json(error.missing ? { error: error.code, missing: error.missing } : { error: error.code });
    return;
  }
  if (error instanceof ImageError) {
    res.status(error.code === "too_large" ? 413 : 415).json({ error: `image_${error.code}` });
    return;
  }
  next(error);
}

/** One image per request, in memory (≤ 10 MB); the content is checked by sharp, not the declared type. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1 },
}).single("image");

export function myListingsRouter(deps: MyListingsApiDeps): Router {
  const router = Router();
  router.use("/my", requireAuth, (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });

  const withId = (handler: (req: Request, res: Response, id: number) => Promise<void>) => async (req: Request, res: Response, next: NextFunction) => {
    const id = idParam.safeParse(req.params.id);
    if (!id.success) return void res.status(400).json({ error: "invalid_input" });
    try {
      await handler(req, res, id.data);
    } catch (error) {
      fail(res, next, error);
    }
  };

  router.post("/my/listings", async (req, res, next) => {
    const body = typeStepSchema.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "invalid_input" });
    try {
      const id = await createDraft(deps, lister(res), toCountryCode(DEFAULT_COUNTRY), body.data);
      res.status(201).json({ id });
    } catch (error) {
      fail(res, next, error);
    }
  });

  router.get(
    "/my/listings/:id",
    withId(async (_req, res, id) => {
      res.json({ draft: await getDraft(deps.db, lister(res), id) });
    }),
  );

  router.patch(
    "/my/listings/:id",
    withId(async (req, res, id) => {
      const body = saveStepSchema.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "invalid_input" });
      res.json(await saveStep(deps, lister(res), id, body.data));
    }),
  );

  router.delete(
    "/my/listings/:id",
    withId(async (_req, res, id) => {
      await deleteDraft(deps, lister(res), id);
      res.status(204).end();
    }),
  );

  // Per-user limit before parsing the upload, so a flood costs no memory or image work.
  const uploadLimit = async (_req: Request, res: Response, next: NextFunction) => {
    if (!deps.limiters) return next();
    const r = await take(deps.limiters.uploads, `user:${res.locals.session!.user.id}`);
    if (r.ok) return next();
    res.set("Retry-After", String(r.retryAfterS)).status(429).json({ error: "rate_limited" });
  };

  router.post(
    "/my/listings/:id/images",
    uploadLimit,
    (req, res, next) => {
      upload(req, res, (error: unknown) => {
        if (!error) return next();
        if (error instanceof multer.MulterError) {
          return void res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "image_too_large" : "invalid_input" });
        }
        next(error);
      });
    },
    withId(async (req, res, id) => {
      if (!req.file) return void res.status(400).json({ error: "invalid_input" });
      res.status(201).json({ image: await addImage(deps, lister(res), id, req.file.buffer) });
    }),
  );

  router.delete(
    "/my/listings/:id/images/:imageId",
    withId(async (req, res, id) => {
      const imageId = idParam.safeParse(req.params.imageId);
      if (!imageId.success) return void res.status(400).json({ error: "invalid_input" });
      await deleteImage(deps, lister(res), id, imageId.data);
      res.status(204).end();
    }),
  );

  router.put(
    "/my/listings/:id/images/order",
    withId(async (req, res, id) => {
      const body = reorderSchema.safeParse(req.body);
      if (!body.success) return void res.status(400).json({ error: "invalid_input" });
      await reorderImages(deps, lister(res), id, body.data.ids);
      res.status(204).end();
    }),
  );

  router.post(
    "/my/listings/:id/submit",
    withId(async (req, res, id) => {
      const body = submitSchema.safeParse(req.body);
      if (!body.success) {
        const terms = body.error.issues.some((i) => i.path[0] === "acceptTerms");
        return void res.status(400).json({ error: terms ? "terms_required" : "invalid_input" });
      }
      await submitDraft(deps, lister(res), id, body.data);
      res.json({ id, status: "pending" });
    }),
  );

  return router;
}
