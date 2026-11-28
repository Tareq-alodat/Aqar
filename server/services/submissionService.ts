import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import {
  AMENITY_TAGS,
  DEFAULT_SUBMISSIONS_PER_DAY,
  DRAFT_LIMIT,
  LISTER_ROLES,
  MAX_PHOTOS,
  type AmenityTag,
  type Category,
  type CommissionPayerType,
  type Furnished,
  type ListingStatus,
  type ListingType,
  type OffersVisibility,
  type RentPeriod,
  type Role,
} from "../../app/shared/constants";
import { maskPhone, normalizePhone } from "../../app/shared/phone";
import { buildAddressSchema, type CountryAddressField } from "../../app/shared/schemas/address";
import {
  hasAtMostDecimals,
  missingForSubmit,
  type DetailsStep,
  type DraftView,
  type LocationStep,
  type MissingField,
  type SaveStep,
  type SubmitInput,
  type SubmitRequirements,
  type TypeStep,
} from "../../app/shared/schemas/listingForm";
import { COMMISSION_TERMS_VERSION } from "../../app/shared/terms";
import type { Secrets } from "../env";
import { getCountryAddressFields, getCountrySubmissionInfo, type CountrySubmissionInfo } from "./countryService";
import { decrypt, protectPhone } from "./cryptoService";
import { getIdentifierScheme, IdentifierError, normalizeIdentifier, type IdentifierInput, type IdentifierScheme } from "./identifierService";
import { processImage } from "./imageService";
import { computeDisplayPoint, findAdminAreaForPoint, getAreaPath } from "./locationService";
import type { Storage } from "./storageService";

/**
 * Submit wizard (SPEC §7): drafts owned by one lister, saved step by step,
 * then submitted → `pending`. Everything here is owner-only; responses carry
 * the true pin (CLAUDE.md rule 2 editing exception) and must be `no-store`.
 * The owner's phone is never returned — only a masked form (rule 1).
 */

export type SubmissionErrorCode =
  | "forbidden"
  | "not_found"
  | "not_editable"
  | "submission_rate_limited"
  | "draft_limit"
  | "out_of_area"
  | "too_many_photos"
  | "incomplete"
  | "terms_outdated"
  | "phone_required"
  | "phone_invalid"
  | "invalid_order";

export class SubmissionError extends Error {
  constructor(
    readonly code: SubmissionErrorCode,
    readonly missing?: MissingField[],
    /** For `submission_rate_limited`: seconds until the next submission is allowed. */
    readonly retryAfterS?: number,
  ) {
    super(code);
  }
}

/** Field-level problems from a save; the rest of the step is still saved (autosave). */
export type FieldErrors = Record<string, string>;

export interface Lister {
  id: number;
  role: Role;
}

export interface SubmissionDeps {
  db: Knex;
  storage: Storage;
  phoneSecrets: () => Secrets;
  /** Listing submissions per user per rolling 24 h (env `SUBMISSIONS_PER_DAY`, default 10). */
  submissionsPerDay?: number;
  now?: () => Date;
}

const isLister = (role: Role) => (LISTER_ROLES as readonly string[]).includes(role);
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));
const IDENT_SEPARATOR = "/";

function assertLister(user: Lister) {
  if (!isLister(user.role)) throw new SubmissionError("forbidden");
}

// ── Limits ──────────────────────────────────────────────────────────────────
// No limit on active listings (milestone 6 decision). Instead: at most 10 drafts
// per user (storage), and at most `submissionsPerDay` submissions per rolling 24 h.

const DAY_MS = 24 * 60 * 60 * 1000;

async function draftCount(db: Knex, userId: number): Promise<number> {
  const r = await db("properties").where({ owner_id: userId, status: "draft" }).count({ n: "*" }).first();
  return Number(r?.n ?? 0);
}

/**
 * Submissions in the last 24 h: listings whose commission terms were accepted
 * (that happens exactly at submission) in the window. Counted from the
 * database, so a restart does not reset it. Returns the oldest one too, to
 * tell the lister when the next submission is allowed.
 */
