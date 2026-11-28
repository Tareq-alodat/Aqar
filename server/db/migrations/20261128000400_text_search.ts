import type { Knex } from "knex";

/**
 * Text search (SPEC §5.6, milestone 4b). PostgreSQL only: `pg_trgm` + built-in
 * full-text search.
 *
 * - `aqar_normalize_ar(text)`: the normalization used when indexing and on the
 *   query (twin of `normalizeSearchText` in app/shared/normalizeText.ts).
 * - `aqar_strip_contacts(text)`: removes contact details (SPEC §8.1) from
 *   normalized text, so they are never indexed. Uses a snapshot of the TypeScript detector's
 *   patterns; when those change, add a migration that re-creates this function
 *   and refreshes the search columns (the database test fails until then).
 * - `properties.search_tsv` / `search_norm`: kept by a trigger from the titles,
 *   descriptions and the listing's area path (names of its area and every
 *   ancestor); a trigger on `admin_areas` refreshes them when an area is
 *   renamed or moved.
 * - `admin_areas.search_norm`: normalized Arabic + English name, for the
 *   location autocomplete.
 *
 * Production needs the `postgresql-contrib` package for pg_trgm (SPEC §0).
 */

/**
 * Snapshot of `contactPatternsForSql()` (app/shared/contactDetails.ts) at the time of this migration —
 * migrations stay frozen. server/db/textSearch.db.test.ts checks the SQL function against the current detector.
 */
