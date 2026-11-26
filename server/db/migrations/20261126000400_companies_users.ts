import type { Knex } from "knex";

/** Agent companies and users (SPEC §3, §8, §11). */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("companies", (t) => {
    t.increments("id");
    t.text("name_ar").notNullable();
    t.text("name_en");
    t.text("slug").notNullable().unique();
    t.text("logo_url");
    t.text("license_number");
    t.boolean("is_verified").notNullable().defaultTo(false);
    t.timestamp("verified_at", { useTz: true });
    t.timestamps(true, true);
    t.check("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", [], "companies_slug_format");
  });

  await knex.schema.createTable("users", (t) => {
    t.increments("id");
    t.text("email").notNullable();
    t.text("password_hash").notNullable();
    t.text("name").notNullable();
    // Profile phone: AES-256-GCM ciphertext + HMAC-SHA256 for lookup (SPEC §8). Never returned publicly.
    t.text("phone_encrypted");
    t.text("phone_hash");
    t.enu("role", ["admin", "agent", "owner"]).notNullable().defaultTo("owner");
    t.enu("status", ["active", "suspended"]).notNullable().defaultTo("active");
    t.enu("locale", ["ar", "en"]).notNullable().defaultTo("ar");
    t.enu("theme", ["dark", "light"]).notNullable().defaultTo("dark");
    t.integer("company_id").references("id").inTable("companies").onDelete("SET NULL");
    t.timestamp("last_login_at", { useTz: true });
    t.timestamps(true, true);
    t.check("(phone_encrypted IS NULL) = (phone_hash IS NULL)", [], "users_phone_pair");
    t.check("company_id IS NULL OR role = 'agent'", [], "users_company_agent_only");
    t.index(["phone_hash"]);
    t.index(["company_id"]);
  });
  await knex.raw("CREATE UNIQUE INDEX users_email_lower ON users (lower(email))");

  for (const table of ["companies", "users"]) {
    await knex.raw(`CREATE TRIGGER ${table}_updated_at BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("users");
  await knex.schema.dropTable("companies");
}