async function recentSubmissions(db: Knex, userId: number, now: Date): Promise<{ count: number; oldest: Date | null }> {
  const r = await db("properties")
    .where({ owner_id: userId })
    .where("commission_terms_accepted_at", ">", new Date(now.getTime() - DAY_MS))
    .count({ n: "*" })
    .min({ oldest: "commission_terms_accepted_at" })
    .first();
  return { count: Number(r?.n ?? 0), oldest: r?.oldest ? new Date(r.oldest) : null };
}

/** Where the lister stands: drafts (≤ 10) and submissions in the last 24 h. */
export async function getListerLimits(deps: Pick<SubmissionDeps, "db" | "submissionsPerDay" | "now">, user: Lister) {
  const now = deps.now?.() ?? new Date();
  const perDay = deps.submissionsPerDay ?? DEFAULT_SUBMISSIONS_PER_DAY;
  const [drafts, recent] = await Promise.all([draftCount(deps.db, user.id), recentSubmissions(deps.db, user.id, now)]);
  return {
    drafts,
    draftLimit: DRAFT_LIMIT,
    atDraftLimit: drafts >= DRAFT_LIMIT,
    submittedToday: recent.count,
    submissionsPerDay: perDay,
    atSubmissionLimit: recent.count >= perDay,
  };
}

// ── Drafts ──────────────────────────────────────────────────────────────────

/** Creates a draft from step 1. A lister with 10 drafts is refused. */
export async function createDraft(deps: SubmissionDeps, user: Lister, countryCode: string, type: TypeStep): Promise<number> {
  assertLister(user);
  return deps.db.transaction(async (trx) => {
    // Serialize this lister's creates/submits so two requests cannot both pass the limits.
    await trx("users").where({ id: user.id }).forUpdate().first("id");
    if ((await draftCount(trx, user.id)) >= DRAFT_LIMIT) throw new SubmissionError("draft_limit");
    const [row] = await trx("properties")
      .insert({
        owner_id: user.id,
        country_code: countryCode,
        category: type.category,
        listing_type: type.listingType,
        rent_period: type.rentPeriod,
        status: "draft",
      })
      .returning("id");
    return row.id as number;
  });
}

interface DraftRow {
  id: number;
  owner_id: number;
  status: ListingStatus;
  country_code: string;
  category: Category;
  listing_type: ListingType;
  rent_period: RentPeriod | null;
  admin_area_id: number | null;
  needs_location_review: boolean;
  address: Record<string, string>;
  price: string | null;
  area_sqm: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  floor_number: number | null;
  age_years: number | null;
  parking: boolean;
  garden: boolean;
  pool: boolean;
  elevator: boolean;
  furnished: Furnished | null;
  amenities: string[];
  title_ar: string | null;
  title_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  offers_visibility: OffersVisibility;
  slug: string | null;
  updated_at: Date;
  px: number | null;
  py: number | null;
  dx: number | null;
  dy: number | null;
}

const DRAFT_COLUMNS = [
  "id",
  "owner_id",
  "status",
  "country_code",
  "category",
  "listing_type",
  "rent_period",
  "admin_area_id",
  "needs_location_review",
  "address",
  "price",
  "area_sqm",
  "bedrooms",
  "bathrooms",
  "floors",
  "floor_number",
  "age_years",
  "parking",
  "garden",
  "pool",
  "elevator",
  "furnished",
  "amenities",
  "title_ar",
  "title_en",
  "description_ar",
  "description_en",
  "offers_visibility",
  "slug",
  "updated_at",
];

/** The lister's own listing, or not_found (someone else's listings are indistinguishable from missing ones). */
async function ownedRow(db: Knex, user: Lister, id: number, lock = false): Promise<DraftRow> {
  const q = db("properties")
    .where({ id })
    .first(
      ...DRAFT_COLUMNS,
      db.raw("ST_X(point::geometry) AS px"),
      db.raw("ST_Y(point::geometry) AS py"),
      db.raw("ST_X(display_point::geometry) AS dx"),
      db.raw("ST_Y(display_point::geometry) AS dy"),
    );
  if (lock) q.forUpdate();
  const row = (await q) as DraftRow | undefined;
  if (!row || row.owner_id !== user.id) throw new SubmissionError("not_found");
  row.country_code = row.country_code.trim();
  return row;
}

