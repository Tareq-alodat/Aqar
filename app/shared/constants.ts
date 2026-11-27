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

/** Owners may have at most this many active listings (pending + published + reserved), SPEC §3. */
export const OWNER_ACTIVE_LISTING_LIMIT = 5;
export const OWNER_ACTIVE_STATUSES = ["pending", "published", "reserved"] as const satisfies readonly ListingStatus[];

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
