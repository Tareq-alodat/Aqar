import type { Knex } from "knex";
import {
  AMENITY_TAGS,
  PUBLIC_DETAIL_STATUSES,
  type AmenityTag,
  type Category,
  type Furnished,
  type ListingStatus,
  type ListingType,
  type LocationPrecision,
  type RentPeriod,
  type Role,
} from "../../app/shared/constants";
import type { BBox } from "../../app/shared/geo";
import type { Locale } from "../../app/shared/locales";
import { publicAddress, type CountryAddressField } from "../../app/shared/schemas/address";
import { resolveContactNumber, type ContactNumber } from "./contactService";
import { selectCards, toCard, type CardRow, type ListingCard } from "./searchService";

/**
 * Listing detail (SPEC §10). One public serializer for the page loader and
 * GET /api/v1/listings/:id, with an explicit field list (CLAUDE.md rules 1–2):
 * never the owner's phone, the true `point`, property identifiers, the
 * owner's email, or address fields the listing's precision does not allow.
 */

export interface Viewer {
  userId: number;
  role: Role;
}

export interface AreaCrumb {
  id: number;
  level: string;
  name: string;
  bbox: BBox;
}

export interface ListingDetail {
  id: number;
  slug: string | null;
  status: ListingStatus;
  title: string;
  description: string | null;
  category: Category;
  listingType: ListingType;
  rentPeriod: RentPeriod | null;
  price: number | null;
  currency: string;
  currencyDecimals: number;
  pricePerSqm: number | null;
  areaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  floorNumber: number | null;
  ageYears: number | null;
  furnished: Furnished | null;
  features: { parking: boolean; garden: boolean; pool: boolean; elevator: boolean };
  amenities: AmenityTag[];
  isFeatured: boolean;
  viewCount: number;
  publishedAt: string | null;
  /** The public point only (display_point); `approximate` → shown as a circle. */
  location: { lng: number; lat: number; precision: LocationPrecision } | null;
  areaPath: AreaCrumb[];
  /** Typed address fields allowed for this listing (§4.3), labelled in `locale`. */
  address: Array<{ key: string; label: string; value: string }>;
  images: Array<{ url: string; thumbnailUrl: string; width: number; height: number }>;
  owner: {
    /** Agents: full name. Individuals (owners, admins): first name only — see publicOwnerName. */
    name: string;
    role: Role;
    memberSince: string;
    company: { name: string; logoUrl: string | null; verified: boolean } | null;
  };
  /** Proxy number; only while the listing is open to enquiries (`published`, `reserved`). */
  contact: ContactNumber | null;
}

/**
 * Name shown publicly for the person behind a listing (milestone 5 review):
 * agents act professionally and keep their full name (with their company);
 * individuals — every other role — show only their first name, never the
 * full name.
 */
export function publicOwnerName(fullName: string, role: Role): string {
  const name = fullName.trim();
  if (role === "agent") return name;
  return name.split(/\s+/u)[0] ?? "";
}

export type DetailAccess = "public" | "preview";

interface DetailRow {
  id: number;
  owner_id: number;
  country_code: string;
  admin_area_id: number | null;
  slug: string | null;
  status: ListingStatus;
  title_ar: string | null;
  title_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  category: Category;
  listing_type: ListingType;
  rent_period: RentPeriod | null;
  price: string | null;
  currency: string;
  currency_decimals: number;
  area_sqm: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  floor_number: number | null;
  age_years: number | null;
  furnished: Furnished | null;
  parking: boolean;
  garden: boolean;
  pool: boolean;
  elevator: boolean;
  amenities: string[];
  is_featured: boolean;
  view_count: number;
  published_at: Date | null;
  location_precision: LocationPrecision;
  address: Record<string, unknown>;
  lng: number | null;
  lat: number | null;
  owner_name: string;
  owner_role: Role;
  owner_since: Date;
  company_name_ar: string | null;
  company_name_en: string | null;
  company_logo: string | null;
  company_verified: boolean | null;
}

const num = (v: string | number | null) => (v === null ? null : Number(v));
export const isPublicStatus = (s: ListingStatus) => (PUBLIC_DETAIL_STATUSES as readonly string[]).includes(s);
const hasContact = (s: ListingStatus) => s === "published" || s === "reserved";

async function addressFields(db: Knex, countryCode: string): Promise<CountryAddressField[]> {
  return db("country_address_fields as c")
    .join("address_fields as f", "f.key", "c.field_key")
    .where({ "c.country_code": countryCode, "c.is_active": true })
    .orderBy("c.position")
    .select("c.field_key", "f.kind", "f.label_ar", "f.label_en", "f.pattern", "c.position", "c.is_required", "c.visibility");
}

