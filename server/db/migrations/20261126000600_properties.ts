import type { Knex } from "knex";

/**
 * Listings (SPEC §4). Location privacy (§4.3): `point` is the true pin and is
 * admin-only; public code reads `display_point`. `address` holds the typed
 * address fields (§2.3); unit identifiers live in `property_identifiers`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("properties", (t) => {
    t.increments("id");
    t.integer("owner_id").notNullable().references("id").inTable("users").onDelete("RESTRICT");
    t.specificType("country_code", "char(2)").notNullable().references("code").inTable("countries").onDelete("RESTRICT");
    t.integer("admin_area_id").references("id").inTable("admin_areas").onDelete("SET NULL");

    // Basic
    t.text("title_ar");
    t.text("title_en");
    t.text("description_ar");
    t.text("description_en");
    t.enu("category", ["house", "apartment", "land", "villa", "commercial"]).notNullable();
    t.enu("listing_type", ["sale", "rent", "exchange"]).notNullable();
    t.enu("rent_period", ["monthly", "yearly"]);
    t.decimal("price", 14, 3);
    // Always the country's currency; set by trigger, never from user input (CLAUDE.md rule 5).
    t.specificType("currency", "char(3)").notNullable();

    // Features
    t.decimal("area_sqm", 10, 2);
    t.smallint("bedrooms");
    t.smallint("bathrooms");
    t.smallint("floors");
    t.smallint("floor_number");
    t.smallint("age_years");
    t.boolean("parking").notNullable().defaultTo(false);
    t.boolean("garden").notNullable().defaultTo(false);
    t.boolean("pool").notNullable().defaultTo(false);
    t.boolean("elevator").notNullable().defaultTo(false);
    t.enu("furnished", ["yes", "no", "partial"]);
    t.specificType("amenities", "text[]").notNullable().defaultTo("{}");

    // Location
    t.specificType("point", "geography(Point,4326)");
    t.specificType("display_point", "geography(Point,4326)");
    t.enu("location_precision", ["exact", "approximate"]).notNullable().defaultTo("exact");
    t.jsonb("address").notNullable().defaultTo("{}");
    t.boolean("needs_location_review").notNullable().defaultTo(false);

    // Contact (§8): ciphertext + HMAC only.
    t.text("owner_phone_encrypted");
    t.text("owner_phone_hash");

    // Owner settings
    t.enu("offers_visibility", ["public", "amounts_only", "private"]).notNullable().defaultTo("amounts_only");

    // System
    t.enu("status", ["draft", "pending", "published", "rejected", "reserved", "sold", "rented", "archived"])
      .notNullable()
      .defaultTo("draft");
    t.text("rejection_reason");
    t.boolean("is_featured").notNullable().defaultTo(false);
    t.timestamp("featured_requested_at", { useTz: true });
    t.integer("view_count").notNullable().defaultTo(0);
    t.text("slug");
    t.timestamp("published_at", { useTz: true });
    t.timestamps(true, true);

    t.check("status = 'draft' OR title_ar IS NOT NULL OR title_en IS NOT NULL", [], "properties_title_required");
    t.check("(listing_type = 'rent') = (rent_period IS NOT NULL)", [], "properties_rent_period");
    t.check("price IS NOT NULL OR listing_type = 'exchange' OR status = 'draft'", [], "properties_price_required");
    t.check("price IS NULL OR price >= 0", [], "properties_price_nonnegative");
    t.check("area_sqm IS NULL OR area_sqm > 0", [], "properties_area_positive");
    t.check(
      "(bedrooms IS NULL OR bedrooms >= 0) AND (bathrooms IS NULL OR bathrooms >= 0) AND (floors IS NULL OR floors >= 0) AND (age_years IS NULL OR age_years >= 0)",
      [],
      "properties_counts_nonnegative",
    );
    t.check("status = 'draft' OR (point IS NOT NULL AND display_point IS NOT NULL)", [], "properties_location_required");
    t.check("(point IS NULL) = (display_point IS NULL)", [], "properties_point_pair");
    t.check("(owner_phone_encrypted IS NULL) = (owner_phone_hash IS NULL)", [], "properties_phone_pair");
    t.check("status = 'draft' OR owner_phone_encrypted IS NOT NULL", [], "properties_phone_required");
    t.check("jsonb_typeof(address) = 'object'", [], "properties_address_object");
    t.check("status <> 'published' OR published_at IS NOT NULL", [], "properties_published_at");
    t.check("status <> 'rejected' OR rejection_reason IS NOT NULL", [], "properties_rejection_reason");
    t.check("view_count >= 0", [], "properties_view_count");

    t.index(["owner_id"]);
    t.index(["admin_area_id"]);
  });

  // SPEC §5.5
  await knex.raw("CREATE INDEX properties_display_point_gist ON properties USING GIST (display_point)");
  await knex.raw(
    "CREATE INDEX properties_search ON properties (country_code, status, listing_type, category, price)",
  );
  await knex.raw("CREATE INDEX properties_status_published ON properties (status, published_at DESC)");
  await knex.raw("CREATE INDEX properties_address_gin ON properties USING GIN (address jsonb_path_ops)");

  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_property_currency() RETURNS trigger AS $$
    BEGIN
      SELECT currency INTO NEW.currency FROM countries WHERE code = NEW.country_code;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(
    "CREATE TRIGGER properties_currency BEFORE INSERT OR UPDATE OF country_code, currency ON properties FOR EACH ROW EXECUTE FUNCTION set_property_currency()",
  );
  await knex.raw(
    "CREATE TRIGGER properties_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION set_updated_at()",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("properties");
  await knex.raw("DROP FUNCTION IF EXISTS set_property_currency()");
}