async function ownedDraft(db: Knex, user: Lister, id: number, lock = false): Promise<DraftRow> {
  const row = await ownedRow(db, user, id, lock);
  if (row.status !== "draft") throw new SubmissionError("not_editable");
  return row;
}

/** Identifier settings for the country: `field_key` → scheme. */
async function identifierSchemes(db: Knex, fields: CountryAddressField[]): Promise<Map<string, IdentifierScheme>> {
  const out = new Map<string, IdentifierScheme>();
  for (const f of fields.filter((f) => f.kind === "identifier")) {
    const scheme = await getIdentifierScheme(db, f.field_key);
    if (scheme) out.set(f.field_key, scheme);
  }
  return out;
}

/** Stored identifier value → the form's input (parts split back; optional parts are last). */
function identifierToInput(scheme: IdentifierScheme, value: string, category: Category): string | Record<string, string> {
  if (!scheme.parts) return value;
  const parts = scheme.parts.filter((p) => p.key !== "apartment" || category === "apartment");
  const values = value.split(IDENT_SEPARATOR);
  const out: Record<string, string> = {};
  parts.forEach((p, i) => {
    if (values[i] !== undefined) out[p.key] = values[i]!;
  });
  return out;
}

function round6(v: number) {
  return Number(Number(v).toFixed(6));
}

