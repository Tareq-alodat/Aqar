import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Knex } from "knex";
import { AMENITY_TAGS, type Category, type ListingStatus, type ListingType, type LocationPrecision } from "../../../app/shared/constants";
import { env, requireSecrets } from "../../env";
import { protectPhone } from "../../services/cryptoService";
import { getIdentifierScheme, normalizeIdentifier, type IdentifierInput } from "../../services/identifierService";
import { computeDisplayPoint, findAdminAreaForPoint, type LngLat } from "../../services/locationService";
import { hashPassword } from "../../services/passwordService";
import { importBoundaries } from "../boundaries/importBoundaries";

/**
 * Development data (SPEC §17). Refuses to run in production. Re-running
 * replaces all users, companies, listings and related rows; boundaries are
 * re-imported (an upsert), and reference data from migrations is untouched.
 * Deterministic: the same data every run.
 */

/** Dev-only password for every seeded account. */
export const DEV_PASSWORD = "aqar-dev-password";

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hue per category for the generated placeholder photos. */
const PLACEHOLDER_HUE: Record<Category, number> = { apartment: 210, villa: 150, house: 30, land: 90, commercial: 280 };

/**
 * Writes a placeholder "photo" (SVG, generated here — nothing is downloaded)
 * to UPLOAD_DIR/seed and returns its public URL (/uploads/seed/…).
 */
async function writePlaceholder(propertyId: number, n: number, category: Category): Promise<string> {
  const dir = path.resolve(env.UPLOAD_DIR, "seed");
  await mkdir(dir, { recursive: true });
  const hue = (PLACEHOLDER_HUE[category] + n * 23) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue},45%,38%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},40%,18%)"/>