async function areaPath(db: Knex, areaId: number | null, locale: Locale): Promise<AreaCrumb[]> {
  if (areaId === null) return [];
  const r = await db.raw<{ rows: Array<{ id: number; level: string; name_ar: string; name_en: string; b: number[] }> }>(
    `WITH RECURSIVE path AS (
       SELECT id, parent_id, level, name_ar, name_en, boundary, 0 AS depth FROM admin_areas WHERE id = ?
       UNION ALL
       SELECT a.id, a.parent_id, a.level, a.name_ar, a.name_en, a.boundary, p.depth + 1
         FROM admin_areas a JOIN path p ON a.id = p.parent_id
     )
     SELECT id, level, name_ar, name_en,
            ARRAY[ST_XMin(boundary::geometry), ST_YMin(boundary::geometry), ST_XMax(boundary::geometry), ST_YMax(boundary::geometry)] AS b
       FROM path ORDER BY depth DESC`,
    [areaId],
  );
  return r.rows.map((a) => ({
    id: a.id,
    level: a.level,
    name: locale === "ar" ? a.name_ar : a.name_en,
    bbox: a.b.map((v) => Number(Number(v).toFixed(5))) as BBox,
  }));
}

/**
 * The listing as `viewer` may see it, or null (→ 404).
 * Public: published, reserved, sold, rented. Owner and admins also get a
 * "preview" of their own unpublished listings. Contact only while published
 * or reserved (sold/rented listings show no number).
 */
export async function getListingDetail(
  db: Knex,
  id: number,
  viewer: Viewer | null,
  locale: Locale,
): Promise<{ listing: ListingDetail; access: DetailAccess } | null> {
  const row = (await db("properties as p")
    .join("countries as c", "c.code", "p.country_code")
    .join("users as u", "u.id", "p.owner_id")
    .leftJoin("companies as co", "co.id", "u.company_id")
    .where("p.id", id)
    .first(
      "p.id",
      "p.owner_id",
      "p.country_code",
      "p.admin_area_id",
      "p.slug",
      "p.status",
      "p.title_ar",
      "p.title_en",
      "p.description_ar",
      "p.description_en",
      "p.category",
      "p.listing_type",
      "p.rent_period",
      "p.price",
      "p.currency",
      "c.currency_decimals",
      "p.area_sqm",
      "p.bedrooms",
      "p.bathrooms",
      "p.floors",
      "p.floor_number",
      "p.age_years",
      "p.furnished",
      "p.parking",
      "p.garden",
      "p.pool",
      "p.elevator",
      "p.amenities",
      "p.is_featured",
      "p.view_count",
      "p.published_at",
      "p.location_precision",
      "p.address",
      db.raw("ST_X(p.display_point::geometry) AS lng"),
      db.raw("ST_Y(p.display_point::geometry) AS lat"),
      "u.name as owner_name",
      "u.role as owner_role",
      "u.created_at as owner_since",
      "co.name_ar as company_name_ar",
      "co.name_en as company_name_en",
      "co.logo_url as company_logo",
      "co.is_verified as company_verified",
    )) as DetailRow | undefined;
  if (!row) return null;

  const canPreview = viewer !== null && (viewer.userId === row.owner_id || viewer.role === "admin");
  let access: DetailAccess;
  if (isPublicStatus(row.status)) access = "public";
  else if (canPreview) access = "preview";
  else return null;

  const pick = (ar: string | null, en: string | null) => (locale === "ar" ? (ar ?? en) : (en ?? ar));
  const [fields, path, images, contact] = await Promise.all([
    addressFields(db, row.country_code),
    areaPath(db, row.admin_area_id, locale),
    db("property_images").where({ property_id: row.id }).orderBy("order_index").select("url", "thumbnail_url", "width", "height"),
    hasContact(row.status)
      ? resolveContactNumber(db, { id: row.id, adminAreaId: row.admin_area_id, countryCode: row.country_code })
      : Promise.resolve(null),
  ]);
  const visible = publicAddress(fields, row.address ?? {}, row.location_precision);
  const price = num(row.price);
  const areaSqm = num(row.area_sqm);

  return {
    access,
    listing: {
      id: row.id,
      slug: row.slug,
      status: row.status,
      title: pick(row.title_ar, row.title_en) ?? "",
      description: pick(row.description_ar, row.description_en),
      category: row.category,
      listingType: row.listing_type,
      rentPeriod: row.rent_period,
      price,
      currency: row.currency.trim(),
      currencyDecimals: row.currency_decimals,
      pricePerSqm: price !== null && areaSqm ? price / areaSqm : null,
      areaSqm,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      floors: row.floors,
      floorNumber: row.floor_number,
      ageYears: row.age_years,
      furnished: row.furnished,
      features: { parking: row.parking, garden: row.garden, pool: row.pool, elevator: row.elevator },
      amenities: (row.amenities ?? []).filter((a): a is AmenityTag => (AMENITY_TAGS as readonly string[]).includes(a)),
      isFeatured: row.is_featured,
      viewCount: row.view_count,
      publishedAt: row.published_at ? row.published_at.toISOString() : null,
      location:
        row.lng !== null && row.lat !== null
          ? { lng: Number(Number(row.lng).toFixed(6)), lat: Number(Number(row.lat).toFixed(6)), precision: row.location_precision }
          : null,
      areaPath: path,
      address: fields
        .filter((f) => visible[f.field_key] !== undefined)
        .map((f) => ({ key: f.field_key, label: locale === "ar" ? f.label_ar : f.label_en, value: visible[f.field_key]! })),
      images: images.map((i) => ({ url: i.url, thumbnailUrl: i.thumbnail_url, width: i.width, height: i.height })),
      owner: {
        name: publicOwnerName(row.owner_name, row.owner_role),
        role: row.owner_role,
        memberSince: row.owner_since.toISOString(),
        company:
          row.owner_role === "agent" && (row.company_name_ar || row.company_name_en)
            ? {
                name: pick(row.company_name_ar, row.company_name_en) ?? "",
                logoUrl: row.company_logo,
                verified: Boolean(row.company_verified),
              }
            : null,
      },
      contact,
    },
  };
}