function toView(row: DraftRow, extra: { path: DraftView["location"]["areaPath"]; identifiers: DraftView["identifiers"]; images: DraftView["images"] }): DraftView {
  return {
    id: row.id,
    status: row.status,
    countryCode: row.country_code,
    category: row.category,
    listingType: row.listing_type,
    rentPeriod: row.rent_period,
    location: {
      point: row.px !== null && row.py !== null ? { lng: round6(row.px), lat: round6(row.py) } : null,
      displayPoint: row.dx !== null && row.dy !== null ? { lng: round6(row.dx), lat: round6(row.dy) } : null,
      areaPath: extra.path,
      needsReview: row.needs_location_review,
    },
    address: Object.fromEntries(Object.entries(row.address ?? {}).filter(([, v]) => typeof v === "string")),
    identifiers: extra.identifiers,
    details: {
      price: num(row.price),
      areaSqm: num(row.area_sqm),
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      floors: row.floors,
      floorNumber: row.floor_number,
      ageYears: row.age_years,
      parking: row.parking,
      garden: row.garden,
      pool: row.pool,
      elevator: row.elevator,
      furnished: row.furnished,
      amenities: (row.amenities ?? []).filter((a): a is AmenityTag => (AMENITY_TAGS as readonly string[]).includes(a)),
      titleAr: row.title_ar,
      titleEn: row.title_en,
      descriptionAr: row.description_ar,
      descriptionEn: row.description_en,
    },
    offersVisibility: row.offers_visibility,
    images: extra.images,
    slug: row.slug,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function buildView(db: Knex, row: DraftRow): Promise<DraftView> {
  const fields = await getCountryAddressFields(db, row.country_code);
  const schemes = await identifierSchemes(db, fields);
  const [path, idRows, images] = await Promise.all([
    row.admin_area_id ? getAreaPath(db, row.admin_area_id) : Promise.resolve([]),
    db("property_identifiers").where({ property_id: row.id }).select("scheme", "value"),
    db("property_images").where({ property_id: row.id }).orderBy("order_index").select("id", "url", "thumbnail_url", "width", "height"),
  ]);
  const identifiers: DraftView["identifiers"] = {};
  for (const r of idRows as Array<{ scheme: string; value: string }>) {
    const scheme = schemes.get(r.scheme);
    if (scheme) identifiers[r.scheme] = identifierToInput(scheme, r.value, row.category);
  }
  return toView(row, {
    path: path.map((a) => ({ id: a.id, level: a.level, nameAr: a.name_ar, nameEn: a.name_en })),
    identifiers,
    images: images.map((i: { id: number; url: string; thumbnail_url: string; width: number; height: number }) => ({
      id: i.id,
      url: i.url,
      thumbnailUrl: i.thumbnail_url,
      width: i.width,
      height: i.height,
    })),
  });
}

/** The lister's draft for the wizard (or a non-draft of theirs, read-only, e.g. just submitted). */
export async function getDraft(db: Knex, user: Lister, id: number): Promise<DraftView> {
  return buildView(db, await ownedRow(db, user, id));
}

/** The lister's drafts, newest first (to continue one). */
export async function listDrafts(db: Knex, user: Lister) {
  const rows = await db("properties as p")
    .where({ "p.owner_id": user.id, "p.status": "draft" })
    .orderBy("p.updated_at", "desc")
    .select(
      "p.id",
      "p.category",
      "p.listing_type",
      "p.title_ar",
      "p.title_en",
      "p.updated_at",
      db.raw("(SELECT i.thumbnail_url FROM property_images i WHERE i.property_id = p.id ORDER BY i.order_index LIMIT 1) AS thumbnail_url"),
    );
  return rows.map((r: { id: number; category: Category; listing_type: ListingType; title_ar: string | null; title_en: string | null; updated_at: Date; thumbnail_url: string | null }) => ({
    id: r.id,
    category: r.category,
    listingType: r.listing_type,
    titleAr: r.title_ar,
    titleEn: r.title_en,
    updatedAt: r.updated_at.toISOString(),
    thumbnailUrl: r.thumbnail_url,
  }));
}

// ── Saving steps ────────────────────────────────────────────────────────────

/** Saves one step of a draft. Invalid fields are reported and left unchanged; valid ones are saved. */
export async function saveStep(deps: SubmissionDeps, user: Lister, id: number, input: SaveStep): Promise<{ draft: DraftView; fieldErrors: FieldErrors }> {
  assertLister(user);
  const fieldErrors: FieldErrors = {};
  await deps.db.transaction(async (trx) => {
    const row = await ownedDraft(trx, user, id, true);
    switch (input.step) {
      case "type":
        await saveType(trx, row, input.data);
        break;
      case "location":
        await saveLocation(trx, row, input.data, fieldErrors);
        break;
      case "details":
        await saveDetails(trx, row, input.data, fieldErrors);
        break;
      case "review":
        if (input.data.offersVisibility) await trx("properties").where({ id }).update({ offers_visibility: input.data.offersVisibility });
        break;
    }
  });
  return { draft: await getDraft(deps.db, user, id), fieldErrors };
}

async function saveType(trx: Knex, row: DraftRow, data: TypeStep) {
  await trx("properties").where({ id: row.id }).update({
    category: data.category,
    listing_type: data.listingType,
    rent_period: data.rentPeriod,
  });
}

async function saveLocation(trx: Knex, row: DraftRow, data: LocationStep, errors: FieldErrors) {
  const update: Record<string, unknown> = {};

  if (data.point === null) {
    Object.assign(update, { point: null, display_point: null, admin_area_id: null, needs_location_review: false });
  } else if (data.point) {
    const point = data.point;
    const old = row.px !== null && row.py !== null ? { lng: round6(row.px), lat: round6(row.py) } : null;
    const pinMoved = !old || old.lng !== round6(point.lng) || old.lat !== round6(point.lat);
    if (pinMoved) {
      const match = await findAdminAreaForPoint(trx, row.country_code, point);
      if (!match) {
        errors.point = "out_of_area";
      } else {
        // Every listing is public as an approximate area (milestone 6 decision): the public point is
        // computed once per pin move and stored (SPEC §4.3), never per request.
        const display = computeDisplayPoint(point);
        Object.assign(update, {
          admin_area_id: match.areaId,
          needs_location_review: match.needsLocationReview,
          location_precision: "approximate",
          point: trx.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [point.lng, point.lat]),
          display_point: trx.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [display.lng, display.lat]),
        });
      }
    }
  }

  const fields = await getCountryAddressFields(trx, row.country_code);
  if (data.address) {
    const typed = fields.filter((f) => f.kind === "text" || f.kind === "number");
    const schema = buildAddressSchema(typed).partial();
    const next: Record<string, string> = { ...(row.address ?? {}) };
    for (const [key, raw] of Object.entries(data.address)) {
      if (!typed.some((f) => f.field_key === key)) {
        errors[`address.${key}`] = "unknown";
        continue;
      }
      if (!raw.trim()) {
        delete next[key];
        continue;
      }
      const parsed = schema.safeParse({ [key]: raw });
      if (parsed.success) next[key] = (parsed.data as Record<string, string>)[key]!;
      else errors[`address.${key}`] = "invalid";
    }
    update.address = JSON.stringify(next);
  }

  if (data.identifiers) {
    const schemes = await identifierSchemes(trx, fields);
    for (const [key, input] of Object.entries(data.identifiers)) {
      const scheme = schemes.get(key);
      if (!scheme) {
        errors[`identifiers.${key}`] = "unknown";
        continue;
      }
      const empty = typeof input === "string" ? !input.trim() : Object.values(input).every((v) => !v?.trim());
      if (empty) {
        await trx("property_identifiers").where({ property_id: row.id, scheme: key }).delete();
        continue;
      }
      try {
        const n = normalizeIdentifier(scheme, input as IdentifierInput, row.category);
        await trx("property_identifiers")
          .insert({ property_id: row.id, country_code: row.country_code, scheme: key, value: n.value, value_normalized: n.value_normalized })
          .onConflict(["property_id", "scheme"])
          .merge({ value: n.value, value_normalized: n.value_normalized, verified_by: null, verified_at: null });
      } catch (error) {
        if (!(error instanceof IdentifierError)) throw error;
        errors[`identifiers.${key}${error.part ? `.${error.part}` : ""}`] = error.code;
      }
    }
  }

  if (Object.keys(update).length) await trx("properties").where({ id: row.id }).update(update);
}