const CONTACT_PATTERNS: string[] = [
    "(^|[^a-z0-9_ء-يٱ-ۓ])([a-z0-9._%+-]+@[a-z0-9-]+(\\.[a-z0-9-]+)*\\.[a-z]{2,})([^a-z0-9_ء-يٱ-ۓ]|$)",
    "(^|[^a-z0-9_ء-يٱ-ۓ])((https{0,1}://|www\\.)\\S+|[a-z0-9-]+(\\.[a-z0-9-]+)*\\.(com|net|org|info|biz|io|me|co|jo|sa|kw|ae|app|link|ly|site|online|store|shop)(/\\S*){0,1})([^a-z0-9_ء-يٱ-ۓ]|$)",
    "(^|[^a-z0-9_ء-يٱ-ۓ])(\\+ {0,1}[0-9]([ .()_–—-]{0,2}[0-9]){7,14}|[0-9]([ .()_–—-]{0,2}[0-9]){8,14})([^a-z0-9_ء-يٱ-ۓ]|$)",
    "(^|[^a-z0-9_ء-يٱ-ۓ])(@[a-z0-9_.]{2,30})([^a-z0-9_ء-يٱ-ۓ]|$)",
    "(^|[^a-z0-9_ء-يٱ-ۓ])(((ال|[وفبلك]ال|عال|[وفبلع]){0,1}(وا{0,1}تس( {0,1}ا{0,1}ب){0,1}|تي{0,1}لي{0,1}[غجكق]رام|ان{0,1}ست{0,1}[غجقك]رام|انستا|فيس( {0,1}بوك){0,1})|whats {0,1}app|whatsap|watsapp|telegram|instagram|insta|facebook|fb)( {0,2}: {0,2}@{0,1}[a-z0-9_.]{3,30}| {1,2}@[a-z0-9_.]{2,30}){0,1})([^a-z0-9_ء-يٱ-ۓ]|$)"
  ];

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function up(knex: Knex): Promise<void> {
  await knex.raw("CREATE EXTENSION IF NOT EXISTS pg_trgm");

  // Diacritics U+064B–U+0652, superscript alef U+0670, tatweel U+0640 (written as characters: no escapes in SQL).
  const marks = `[${String.fromCodePoint(0x064b)}-${String.fromCodePoint(0x0652)}${String.fromCodePoint(0x0670)}${String.fromCodePoint(0x0640)}]`;
  const from = "أإآةى" + "٠١٢٣٤٥٦٧٨٩" + "۰۱۲۳۴۵۶۷۸۹";
  const to = "اااهي" + "0123456789" + "0123456789";
  await knex.raw(`
    CREATE FUNCTION aqar_normalize_ar(t text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $f$
      SELECT lower(translate(regexp_replace(t, ${sqlString(marks)}, '', 'g'), ${sqlString(from)}, ${sqlString(to)}))
    $f$
  `);

  // Each pattern consumes the boundary characters around a detail; repeating until nothing changes
  // catches details that share a boundary (e.g. "fb fb").
  const replacements = CONTACT_PATTERNS
    .map((p) => `      t := regexp_replace(t, ${sqlString(p)}, ' ', 'g');`)
    .join("\n");
  await knex.raw(`
    CREATE FUNCTION aqar_strip_contacts(t text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $f$
    DECLARE
      prev text;
      rounds int := 0;
    BEGIN
      LOOP
        prev := t;
${replacements}
        rounds := rounds + 1;
        EXIT WHEN t = prev OR rounds >= 5;
      END LOOP;
      RETURN t;
    END
    $f$
  `);

  await knex.raw(`
    ALTER TABLE properties
      ADD COLUMN search_tsv tsvector NOT NULL DEFAULT ''::tsvector,
      ADD COLUMN search_norm text NOT NULL DEFAULT ''
  `);

  // Every text goes in its language's config (stemming) and in 'simple' (exact words, mixed-language queries);
  // weights: titles A, area path B, descriptions C/D.
  await knex.raw(`
    CREATE FUNCTION properties_search_columns() RETURNS trigger
    LANGUAGE plpgsql AS $f$
    DECLARE
      t_ar text;
      t_en text;
      d_ar text;
      d_en text;
      path_ar text;
      path_en text;
    BEGIN
      t_ar := aqar_strip_contacts(aqar_normalize_ar(coalesce(NEW.title_ar, '')));
      t_en := aqar_strip_contacts(aqar_normalize_ar(coalesce(NEW.title_en, '')));
      d_ar := aqar_strip_contacts(aqar_normalize_ar(coalesce(NEW.description_ar, '')));
      d_en := aqar_strip_contacts(aqar_normalize_ar(coalesce(NEW.description_en, '')));

      WITH RECURSIVE up AS (
        SELECT id, parent_id, name_ar, name_en, 0 AS depth FROM admin_areas WHERE id = NEW.admin_area_id
        UNION ALL
        SELECT a.id, a.parent_id, a.name_ar, a.name_en, up.depth + 1
          FROM admin_areas a JOIN up ON a.id = up.parent_id
         WHERE up.depth < 10
      )
      SELECT coalesce(string_agg(aqar_normalize_ar(name_ar), ' ' ORDER BY depth), ''),
             coalesce(string_agg(aqar_normalize_ar(coalesce(name_en, '')), ' ' ORDER BY depth), '')
        INTO path_ar, path_en
        FROM up;

      NEW.search_tsv :=
           setweight(to_tsvector('arabic', t_ar), 'A')
        || setweight(to_tsvector('english', t_en), 'A')
        || setweight(to_tsvector('simple', t_ar || ' ' || t_en), 'A')
        || setweight(to_tsvector('arabic', path_ar), 'B')
        || setweight(to_tsvector('english', path_en), 'B')
        || setweight(to_tsvector('simple', path_ar || ' ' || path_en), 'B')
        || setweight(to_tsvector('arabic', d_ar), 'C')
        || setweight(to_tsvector('english', d_en), 'C')
        || setweight(to_tsvector('simple', d_ar || ' ' || d_en), 'D');
      NEW.search_norm := btrim(regexp_replace(concat_ws(' ', t_ar, t_en, path_ar, path_en), '[[:space:]]+', ' ', 'g'));
      RETURN NEW;
    END
    $f$
  `);
  await knex.raw(`
    CREATE TRIGGER properties_search
      BEFORE INSERT OR UPDATE OF title_ar, title_en, description_ar, description_en, admin_area_id ON properties
      FOR EACH ROW EXECUTE FUNCTION properties_search_columns()
  `);

  await knex.raw(`
    CREATE FUNCTION admin_areas_refresh_listing_search() RETURNS trigger
    LANGUAGE plpgsql AS $f$
    BEGIN
      UPDATE properties SET admin_area_id = admin_area_id
       WHERE admin_area_id IN (
         WITH RECURSIVE d AS (
           SELECT NEW.id AS id
           UNION
           SELECT a.id FROM admin_areas a JOIN d ON a.parent_id = d.id
         ) SELECT id FROM d);
      RETURN NULL;
    END
    $f$
  `);
  await knex.raw(`
    CREATE TRIGGER admin_areas_listing_search
      AFTER UPDATE OF name_ar, name_en, parent_id ON admin_areas
      FOR EACH ROW
      WHEN (OLD.name_ar IS DISTINCT FROM NEW.name_ar OR OLD.name_en IS DISTINCT FROM NEW.name_en OR OLD.parent_id IS DISTINCT FROM NEW.parent_id)
      EXECUTE FUNCTION admin_areas_refresh_listing_search()
  `);

  // Fill the new columns without touching updated_at.
  await knex.raw("ALTER TABLE properties DISABLE TRIGGER properties_updated_at");
  await knex.raw("UPDATE properties SET admin_area_id = admin_area_id");
  await knex.raw("ALTER TABLE properties ENABLE TRIGGER properties_updated_at");

  await knex.raw("CREATE INDEX properties_search_tsv ON properties USING GIN (search_tsv)");
  await knex.raw("CREATE INDEX properties_search_norm_trgm ON properties USING GIN (search_norm gin_trgm_ops)");

  await knex.raw(`
    ALTER TABLE admin_areas ADD COLUMN search_norm text
      GENERATED ALWAYS AS (aqar_normalize_ar(name_ar) || ' ' || aqar_normalize_ar(coalesce(name_en, ''))) STORED
  `);
  await knex.raw("CREATE INDEX admin_areas_search_norm_trgm ON admin_areas USING GIN (search_norm gin_trgm_ops)");
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP INDEX IF EXISTS admin_areas_search_norm_trgm");
  await knex.raw("ALTER TABLE admin_areas DROP COLUMN IF EXISTS search_norm");
  await knex.raw("DROP TRIGGER IF EXISTS admin_areas_listing_search ON admin_areas");
  await knex.raw("DROP FUNCTION IF EXISTS admin_areas_refresh_listing_search()");
  await knex.raw("DROP TRIGGER IF EXISTS properties_search ON properties");
  await knex.raw("DROP FUNCTION IF EXISTS properties_search_columns()");
  await knex.raw("ALTER TABLE properties DROP COLUMN IF EXISTS search_tsv, DROP COLUMN IF EXISTS search_norm");
  await knex.raw("DROP FUNCTION IF EXISTS aqar_strip_contacts(text)");
  await knex.raw("DROP FUNCTION IF EXISTS aqar_normalize_ar(text)");
  await knex.raw("DROP EXTENSION IF EXISTS pg_trgm");
}
