/**
 * Value lists shared by client and server. The database enforces the same lists
 * with CHECK constraints (server/db/migrations); `server/db/constants.db.test.ts`
 * fails if they drift apart.
 */

/** SPEC §4.2 — use these exact values everywhere (CLAUDE.md rule 4). */
export const LISTING_STATUSES = ["draft", "pending", "published", "rejected", "reserved", "sold", "rented", "archived"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const CATEGORIES = ["house", "apartment", "land", "villa", "commercial"] as const;
export type Category = (typeof CATEGORIES)[number];

export const LISTING_TYPES = ["sale", "rent", "exchange"] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

export const RENT_PERIODS = ["monthly", "yearly"] as const;
export type RentPeriod = (typeof RENT_PERIODS)[number];

export const FURNISHED_OPTIONS = ["yes", "no", "partial"] as const;
export type Furnished = (typeof FURNISHED_OPTIONS)[number];

/**
 * The column keeps both values, but every listing is shown publicly as an
 * approximate area (milestone 6 decision, SPEC §4.3): the database only
 * accepts `approximate`, and the true pin is never public.
 */
export const LOCATION_PRECISIONS = ["exact", "approximate"] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

export const OFFERS_VISIBILITIES = ["public", "amounts_only", "private"] as const;
export type OffersVisibility = (typeof OFFERS_VISIBILITIES)[number];

export const ROLES = ["admin", "agent", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ["active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** SPEC §2.3 */
export const ADDRESS_FIELD_KINDS = ["admin_area", "text", "number", "identifier"] as const;
export type AddressFieldKind = (typeof ADDRESS_FIELD_KINDS)[number];

export const ADDRESS_VISIBILITIES = ["public", "exact_only", "admin_only"] as const;
export type AddressVisibility = (typeof ADDRESS_VISIBILITIES)[number];

/** SPEC §2.2 */
export const BOUNDARY_SOURCES = ["osm", "generated", "manual"] as const;
export type BoundarySource = (typeof BOUNDARY_SOURCES)[number];

/** SPEC §8 */
export const CONTACT_SCOPES = ["global", "country", "admin_area", "property"] as const;
export type ContactScope = (typeof CONTACT_SCOPES)[number];

/**
 * Listers have no limit on active listings (milestone 6 decision); instead each
 * user may submit at most this many listings per rolling 24 h (default of
 * `SUBMISSIONS_PER_DAY`, SPEC §7, §13).
 */
export const DEFAULT_SUBMISSIONS_PER_DAY = 10;

/** Fixed amenity tags for `properties.amenities` (SPEC §4.1); labels in i18n `listing.amenityTags.*`. */
export const AMENITY_TAGS = [
  "air_conditioning",
  "central_heating",
  "solar_heater",
  "balcony",
  "storage",
  "maid_room",
  "security",
  "view",
  "laundry_room",
  "fireplace",
] as const;
export type AmenityTag = (typeof AMENITY_TAGS)[number];

/** Statuses whose detail page is public (SPEC §10; milestone 5 decision). `published` and `reserved` show the contact box. */
export const PUBLIC_DETAIL_STATUSES = ["published", "reserved", "sold", "rented"] as const satisfies readonly ListingStatus[];

/** Who pays the commission on a concluded deal (SPEC §19): set from the submitter's role at submission. */
export const COMMISSION_PAYER_TYPES = ["agent", "owner"] as const;
export type CommissionPayerType = (typeof COMMISSION_PAYER_TYPES)[number];

/** Roles that may create listings through the submit wizard (SPEC §3, §7). */
export const LISTER_ROLES = ["owner", "agent"] as const satisfies readonly Role[];

/** Submit wizard limits (SPEC §4.4, §7). */
export const DRAFT_LIMIT = 10;
export const MAX_PHOTOS = 20;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Accepted upload formats, detected from the file's content (not its name or declared type). */
export const UPLOAD_FORMATS = ["jpeg", "png", "webp"] as const;
/** Longest edge of the stored photo and of its thumbnail (px). */
export const PHOTO_MAX_EDGE = 2000;
export const THUMB_MAX_EDGE = 400;