async function saveDetails(trx: Knex, row: DraftRow, data: DetailsStep, errors: FieldErrors) {
  const country = await getCountrySubmissionInfo(trx, row.country_code);
  const update: Record<string, unknown> = {};
  if (data.price !== undefined) {
    if (data.price !== null && country && !hasAtMostDecimals(data.price, country.currencyDecimals)) errors.price = "decimals";
    else update.price = data.price;
  }
  const map: Array<[keyof DetailsStep, string]> = [
    ["areaSqm", "area_sqm"],
    ["bedrooms", "bedrooms"],
    ["bathrooms", "bathrooms"],
    ["floors", "floors"],
    ["floorNumber", "floor_number"],
    ["ageYears", "age_years"],
    ["parking", "parking"],
    ["garden", "garden"],
    ["pool", "pool"],
    ["elevator", "elevator"],
    ["furnished", "furnished"],
  ];
  for (const [key, column] of map) if (data[key] !== undefined) update[column] = data[key];
  if (data.amenities !== undefined) update.amenities = [...new Set(data.amenities)];
  const text: Array<[keyof DetailsStep, string]> = [
    ["titleAr", "title_ar"],
    ["titleEn", "title_en"],
    ["descriptionAr", "description_ar"],
    ["descriptionEn", "description_en"],
  ];
  for (const [key, column] of text) {
    const v = data[key];
    if (v !== undefined) update[column] = typeof v === "string" && v.trim() ? v.trim() : null;
  }
  if (Object.keys(update).length) await trx("properties").where({ id: row.id }).update(update);
}

// ── Photos ──────────────────────────────────────────────────────────────────

/** Processes and stores one photo for a draft (≤ 20 per listing). */
export async function addImage(deps: SubmissionDeps, user: Lister, id: number, file: Buffer): Promise<DraftView["images"][number]> {
  assertLister(user);
  // Cheap checks first, so a refused upload costs no image processing.
  await ownedDraft(deps.db, user, id);
  const existing = await deps.db("property_images").where({ property_id: id }).count({ n: "*" }).first();
  if (Number(existing?.n ?? 0) >= MAX_PHOTOS) throw new SubmissionError("too_many_photos");

  const image = await processImage(file);
  const base = `listings/${id}/${randomUUID()}`;
  const url = await deps.storage.put(`${base}.webp`, image.full.data, "image/webp");
  let thumbUrl: string | null = null;
  try {
    thumbUrl = await deps.storage.put(`${base}-thumb.webp`, image.thumb.data, "image/webp");
    return await deps.db.transaction(async (trx) => {
      await ownedDraft(trx, user, id, true); // serializes uploads for this listing
      const r = await trx("property_images").where({ property_id: id }).count({ n: "*" }).max({ m: "order_index" }).first();
      if (Number(r?.n ?? 0) >= MAX_PHOTOS) throw new SubmissionError("too_many_photos");
      const order = r?.m === null || r?.m === undefined ? 0 : Number(r.m) + 1;
      const [row] = await trx("property_images")
        .insert({ property_id: id, url, thumbnail_url: thumbUrl, width: image.full.width, height: image.full.height, order_index: order })
        .returning(["id"]);
      await trx("properties").where({ id }).update({ updated_at: trx.fn.now() });
      return { id: row.id as number, url, thumbnailUrl: thumbUrl!, width: image.full.width, height: image.full.height };
    });
  } catch (error) {
    await deps.storage.deleteUrl(url);
    if (thumbUrl) await deps.storage.deleteUrl(thumbUrl);
    throw error;
  }
}

