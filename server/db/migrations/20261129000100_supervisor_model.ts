import type { Knex } from "knex";

/**
 * Milestone 7a — supervisor model (SPEC §3, §4.1–4.2, §8, §9, §26).
 * - Roles: `super_admin` replaces `admin`; `supervisor` and the reserved `financier` [P2].
 * - `users.must_change_password`: set when the super_admin issues a one-time password.
 * - Any change to a user's role or status — or to a supervisor profile's `is_active` —
 *   revokes that user's sessions (refresh-token families) in the same transaction,
 *   whichever code path makes the change.
 * - Supervisor profiles (public AQAR work mobile) and scopes (admin areas, descendants included).
 * - Listing assignment: `properties.assigned_supervisor_id` / `assigned_at` (null = super_admin queue).
 * - `status_history` (§26) and `audit_log` (§9): append-only, enforced by triggers that
 *   reject UPDATE, DELETE and TRUNCATE. There is no bypass in the schema; dev/test cleanup
 *   uses `session_replication_role` (superuser only) in `server/db/devTruncate.ts`.
 */

const NEW_ROLES = ["super_admin", "supervisor", "agent", "owner", "financier"];
const OLD_ROLES = ["admin", "agent", "owner"];
const roleCheck = (roles: string[]) => `CHECK (role IN (${roles.map((r) => `'${r}'`).join(", ")}))`;