export const SIMILAR_COUNT = 4;
export const SIMILAR_RADIUS_M = 5000;

/**
 * Similar listings (SPEC §10): same category and type, published only, nearest
 * SIMILAR_COUNT within 5 km; any remaining places filled from the same city,
 * newest first.
 */
export async function similarListings(db: Knex, id: number, locale: Locale): Promise<ListingCard[]> {
  const self = await db("properties").where({ id }).first("id", "category", "listing_type", "country_code", "admin_area_id");
  if (!self) return [];
  const base = () =>
    db("properties as p")
      .where({ "p.status": "published", "p.category": self.category, "p.listing_type": self.listing_type, "p.country_code": self.country_code })
      .whereNot("p.id", id);

  const nearby: CardRow[] = await selectCards(db, base())
    .whereRaw("ST_DWithin(p.display_point, (SELECT display_point FROM properties WHERE id = ?), ?)", [id, SIMILAR_RADIUS_M])
    .orderByRaw("ST_Distance(p.display_point, (SELECT display_point FROM properties WHERE id = ?)), p.id", [id])
    .limit(SIMILAR_COUNT);

  let fill: CardRow[] = [];
  if (nearby.length < SIMILAR_COUNT && self.admin_area_id) {
    const city = await db.raw<{ rows: Array<{ id: number }> }>(
      `WITH RECURSIVE up AS (
         SELECT id, parent_id, level FROM admin_areas WHERE id = ?
         UNION ALL SELECT a.id, a.parent_id, a.level FROM admin_areas a JOIN up ON a.id = up.parent_id
       ) SELECT id FROM up WHERE level = 'city' LIMIT 1`,
      [self.admin_area_id],
    );
    const cityId = city.rows[0]?.id;
    if (cityId) {
      fill = await selectCards(db, base())
        .whereNotIn("p.id", nearby.map((n) => n.id))
        .whereRaw(
          `p.admin_area_id IN (WITH RECURSIVE d AS (
             SELECT id FROM admin_areas WHERE id = ?
             UNION ALL SELECT a.id FROM admin_areas a JOIN d ON a.parent_id = d.id
           ) SELECT id FROM d)`,
          [cityId],
        )
        .orderBy([
          { column: "p.published_at", order: "desc" },
          { column: "p.id", order: "desc" },
        ])
        .limit(SIMILAR_COUNT - nearby.length);
    }
  }
  return [...nearby, ...fill].map((r) => toCard(r, locale));
}

/** Whether the user saved the listing (favourite). */
export async function isSaved(db: Knex, userId: number, propertyId: number): Promise<boolean> {
  return Boolean(await db("saved_properties").where({ user_id: userId, property_id: propertyId }).first("id"));
}

/** Save (favourite) a publicly visible listing; false when it is not public. */
export async function saveListing(db: Knex, userId: number, propertyId: number): Promise<boolean> {
  const p = await db("properties").where({ id: propertyId }).first("status");
  if (!p || !isPublicStatus(p.status)) return false;
  await db("saved_properties").insert({ user_id: userId, property_id: propertyId }).onConflict(["user_id", "property_id"]).ignore();
  return true;
}

export async function unsaveListing(db: Knex, userId: number, propertyId: number): Promise<void> {
  await db("saved_properties").where({ user_id: userId, property_id: propertyId }).delete();
}
