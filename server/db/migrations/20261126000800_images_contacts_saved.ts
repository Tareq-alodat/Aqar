import type { Knex } from "knex";

/** Listing images (§4.4), proxy contact numbers (§8), saved listings (§11). */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("property_images", (t) => {
    t.increments("id");
    t.integer("property_id").notNullable().references("id").inTable("properties").onDelete("CASCADE");
    t.text("url").notNullable();
    t.text("thumbnail_url").notNullable();
    t.integer("width").notNullable();
    t.integer("height").notNullable();
    t.smallint("order_index").notNullable();
    t.timestamp("uploaded_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check("order_index BETWEEN 0 AND 19", [], "property_images_order_range");
    t.check("width > 0 AND height > 0", [], "property_images_dimensions");
  });
  // Deferred so a reorder can swap positions inside one transaction.
  await knex.raw(
    "ALTER TABLE property_images ADD CONSTRAINT property_images_order_unique UNIQUE (property_id, order_index) DEFERRABLE INITIALLY DEFERRED",
  );

  await knex.schema.createTable("contact_numbers", (t) => {
    t.increments("id");
    t.text("phone_number").notNullable();
    t.boolean("whatsapp").notNullable().defaultTo(false);
    t.text("label");
    t.enu("scope", ["global", "country", "admin_area", "property"]).notNullable();
    t.specificType("country_code", "char(2)").references("code").inTable("countries").onDelete("CASCADE");
    t.integer("admin_area_id").references("id").inTable("admin_areas").onDelete("CASCADE");
    t.integer("property_id").references("id").inTable("properties").onDelete("CASCADE");
    t.boolean("is_active").notNullable().defaultTo(true);
    t.integer("created_by").references("id").inTable("users").onDelete("SET NULL");
    t.timestamps(true, true);
    t.check("phone_number ~ '^\\+[0-9]{8,15}$'", [], "contact_numbers_phone_format");
    t.check(
      `(scope = 'global' AND country_code IS NULL AND admin_area_id IS NULL AND property_id IS NULL)
       OR (scope = 'country' AND country_code IS NOT NULL AND admin_area_id IS NULL AND property_id IS NULL)
       OR (scope = 'admin_area' AND admin_area_id IS NOT NULL AND property_id IS NULL)
       OR (scope = 'property' AND property_id IS NOT NULL)`,
      [],
      "contact_numbers_scope_target",
    );
    t.index(["scope", "is_active"]);
    t.index(["admin_area_id"]);
    t.index(["property_id"]);
  });
  await knex.raw(
    "CREATE TRIGGER contact_numbers_updated_at BEFORE UPDATE ON contact_numbers FOR EACH ROW EXECUTE FUNCTION set_updated_at()",
  );

  // Property-level proxy override (§4.1). Added here because contact_numbers is created after properties.
  await knex.schema.alterTable("properties", (t) => {
    t.integer("contact_number_id").references("id").inTable("contact_numbers").onDelete("SET NULL");
  });

  await knex.schema.createTable("saved_properties", (t) => {
    t.increments("id");
    t.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.integer("property_id").notNullable().references("id").inTable("properties").onDelete("CASCADE");
    t.timestamp("saved_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(["user_id", "property_id"]);
    t.index(["property_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("saved_properties");
  await knex.schema.alterTable("properties", (t) => {
    t.dropColumn("contact_number_id");
  });
  await knex.schema.dropTable("contact_numbers");
  await knex.schema.dropTable("property_images");
}
