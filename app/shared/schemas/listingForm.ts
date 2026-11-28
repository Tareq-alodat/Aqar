import { z } from "zod";
import {
  AMENITY_TAGS,
  CATEGORIES,
  FURNISHED_OPTIONS,
  LISTING_TYPES,
  OFFERS_VISIBILITIES,
  RENT_PERIODS,
  type AmenityTag,
  type Category,
  type Furnished,
  type ListingStatus,
  type ListingType,
  type OffersVisibility,
  type RentPeriod,
} from "../constants";

/**
 * Submit wizard (SPEC §7): one schema per step, shared by the page and
 * /api/v1/my/listings. Drafts may be incomplete; `missingForSubmit` lists what
 * is still needed before a draft can be submitted.
 */

export const WIZARD_STEPS = ["type", "location", "details", "photos", "review"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
export const wizardStepSchema = z.enum(WIZARD_STEPS);

const count = (max: number) => z.number().int().min(0).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Step 1 — also the body that creates a draft. */
export const typeStepSchema = z
  .object({
    category: z.enum(CATEGORIES),
    listingType: z.enum(LISTING_TYPES),
    rentPeriod: z.enum(RENT_PERIODS).nullable(),
  })
  .strict()
  .refine((v) => (v.listingType === "rent") === (v.rentPeriod !== null), { path: ["rentPeriod"], message: "rent_period" });
export type TypeStep = z.infer<typeof typeStepSchema>;

export const lngLatSchema = z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).strict();
export type LngLat = z.infer<typeof lngLatSchema>;

/** A multi-part identifier as typed (`{ partKey: value }`) or a single-part one. */
export const identifierInputSchema = z.union([z.string().max(100), z.record(z.string().max(40), z.string().max(100))]);

/** Step 2. Address keys and identifier schemes are checked against the country's settings on the server. */
export const locationStepSchema = z
  .object({
    point: lngLatSchema.nullable().optional(),
    address: z.record(z.string().max(64), z.string().max(200)).optional(),
    identifiers: z.record(z.string().max(64), identifierInputSchema).optional(),
  })
  .strict();
export type LocationStep = z.infer<typeof locationStepSchema>;

/** Step 3. Price decimals are checked against the country's currency on the server. */
export const detailsStepSchema = z
  .object({
    price: z.number().min(0).max(100_000_000_000).nullable().optional(),
    areaSqm: z.number().positive().max(100_000_000).nullable().optional(),
    bedrooms: count(50).nullable().optional(),
    bathrooms: count(50).nullable().optional(),
    floors: count(200).nullable().optional(),
    floorNumber: z.number().int().min(-5).max(200).nullable().optional(),
    ageYears: count(300).nullable().optional(),
    parking: z.boolean().optional(),
    garden: z.boolean().optional(),
    pool: z.boolean().optional(),
    elevator: z.boolean().optional(),
    furnished: z.enum(FURNISHED_OPTIONS).nullable().optional(),
    amenities: z.array(z.enum(AMENITY_TAGS)).max(AMENITY_TAGS.length).optional(),
    titleAr: optionalText(120),
    titleEn: optionalText(120),
    descriptionAr: optionalText(5000),
    descriptionEn: optionalText(5000),
  })
  .strict();
export type DetailsStep = z.infer<typeof detailsStepSchema>;

/** Step 5 settings saved with the draft (the phone and the terms are only sent with the submit). */
export const reviewStepSchema = z.object({ offersVisibility: z.enum(OFFERS_VISIBILITIES).optional() }).strict();

/** PATCH /api/v1/my/listings/:id */
export const saveStepSchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("type"), data: typeStepSchema }).strict(),
  z.object({ step: z.literal("location"), data: locationStepSchema }).strict(),
  z.object({ step: z.literal("details"), data: detailsStepSchema }).strict(),
  z.object({ step: z.literal("review"), data: reviewStepSchema }).strict(),
]);
export type SaveStep = z.infer<typeof saveStepSchema>;

/** POST /api/v1/my/listings/:id/submit. `phone` only when the lister types a different number than their profile's. */
export const submitSchema = z
  .object({
    acceptTerms: z.literal(true),
    termsVersion: z.string().min(1).max(40),
    phone: z.string().trim().min(1).max(40).optional(),
  })
  .strict();
export type SubmitInput = z.infer<typeof submitSchema>;

/** PUT /api/v1/my/listings/:id/images/order */
export const reorderSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(20) }).strict();

/** The draft as its owner sees it in the wizard (private, no-store). Includes the true pin (CLAUDE.md rule 2 exception). */
export interface DraftView {
  id: number;
  status: ListingStatus;
  countryCode: string;
  category: Category;
  listingType: ListingType;
  rentPeriod: RentPeriod | null;
  location: {
    point: LngLat | null;
    /** What the public sees: an approximate area around this point (stored when the pin moves). */
    displayPoint: LngLat | null;
    areaPath: Array<{ id: number; level: string; nameAr: string; nameEn: string }>;
    needsReview: boolean;
  };
  address: Record<string, string>;
  /** Saved identifiers, split back into their parts for multi-part schemes. */
  identifiers: Record<string, string | Record<string, string>>;
  details: {
    price: number | null;
    areaSqm: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    floors: number | null;
    floorNumber: number | null;
    ageYears: number | null;
    parking: boolean;
    garden: boolean;
    pool: boolean;
    elevator: boolean;
    furnished: Furnished | null;
    amenities: AmenityTag[];
    titleAr: string | null;
    titleEn: string | null;
    descriptionAr: string | null;
    descriptionEn: string | null;
  };
  offersVisibility: OffersVisibility;
  images: Array<{ id: number; url: string; thumbnailUrl: string; width: number; height: number }>;
  slug: string | null;
  updatedAt: string;
}

export interface MissingField {
  step: WizardStep;
  field: string;
}

/** What the country requires (from its address settings). */
export interface SubmitRequirements {
  requiredAddress: string[];
  requiredIdentifiers: string[];
}

/** Photos are required except for land (milestone 6 decision; SPEC §4.4). */
export const photosRequired = (category: Category) => category !== "land";

/** Fields still needed before the draft can be submitted (the phone and the terms are checked at submit). */
export function missingForSubmit(d: DraftView, req: SubmitRequirements): MissingField[] {
  const missing: MissingField[] = [];
  if (!d.location.point) missing.push({ step: "location", field: "point" });
  for (const key of req.requiredAddress) if (!d.address[key]?.trim()) missing.push({ step: "location", field: `address.${key}` });
  for (const key of req.requiredIdentifiers) if (!d.identifiers[key]) missing.push({ step: "location", field: `identifiers.${key}` });
  if (d.listingType !== "exchange" && d.details.price === null) missing.push({ step: "details", field: "price" });
  if (!d.details.titleAr?.trim() && !d.details.titleEn?.trim()) missing.push({ step: "details", field: "title" });
  if (photosRequired(d.category) && d.images.length === 0) missing.push({ step: "photos", field: "images" });
  return missing;
}

/** Whether `value` has at most `decimals` decimal places (the country's currency). */
export function hasAtMostDecimals(value: number, decimals: number): boolean {
  const scaled = value * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}
