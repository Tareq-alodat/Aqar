import type { Knex } from "knex";

/**
 * Address field catalog and per-country settings (SPEC §2.3–2.4).
 * The catalog and Jordan's settings are reference data, inserted here so they
 * exist in every environment.
 */

interface Part {
  key: string;
  label_ar: string;
  label_en: string;
  required: boolean;
  /** Digits only after normalization; leading zeros stripped when the scheme allows. */
  numeric: boolean;
}

interface Field {
  key: string;
  kind: "admin_area" | "text" | "number" | "identifier";
  label_ar: string;
  label_en: string;
  pattern?: string;
  strip_leading_zeros?: boolean;
  parts?: Part[];
  group_parts?: number;
}

const FIELDS: Field[] = [
  { key: "governorate", kind: "admin_area", label_ar: "المحافظة", label_en: "Governorate" },
  { key: "city", kind: "admin_area", label_ar: "المدينة", label_en: "City" },
  { key: "district", kind: "admin_area", label_ar: "المنطقة", label_en: "District" },
  { key: "area", kind: "admin_area", label_ar: "الحي", label_en: "Area" },
  { key: "block", kind: "admin_area", label_ar: "القطعة", label_en: "Block" },
  { key: "street", kind: "text", label_ar: "الشارع", label_en: "Street" },
  { key: "avenue", kind: "text", label_ar: "الجادة", label_en: "Avenue" },
  { key: "building_number", kind: "text", label_ar: "رقم البناية", label_en: "Building number", pattern: "^[0-9A-Za-z\\- ]{1,10}$" },
  { key: "apartment_number", kind: "text", label_ar: "رقم الشقة", label_en: "Apartment number", pattern: "^[0-9A-Za-z\\- ]{1,10}$" },
  { key: "postal_code", kind: "text", label_ar: "الرمز البريدي", label_en: "Postal code", pattern: "^[0-9]{5}$" },
  {
    key: "jo_land_parcel",
    kind: "identifier",
    label_ar: "بيانات الأرض (دائرة الأراضي والمساحة)",
    label_en: "Land registry (DLS) details",
    strip_leading_zeros: true,
    // Duplicate = same full key; same first 4 parts with a different apartment = "same building".
    group_parts: 4,
    parts: [
      { key: "directorate", label_ar: "مديرية التسجيل", label_en: "Registration directorate", required: true, numeric: false },
      { key: "village", label_ar: "القرية", label_en: "Village", required: true, numeric: false },
      { key: "basin", label_ar: "الحوض", label_en: "Basin", required: true, numeric: false },
      { key: "parcel", label_ar: "رقم القطعة", label_en: "Parcel number", required: true, numeric: true },
      { key: "apartment", label_ar: "رقم الشقة", label_en: "Apartment number", required: false, numeric: true },
    ],
  },
  {
    key: "kw_paci",
    kind: "identifier",
    label_ar: "الرقم الآلي للعنوان (PACI)",
    label_en: "PACI address number",
    pattern: "^[0-9]{6,12}$",
    strip_leading_zeros: false,
  },
  {
    key: "sa_national_address",
    kind: "identifier",
    label_ar: "العنوان الوطني المختصر",
    label_en: "National Address short code",
    pattern: "^[A-Z]{4}[0-9]{4}$",
    strip_leading_zeros: false,
  },
];

/** Jordan's address settings. No floor field: floor is the public feature `floor_number`. */
const JORDAN: Array<{
  field_key: string;
  visibility: "public" | "exact_only" | "admin_only";
  map_min_zoom?: number;
}> = [
  { field_key: "governorate", visibility: "public", map_min_zoom: 6 },
  { field_key: "city", visibility: "public", map_min_zoom: 9 },
  { field_key: "area", visibility: "public", map_min_zoom: 12 },
  { field_key: "street", visibility: "exact_only" },
  { field_key: "building_number", visibility: "exact_only" },
  { field_key: "apartment_number", visibility: "admin_only" },
  { field_key: "jo_land_parcel", visibility: "admin_only" },
];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("address_fields", (t) => {
    t.text("key").primary();
    t.enu("kind", ["admin_area", "text", "number", "identifier"]).notNullable();
    t.text("label_ar").notNullable();
    t.text("label_en").notNullable();
    t.text("pattern");
    t.boolean("strip_leading_zeros").notNullable().defaultTo(false);
    t.jsonb("parts");
    t.smallint("group_parts");
    t.timestamps(true, true);
    t.check("key ~ '^[a-z][a-z0-9_]*$'", [], "address_fields_key_format");
    t.check("parts IS NULL OR (kind = 'identifier' AND jsonb_typeof(parts) = 'array')", [], "address_fields_parts");
    t.check("group_parts IS NULL OR parts IS NOT NULL", [], "address_fields_group_parts");
  });

  await knex.schema.createTable("country_address_fields", (t) => {
    t.specificType("country_code", "char(2)").notNullable().references("code").inTable("countries").onDelete("CASCADE");
    t.text("field_key").notNullable().references("key").inTable("address_fields").onDelete("RESTRICT");
    t.smallint("position").notNullable();
    t.boolean("is_required").notNullable().defaultTo(false);
    t.enu("visibility", ["public", "exact_only", "admin_only"]).notNullable().defaultTo("admin_only");
    t.smallint("map_min_zoom");
    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.primary(["country_code", "field_key"]);
    t.check("map_min_zoom IS NULL OR map_min_zoom BETWEEN 0 AND 22", [], "country_address_fields_zoom");
  });

  for (const table of ["address_fields", "country_address_fields"]) {
    await knex.raw(`CREATE TRIGGER ${table}_updated_at BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);
  }

  await knex("address_fields").insert(
    FIELDS.map((f) => ({
      key: f.key,
      kind: f.kind,
      label_ar: f.label_ar,
      label_en: f.label_en,
      pattern: f.pattern ?? null,
      strip_leading_zeros: f.strip_leading_zeros ?? false,
      parts: f.parts ? JSON.stringify(f.parts) : null,
      group_parts: f.group_parts ?? null,
    })),
  );

  await knex("country_address_fields").insert(
    JORDAN.map((f, i) => ({
      country_code: "JO",
      field_key: f.field_key,
      position: i + 1,
      visibility: f.visibility,
      map_min_zoom: f.map_min_zoom ?? null,
    })),
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("country_address_fields");
  await knex.schema.dropTable("address_fields");
}