</linearGradient></defs>
<rect width="1200" height="800" fill="url(#g)"/>
<path d="M420 520V360l180-130 180 130v160z" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="14" stroke-linejoin="round"/>
<rect x="560" y="420" width="80" height="100" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="14"/>
<text x="600" y="640" font-family="sans-serif" font-size="44" fill="rgba(255,255,255,.75)" text-anchor="middle">${category} · ${propertyId} · ${n + 1}</text>
</svg>`;
  const file = `${propertyId}-${n + 1}.svg`;
  await writeFile(path.join(dir, file), svg, "utf8");
  return `/uploads/seed/${file}`;
}

interface AreaRow {
  id: number;
  name_ar: string;
  name_en: string;
  level: string;
}

interface ListingPlan {
  owner: number;
  area: AreaRow;
  category: Category;
  type: ListingType;
  status: ListingStatus;
  precision: LocationPrecision;
  point?: LngLat;
}

const CATEGORY_NAMES: Record<Category, [string, string]> = {
  apartment: ["شقة", "Apartment"],
  villa: ["فيلا", "Villa"],
  house: ["بيت", "House"],
  land: ["أرض", "Land"],
  commercial: ["محل تجاري", "Commercial unit"],
};
const TYPE_NAMES: Record<ListingType, [string, string]> = {
  sale: ["للبيع", "for sale"],
  rent: ["للإيجار", "for rent"],
  exchange: ["للبدل", "for exchange"],
};

/** Categories of the first five listings, which carry identifiers (land, duplicate villas, same-building apartments). */
const IDENTIFIER_CATEGORIES: readonly Category[] = ["land", "villa", "villa", "apartment", "apartment"];

/** Price ranges in JOD (rent = monthly). */
const PRICE: Record<Category, { sale: [number, number]; rent: [number, number] }> = {
  apartment: { sale: [55_000, 260_000], rent: [300, 1_500] },
  villa: { sale: [320_000, 1_200_000], rent: [1_500, 6_000] },
  house: { sale: [110_000, 420_000], rent: [450, 2_000] },
  land: { sale: [40_000, 850_000], rent: [200, 1_000] },
  commercial: { sale: [150_000, 650_000], rent: [800, 5_000] },
};

export async function seed(knex: Knex): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed: NODE_ENV=production. Seed data and credentials are development-only.");
  }
  const secrets = requireSecrets();
  const random = rng(20261126);
  // Separate stream for fields added later (amenities, photos), so earlier seed data stays the same.
  const extra = rng(20261128);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const between = (min: number, max: number) => min + random() * (max - min);

  await knex.raw(
    `TRUNCATE property_views, price_history, saved_properties, property_images, property_identifiers,
              contact_numbers, properties, refresh_tokens, users, companies RESTART IDENTITY CASCADE`,
  );

  const report = await importBoundaries(knex, "JO");
  console.log(`Boundaries: ${JSON.stringify(report.byLevel)}, ${report.warnings.length} warnings`);

  // ── Companies & users ────────────────────────────────────────────────────
  const [company] = await knex("companies")
    .insert({
      name_ar: "دار الأردن العقارية",
      name_en: "Dar Al-Urdun Real Estate",
      slug: "dar-al-urdun",
      license_number: "DEV-0001",
      is_verified: true,
      verified_at: knex.fn.now(),
    })
    .returning("id");

  const passwordHash = await hashPassword(DEV_PASSWORD);
  let phoneSeq = 0;
  // Local Jordanian format (07XXXXXXXX), normalized to +9627XXXXXXXX on save.
  const phone = () => `07${String(90_000_000 + ++phoneSeq * 7_919).slice(0, 8)}`;
  const user = async (email: string, name: string, role: "admin" | "agent" | "owner", companyId: number | null = null) => {
    const p = protectPhone(phone(), "JO", secrets);
    const [row] = await knex("users")
      .insert({ email, name, role, company_id: companyId, password_hash: passwordHash, phone_encrypted: p.encrypted, phone_hash: p.hash })
      .returning("id");
    return row.id as number;
  };
  const admin = await user("admin@aqar.test", "مدير النظام", "admin");
  const agents = [
    await user("agent1@aqar.test", "سامي الخطيب", "agent", company.id),
    await user("agent2@aqar.test", "ليلى حداد", "agent", company.id),
  ];
  const owners = [
    await user("owner1@aqar.test", "أحمد العمري", "owner"),
    await user("owner2@aqar.test", "رنا يوسف", "owner"),
    await user("owner3@aqar.test", "خالد النابلسي", "owner"),
  ];

  // ── Areas ────────────────────────────────────────────────────────────────
  const areas: AreaRow[] = await knex("admin_areas").where({ country_code: "JO", is_active: true }).select("id", "name_ar", "name_en", "level");
  const findArea = (level: string, ...namesAr: string[]) => {
    const folded = namesAr.map(foldAr);
    const hit = areas.find((a) => a.level === level && folded.includes(foldAr(a.name_ar)));
    if (!hit) throw new Error(`Seed area not found: ${level} ${namesAr.join(" / ")}`);
    return hit;
  };
  const seedAreas = [
    findArea("area", "عبدون"),
    findArea("area", "خلدا"),
    findArea("area", "الصويفية"),
    findArea("area", "الجبيهة"),
    findArea("area", "دابوق"),
    findArea("area", "تلاع العلي"),
  ];
  const otherCities = [findArea("city", "إربد"), findArea("city", "الزرقاء"), findArea("city", "العقبة")];
  const amman = findArea("city", "عمان");
  const abdoun = seedAreas[0]!;

  // ── Listing plan: 40 published, 3 pending, 2 sold ───────────────────────
  const plan: ListingPlan[] = [];
  const categories: Category[] = ["apartment", "apartment", "apartment", "villa", "house", "land", "commercial"];
  const types: ListingType[] = ["sale", "sale", "rent", "rent", "sale", "exchange"];
  const location = (i: number) => (i < 30 ? seedAreas[i % seedAreas.length]! : i < 36 ? otherCities[i % 3]! : amman);
  for (let i = 0; i < 40; i++) {
    // Owners have 4 published + 1 pending each (5 active, the limit); agents have the rest.
    const owner = i < 12 ? owners[i % 3]! : agents[i % 2]!;
    // The first five get land-registry identifiers below, so their categories are fixed.
    const category = IDENTIFIER_CATEGORIES[i] ?? pick(categories);
    const type = i < IDENTIFIER_CATEGORIES.length ? "sale" : category === "land" ? pick<ListingType>(["sale", "sale", "exchange"]) : pick(types);
    plan.push({ owner, area: location(i), category, type, status: "published", precision: i % 3 === 0 ? "approximate" : "exact" });
  }
  for (let i = 0; i < 3; i++) {
    plan.push({ owner: owners[i]!, area: seedAreas[i]!, category: "apartment", type: "sale", status: "pending", precision: "exact" });
  }
  // Pending listing whose pin is outside every boundary (~1 km across the border north of Ramtha, no area centroid within
  // 5 km) → location review with no area.
  plan[42]!.point = { lng: 36.0105, lat: 32.67 };
  for (let i = 0; i < 2; i++) {
    plan.push({ owner: agents[i]!, area: seedAreas[3 + i]!, category: "apartment", type: "sale", status: "sold", precision: "exact" });
  }

  // ── Insert listings ──────────────────────────────────────────────────────
  const ids: number[] = [];
  for (const [i, p] of plan.entries()) {
    const point = p.point ?? (await randomPointIn(knex, p.area.id, 1000 + i));
    const match = await findAdminAreaForPoint(knex, "JO", point);
    const area = match ? areas.find((a) => a.id === match.areaId) : undefined;
    const display = computeDisplayPoint(point, p.precision, random);
    const [catAr, catEn] = CATEGORY_NAMES[p.category];
    const [typeAr, typeEn] = TYPE_NAMES[p.type];
    const placeAr = area?.name_ar ?? p.area.name_ar;
    const placeEn = area?.name_en ?? p.area.name_en;
    const range = p.type === "exchange" ? null : PRICE[p.category][p.type === "rent" ? "rent" : "sale"];
    const price = range ? Math.round(between(range[0], range[1]) / (p.type === "rent" ? 10 : 1000)) * (p.type === "rent" ? 10 : 1000) : null;
    const isLand = p.category === "land";
    const ownerPhone = protectPhone(phone(), "JO", secrets);
    const publishedAt = p.status === "published" || p.status === "sold" ? knex.raw(`now() - interval '${45 - i} days'`) : null;

    const [row] = await knex("properties")
      .insert({
        owner_id: p.owner,
        country_code: "JO",
        admin_area_id: match?.areaId ?? null,
        needs_location_review: match ? match.needsLocationReview : true,
        title_ar: `${catAr} ${typeAr} في ${placeAr}`,
        // A few listings are Arabic-only, to exercise the display fallback.
        title_en: i % 7 === 6 ? null : `${catEn} ${typeEn} in ${placeEn}`,
        description_ar: `${catAr} ${typeAr} في ${placeAr}. بيانات تجريبية للتطوير.`,
        description_en: i % 7 === 6 ? null : `${catEn} ${typeEn} in ${placeEn}. Development sample data.`,
        category: p.category,
        listing_type: p.type,
        rent_period: p.type === "rent" ? pick(["monthly", "monthly", "yearly"]) : null,
        price,
        area_sqm: isLand ? Math.round(between(500, 5000)) : Math.round(between(80, p.category === "villa" ? 900 : 350)),
        bedrooms: isLand || p.category === "commercial" ? null : Math.round(between(1, p.category === "villa" ? 7 : 4)),
        bathrooms: isLand ? null : Math.round(between(1, p.category === "villa" ? 6 : 3)),
        floors: p.category === "villa" || p.category === "house" ? Math.round(between(1, 3)) : null,
        floor_number: p.category === "apartment" ? Math.round(between(0, 6)) : null,
        age_years: isLand ? null : Math.round(between(0, 30)),
        parking: !isLand && random() > 0.3,
        garden: p.category === "villa" || (p.category === "house" && random() > 0.5),
        pool: p.category === "villa" && random() > 0.5,
        elevator: p.category === "apartment" && random() > 0.4,
        furnished: isLand ? null : pick(["yes", "no", "no", "partial"]),
        point: knex.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [point.lng, point.lat]),
        display_point: knex.raw("ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography", [display.lng, display.lat]),
        location_precision: p.precision,
        address: JSON.stringify(
          isLand
            ? {}
            : {
                street: `شارع ${pick(["الملكة رانيا", "زهران", "مكة", "الأمير حسن", "عبدالله غوشة"])}`,
                building_number: String(Math.round(between(1, 120))),
                // admin_only in Jordan (SPEC §2.3): never shown publicly.
                ...(p.category === "apartment" ? { apartment_number: String(1 + Math.floor(extra() * 20)) } : {}),
              },
        ),
        amenities: isLand ? [] : AMENITY_TAGS.filter(() => extra() < 0.3),
        owner_phone_encrypted: ownerPhone.encrypted,
        owner_phone_hash: ownerPhone.hash,
        status: p.status,
        is_featured: p.status === "published" && i % 9 === 0,
        view_count: p.status === "pending" ? 0 : Math.round(between(5, 900)),
        slug: `${p.category}-${p.type}-${placeEn}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        published_at: publishedAt,
      })
      .returning("id");
    ids.push(row.id);

    // Placeholder photos (generated locally as SVG) for most published/sold listings, to exercise the gallery.
    if (p.status !== "pending" && i % 4 !== 3) {
      const count = 1 + Math.floor(extra() * 5);
      for (let n = 0; n < count; n++) {
        const url = await writePlaceholder(row.id, n, p.category);
        await knex("property_images").insert({ property_id: row.id, url, thumbnail_url: url, width: 1200, height: 800, order_index: n });
      }
    }

    await knex("price_history").insert({ property_id: row.id, price, currency: "JOD", changed_by: p.owner });
    // A few published listings had a price drop.
    if (price !== null && p.status === "published" && i % 8 === 1) {
      const dropped = Math.round((price * 0.93) / 10) * 10;
      await knex("properties").where({ id: row.id }).update({ price: dropped });
      await knex("price_history").insert({ property_id: row.id, price: dropped, currency: "JOD", changed_by: p.owner });
    }
  }

  // ── Property identifiers (SPEC §2.4) ─────────────────────────────────────
  const scheme = await getIdentifierScheme(knex, "jo_land_parcel");
  if (!scheme) throw new Error("jo_land_parcel scheme missing (run migrations)");
  const addIdentifier = async (propertyId: number, category: Category, input: IdentifierInput, verified = false) => {
    const n = normalizeIdentifier(scheme, input, category);
    await knex("property_identifiers").insert({
      property_id: propertyId,
      country_code: "JO",
      scheme: scheme.key,
      ...n,
      verified_by: verified ? admin : null,
      verified_at: verified ? knex.fn.now() : null,
    });
  };
  const parcel = { directorate: "عمان الغربية", village: "وادي السير", basin: "3 أم أذينة", parcel: "0123" };
  // Verified land parcel.
  await addIdentifier(ids[0]!, "land", { directorate: "عمان الغربية", village: "خلدا", basin: "5 الرونق", parcel: "88" }, true);
  // Duplicate: same full key typed with different digits and letter forms.
  await addIdentifier(ids[1]!, "villa", parcel);
  await addIdentifier(ids[2]!, "villa", { directorate: "عمان الغربيه", village: "وادي السير", basin: "٣ ام اذينة", parcel: "١٢٣" });
  // Same building: same parcel, different apartments (not duplicates).
  const building = { directorate: "عمان الغربية", village: "عبدون", basin: "12 عبدون الشمالي", parcel: "456" };
  await addIdentifier(ids[3]!, "apartment", { ...building, apartment: "4" });
  await addIdentifier(ids[4]!, "apartment", { ...building, apartment: "7" });

  // ── Contact numbers (SPEC §8) ────────────────────────────────────────────
  await knex("contact_numbers").insert([
    { phone_number: "+96265000001", whatsapp: true, label: "Global default", scope: "global", created_by: admin },
    { phone_number: "+96265000002", whatsapp: true, label: "Jordan", scope: "country", country_code: "JO", created_by: admin },
    { phone_number: "+96265000003", whatsapp: false, label: "Amman", scope: "admin_area", admin_area_id: amman.id, created_by: admin },
    { phone_number: "+96265000004", whatsapp: true, label: "Abdoun", scope: "admin_area", admin_area_id: abdoun.id, created_by: admin },
    { phone_number: "+96265000005", whatsapp: true, label: `Listing ${ids[5]}`, scope: "property", property_id: ids[5], created_by: admin },
  ]);

  // ── Favorites ────────────────────────────────────────────────────────────
  await knex("saved_properties").insert(ids.slice(12, 16).map((property_id) => ({ user_id: owners[0], property_id })));

  console.log(`Seeded ${ids.length} listings, ${owners.length + agents.length + 1} users. Dev password for all accounts: ${DEV_PASSWORD}`);
}

/** Deterministic random point inside an area (ST_GeneratePoints with a fixed seed). */
async function randomPointIn(knex: Knex, areaId: number, seed: number): Promise<LngLat> {
  const r = await knex.raw<{ rows: Array<{ lng: number; lat: number }> }>(
    `SELECT ST_X(p) AS lng, ST_Y(p) AS lat
       FROM (SELECT (ST_Dump(ST_GeneratePoints(boundary::geometry, 1, ?))).geom AS p FROM admin_areas WHERE id = ?) s`,
    [seed, areaId],
  );
  const p = r.rows[0];
  if (!p) throw new Error(`Could not place a point in area ${areaId}`);
  return { lng: p.lng, lat: p.lat };
}

function foldAr(s: string) {
  return s.replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
}
