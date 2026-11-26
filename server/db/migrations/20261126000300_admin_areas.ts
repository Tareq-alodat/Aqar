import type { Knex } from "knex";

/** Administrative areas with boundaries (SPEC §2.2). Rows come from `npm run db:import-boundaries`. */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("admin_areas", (t) => {
    t.increments("id");
    t.specificType("country_code", "char(2)").notNullable().references("code").inTable("countries").onDelete("RESTRICT");
    t.integer("parent_id").references("id").inTable("admin_areas").onDelete("RESTRICT");
    // An admin_area-kind field from the catalog (governorate, city, area, …).
    t.text("level").notNullable().references("key").inTable("address_fields").onDelete("RESTRICT");
    t.text("name_ar").notNullable();
    t.text("name_en").notNullable();
    t.boolean("name_en_reviewed").notNullable().defaultTo(true);
    t.text("slug").notNullable();
    t.specificType("boundary", "geography(MultiPolygon,4326)").notNullable();
    t.specificType("centroid", "geography(Point,4326)").notNullable();
    t.enu("source", ["osm", "generated", "manual"]).notNullable();
    t.text("source_ref");
    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.check("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", [], "admin_areas_slug_format");
    t.check("parent_id IS NULL OR parent_id <> id", [], "admin_areas_not_own_parent");
    t.index(["parent_id"]);
    t.index(["country_code", "level"]);
  });
  await knex.raw(
    "CREATE UNIQUE INDEX admin_areas_country_parent_slug ON admin_areas (country_code, parent_id, slug) NULLS NOT DISTINCT",
  );
  await knex.raw("CREATE INDEX admin_areas_boundary_gist ON admin_areas USING GIST (boundary)");
  await knex.raw(
    "CREATE TRIGGER admin_areas_updated_at BEFORE UPDATE ON admin_areas FOR EACH ROW EXECUTE FUNCTION set_updated_at()",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("admin_areas");
}