export async function up(knex: Knex): Promise<void> {
  // ── Roles ────────────────────────────────────────────────────────────────
  await knex.raw("ALTER TABLE users DROP CONSTRAINT users_role_check");
  await knex.raw("UPDATE users SET role = 'super_admin' WHERE role = 'admin'");
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_check ${roleCheck(NEW_ROLES)}`);
  await knex.schema.alterTable("users", (t) => {
    t.boolean("must_change_password").notNullable().defaultTo(false);
  });

  // ── Session revocation on role / status changes ─────────────────────────
  await knex.raw(`
    CREATE FUNCTION aqar_revoke_user_sessions(target integer) RETURNS void AS $$
      UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = target AND revoked_at IS NULL;
    $$ LANGUAGE sql
  `);
  await knex.raw(`
    CREATE FUNCTION users_revoke_sessions() RETURNS trigger AS $$
    BEGIN
      PERFORM aqar_revoke_user_sessions(NEW.id);
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(`
    CREATE TRIGGER users_role_status_revoke AFTER UPDATE OF role, status ON users
      FOR EACH ROW WHEN (OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status)
      EXECUTE FUNCTION users_revoke_sessions()
  `);

  // ── Supervisor profiles and scopes ──────────────────────────────────────
  await knex.schema.createTable("supervisor_profiles", (t) => {
    t.integer("user_id").primary().references("id").inTable("users").onDelete("CASCADE");
    // AQAR's work number: public on the supervisor's listings (SPEC §8).
    t.text("work_phone_e164").notNullable();
    t.boolean("work_phone_whatsapp").notNullable().defaultTo(false);
    t.text("title_ar");
    t.text("title_en");
    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.check("work_phone_e164 ~ '^\\+[0-9]{8,15}$'", [], "supervisor_profiles_phone_format");
  });
  await knex.raw(
    "CREATE TRIGGER supervisor_profiles_updated_at BEFORE UPDATE ON supervisor_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at()",
  );
  // A profile belongs to a supervisor, and a supervisor with a profile keeps that role.
  await knex.raw(`
    CREATE FUNCTION supervisor_profiles_role_check() RETURNS trigger AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND role = 'supervisor') THEN
        RAISE EXCEPTION 'supervisor_profiles.user_id % is not a supervisor', NEW.user_id USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(
    "CREATE TRIGGER supervisor_profiles_role BEFORE INSERT OR UPDATE OF user_id ON supervisor_profiles FOR EACH ROW EXECUTE FUNCTION supervisor_profiles_role_check()",
  );
  await knex.raw(`
    CREATE FUNCTION users_supervisor_role_keep() RETURNS trigger AS $$
    BEGIN
      IF NEW.role <> 'supervisor' AND EXISTS (SELECT 1 FROM supervisor_profiles WHERE user_id = NEW.id) THEN
        RAISE EXCEPTION 'user % has a supervisor profile', NEW.id USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(
    "CREATE TRIGGER users_supervisor_role BEFORE UPDATE OF role ON users FOR EACH ROW WHEN (OLD.role = 'supervisor' AND NEW.role <> 'supervisor') EXECUTE FUNCTION users_supervisor_role_keep()",
  );
  // Deactivating (or reactivating) a supervisor ends their sessions too.
  await knex.raw(`
    CREATE FUNCTION supervisor_profiles_revoke_sessions() RETURNS trigger AS $$
    BEGIN
      PERFORM aqar_revoke_user_sessions(NEW.user_id);
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(`
    CREATE TRIGGER supervisor_profiles_active_revoke AFTER UPDATE OF is_active ON supervisor_profiles
      FOR EACH ROW WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
      EXECUTE FUNCTION supervisor_profiles_revoke_sessions()
  `);

  await knex.schema.createTable("supervisor_scopes", (t) => {
    t.integer("supervisor_id").notNullable().references("user_id").inTable("supervisor_profiles").onDelete("CASCADE");
    t.integer("admin_area_id").notNullable().references("id").inTable("admin_areas").onDelete("RESTRICT");
    t.integer("created_by").references("id").inTable("users").onDelete("SET NULL");
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(["supervisor_id", "admin_area_id"]);
    t.index(["admin_area_id"]);
  });

  // ── Listing assignment ──────────────────────────────────────────────────
  await knex.schema.alterTable("properties", (t) => {
    t.integer("assigned_supervisor_id").references("id").inTable("users").onDelete("SET NULL");
    t.timestamp("assigned_at", { useTz: true });
    t.check("assigned_supervisor_id IS NULL OR assigned_at IS NOT NULL", [], "properties_assigned_at");
    t.index(["assigned_supervisor_id", "status"]);
  });

  // ── Status history and audit log (append-only) ──────────────────────────
  await knex.schema.createTable("status_history", (t) => {
    t.bigIncrements("id");
    t.text("entity_type").notNullable();
    t.bigInteger("entity_id").notNullable();
    t.text("from_status");
    t.text("to_status").notNullable();
    // RESTRICT, not SET NULL: a cascade would UPDATE an append-only row.
    t.integer("actor_user_id").references("id").inTable("users").onDelete("RESTRICT");
    t.text("reason");
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check("entity_type ~ '^[a-z_]+$'", [], "status_history_entity_type");
    t.index(["entity_type", "entity_id", "created_at"]);
    t.index(["actor_user_id", "created_at"]);
  });

  await knex.schema.createTable("audit_log", (t) => {
    t.bigIncrements("id");
    t.integer("actor_user_id").references("id").inTable("users").onDelete("RESTRICT");
    t.text("action").notNullable();
    t.text("entity_type").notNullable();
    t.bigInteger("entity_id");
    // Changed fields only; personal data is recorded as changed, never copied (SPEC §9).
    t.jsonb("before");
    t.jsonb("after");
    t.text("reason");
    t.text("ip_hash");
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.check("action ~ '^[a-z_]+$'", [], "audit_log_action");
    t.check("entity_type ~ '^[a-z_]+$'", [], "audit_log_entity_type");
    t.index(["entity_type", "entity_id", "created_at"]);
    t.index(["actor_user_id", "created_at"]);
    t.index(["action", "created_at"]);
  });

  await knex.raw(`
    CREATE FUNCTION aqar_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only (% refused)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
    END;
    $$ LANGUAGE plpgsql
  `);
  for (const table of ["status_history", "audit_log"]) {
    await knex.raw(`CREATE TRIGGER ${table}_no_change BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION aqar_append_only()`);
    await knex.raw(`CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION aqar_append_only()`);
  }
}

export async function down(knex: Knex): Promise<void> {
  const r = await knex("users").whereIn("role", ["supervisor", "financier"]).count({ n: "*" }).first();
  if (Number(r?.n ?? 0) > 0) throw new Error("Refusing to roll back: supervisor or financier accounts exist (no matching old role).");

  await knex.schema.dropTable("audit_log");
  await knex.schema.dropTable("status_history");
  await knex.raw("DROP FUNCTION aqar_append_only()");

  await knex.schema.alterTable("properties", (t) => {
    t.dropIndex(["assigned_supervisor_id", "status"]);
    t.dropChecks(["properties_assigned_at"]);
    t.dropColumn("assigned_at");
    t.dropColumn("assigned_supervisor_id");
  });

  await knex.schema.dropTable("supervisor_scopes");
  await knex.raw("DROP TRIGGER users_supervisor_role ON users");
  await knex.schema.dropTable("supervisor_profiles");
  await knex.raw("DROP FUNCTION supervisor_profiles_revoke_sessions()");
  await knex.raw("DROP FUNCTION supervisor_profiles_role_check()");
  await knex.raw("DROP FUNCTION users_supervisor_role_keep()");

  await knex.raw("DROP TRIGGER users_role_status_revoke ON users");
  await knex.raw("DROP FUNCTION users_revoke_sessions()");
  await knex.raw("DROP FUNCTION aqar_revoke_user_sessions(integer)");

  await knex.schema.alterTable("users", (t) => {
    t.dropColumn("must_change_password");
  });
  await knex.raw("ALTER TABLE users DROP CONSTRAINT users_role_check");
  await knex.raw("UPDATE users SET role = 'admin' WHERE role = 'super_admin'");
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT users_role_check ${roleCheck(OLD_ROLES)}`);
}