/** Removes a photo; the rest close up (the first stays the cover). */
export async function deleteImage(deps: SubmissionDeps, user: Lister, id: number, imageId: number): Promise<void> {
  assertLister(user);
  const removed = await deps.db.transaction(async (trx) => {
    await ownedDraft(trx, user, id, true);
    const img = await trx("property_images").where({ id: imageId, property_id: id }).first("url", "thumbnail_url");
    if (!img) throw new SubmissionError("not_found");
    await trx("property_images").where({ id: imageId }).delete();
    const rest = await trx("property_images").where({ property_id: id }).orderBy("order_index").pluck("id");
    await renumber(trx, rest as number[]);
    return img as { url: string; thumbnail_url: string };
  });
  await deps.storage.deleteUrl(removed.url);
  await deps.storage.deleteUrl(removed.thumbnail_url);
}

/** Sets the photo order: `ids` must be exactly the draft's photos; the first is the cover. */
export async function reorderImages(deps: SubmissionDeps, user: Lister, id: number, ids: number[]): Promise<void> {
  assertLister(user);
  await deps.db.transaction(async (trx) => {
    await ownedDraft(trx, user, id, true);
    const current = (await trx("property_images").where({ property_id: id }).pluck("id")) as number[];
    const same = ids.length === current.length && new Set(ids).size === ids.length && ids.every((i) => current.includes(i));
    if (!same) throw new SubmissionError("invalid_order");
    await renumber(trx, ids);
  });
}

/** order_index 0..n-1 in the given order (the unique constraint is deferred, so swaps are fine). */
async function renumber(trx: Knex, ids: number[]) {
  for (const [i, imageId] of ids.entries()) await trx("property_images").where({ id: imageId }).update({ order_index: i });
}

/** Deletes a draft with its photos and identifiers. */
export async function deleteDraft(deps: SubmissionDeps, user: Lister, id: number): Promise<void> {
  assertLister(user);
  const files = await deps.db.transaction(async (trx) => {
    await ownedDraft(trx, user, id, true);
    const imgs = (await trx("property_images").where({ property_id: id }).select("url", "thumbnail_url")) as Array<{ url: string; thumbnail_url: string }>;
    await trx("price_history").where({ property_id: id }).delete();
    await trx("properties").where({ id }).delete(); // images and identifiers cascade
    return imgs.flatMap((i) => [i.url, i.thumbnail_url]);
  });
  for (const url of files) await deps.storage.deleteUrl(url);
}

// ── Review and submit ───────────────────────────────────────────────────────

export async function getRequirements(db: Knex, countryCode: string): Promise<SubmitRequirements> {
  const fields = await getCountryAddressFields(db, countryCode);
  return {
    requiredAddress: fields.filter((f) => (f.kind === "text" || f.kind === "number") && f.is_required).map((f) => f.field_key),
    requiredIdentifiers: fields.filter((f) => f.kind === "identifier" && f.is_required).map((f) => f.field_key),
  };
}

/** The lister's profile phone, masked (never the number itself), or null if they have none. */
export async function maskedProfilePhone(deps: SubmissionDeps, user: Lister, country: CountrySubmissionInfo): Promise<string | null> {
  const row = await deps.db("users").where({ id: user.id }).first("phone_encrypted");
  if (!row?.phone_encrypted) return null;
  return maskPhone(decrypt(row.phone_encrypted, deps.phoneSecrets().encryptionKey), country.phonePrefix);
}

/** Slug from category, type and the area's English slug (never the title, so no personal data in URLs). */
function slugFor(category: Category, type: ListingType, areaSlug: string | undefined): string {
  return [category, type, areaSlug].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Submits a draft → `pending` (SPEC §7, §19). In one transaction: the
 * lister's row is locked (submission rate), the draft is re-validated in full, the
 * phone is stored encrypted, the payer type and the accepted terms are recorded.
 */
export async function submitDraft(deps: SubmissionDeps, user: Lister, id: number, input: SubmitInput): Promise<void> {
  assertLister(user);
  if (input.termsVersion !== COMMISSION_TERMS_VERSION) throw new SubmissionError("terms_outdated");
  const now = deps.now?.() ?? new Date();
  const perDay = deps.submissionsPerDay ?? DEFAULT_SUBMISSIONS_PER_DAY;

  await deps.db.transaction(async (trx) => {
    const userRow = await trx("users").where({ id: user.id }).forUpdate().first("id", "role", "phone_encrypted", "phone_hash");
    if (!userRow) throw new SubmissionError("forbidden");
    const row = await ownedDraft(trx, user, id, true);
    // Per-user submission rate (the user row lock above serializes concurrent submits).
    const recent = await recentSubmissions(trx, user.id, now);
    if (recent.count >= perDay) {
      const freeAt = (recent.oldest?.getTime() ?? now.getTime()) + DAY_MS;
      throw new SubmissionError("submission_rate_limited", undefined, Math.max(1, Math.ceil((freeAt - now.getTime()) / 1000)));
    }

    const view = await buildView(trx, row);
    const req = await getRequirements(trx, row.country_code);
    const missing = missingForSubmit(view, req);

    // Saved values must still be valid for the current category and settings.
    const fields = await getCountryAddressFields(trx, row.country_code);
    const typed = fields.filter((f) => f.kind === "text" || f.kind === "number");
    const addressCheck = buildAddressSchema(typed).safeParse(view.address);
    if (!addressCheck.success) for (const issue of addressCheck.error.issues) missing.push({ step: "location", field: `address.${String(issue.path[0] ?? "")}` });
    const schemes = await identifierSchemes(trx, fields);
    for (const [key, value] of Object.entries(view.identifiers)) {
      const scheme = schemes.get(key);
      try {
        if (scheme) normalizeIdentifier(scheme, value, row.category);
      } catch {
        missing.push({ step: "location", field: `identifiers.${key}` });
      }
    }
    if (view.location.point && !view.location.areaPath.length) missing.push({ step: "location", field: "point" });
    if (missing.length) throw new SubmissionError("incomplete", missing);

    let phone: { encrypted: string; hash: string };
    if (input.phone) {
      try {
        phone = protectPhone(normalizePhone(input.phone, row.country_code), row.country_code, deps.phoneSecrets());
      } catch {
        throw new SubmissionError("phone_invalid");
      }
    } else if (userRow.phone_encrypted && userRow.phone_hash) {
      phone = { encrypted: userRow.phone_encrypted, hash: userRow.phone_hash };
    } else {
      throw new SubmissionError("phone_required");
    }

    const areaSlug = row.admin_area_id ? (await trx("admin_areas").where({ id: row.admin_area_id }).first("slug"))?.slug : undefined;
    const payer: CommissionPayerType = user.role === "agent" ? "agent" : "owner";
    await trx("properties")
      .where({ id })
      .update({
        status: "pending",
        owner_phone_encrypted: phone.encrypted,
        owner_phone_hash: phone.hash,
        commission_payer_type: payer,
        commission_terms_version: input.termsVersion,
        commission_terms_accepted_at: now,
        slug: slugFor(row.category, row.listing_type, areaSlug),
      });
    // Price history is written from phase 1 on (SPEC §12).
    const priced = await trx("properties").where({ id }).first("price", "currency");
    await trx("price_history").insert({ property_id: id, price: priced.price, currency: priced.currency, changed_by: user.id, changed_at: now });
  });
}
