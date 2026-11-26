# Changelog

One short entry per milestone (see `docs/SPEC.md` §18).

## Milestone 1 — Scaffold (2026-11-25)

- Removed the Replit prototype (`client/`, `server/`, `server/schema.sql`); it is preserved under the git tag `legacy-replit`.
- Added `docs/SPEC.md`, `CLAUDE.md` and this changelog. The spec now records hosting decisions: GoDaddy Node.js Hosting (Node 22), managed PostgreSQL + PostGIS (Supabase or Neon) in production, and object storage (Cloudinary or Cloudflare R2) for production images.
- Scaffolded React 19 + React Router v7 (framework mode, SSR) + TypeScript (strict) + Vite 8 + Tailwind CSS v4, served by Express 5 (`server/index.ts`). Port from `process.env.PORT`; `engines.node` is `>=22.12 <23`.
- Routing: `/:lang/:country/map`, with `lang` ∈ {ar, en} and `country` validated (Zod) against the active-country list (`jo` only). `/` and `/:lang` redirect to the map; anything else returns a localized 404. `<html lang dir>` is set server-side.
- i18n: `app/i18n/{ar,en}.json` with `t()` supporting interpolation (Western digits) and plurals via `Intl.PluralRules`, including all six Arabic forms.
- Layout shell: header with logo, country badge, language switcher and theme toggle (dark default; cookie-backed so SSR renders without a flash). Theme tokens from SPEC §14 (light palette is provisional). Self-hosted Cairo / DM Sans fonts.
- API: `/api/v1` router; `GET /api/v1/health` returns `{status}` only in production and adds env/node/uptime/DB status in development.
- Database: Knex (`knexfile.ts`, `db:migrate`/`db:rollback`/`db:seed`), first migration enables PostGIS, `docker-compose.yml` for `postgis/postgis:16-3.4`, published on host port `DB_PORT` (default 5433, so it does not clash with a local PostgreSQL on 5432). Verified: container healthy and the PostGIS migration applies.
- ESLint 10 flat config (`eslint.config.ts`): `@eslint/js` + `typescript-eslint` recommended, `react-hooks`, and a local rule `aqar/no-physical-direction` that rejects left/right Tailwind utilities (`pl-`, `mr-`, `left-`, `text-right`, `border-l`, `rounded-tl`, …) in `className`/`class` and `cn`/`clsx`/`cva`/`twMerge` calls, suggesting the logical equivalent; `rtl:`/`ltr:` variants are allowed. Utilities with no logical form (`translate-x-*`, `bg-linear-to-l/r`/`bg-gradient-to-l/r` incl. diagonals, angled `bg-linear-45`/`bg-linear-[25deg,…]`, `origin-*-left/right`) and arbitrary properties/values containing left/right (`[margin-left:…]`, `[background-position:left]`) are also flagged, with a logical property where one exists (`[margin-inline-start:…]`) or else an explicit `ltr:`/`rtl:` mirrored pair. CSS is linted with `@eslint/css` + `tailwind-csstree`: the same rule checks `@apply`, and `css/prefer-logical-properties` flags left/right properties and values (`margin-left`, `right`, `text-align: left`); block-axis/size properties and viewport units are allowed.
- Vitest: 140 tests covering Arabic/English plurals, ar/en key parity, route-param validation, the health endpoint and the RTL lint rule.
- Repo hygiene: `.gitattributes` (LF), extended `.gitignore` (`.env`, `node_modules`, build output, `uploads/`), `.env.example`, `.nvmrc`.

### Known gaps
- CSS is parsed in `tolerant` mode (needed for Tailwind `@apply` syntax such as `!mr-2`), so CSS syntax errors are not reported by lint. `css/prefer-logical-properties` still flags `resize: horizontal|vertical` (the rule cannot allow-list it).
- Conic gradients (`bg-conic-*`) and gradients set through CSS variables (`bg-linear-(--x)`) are not checked.
- `react-router typegen`/`build` print a deprecation warning (`envFile` → `envDir: false`) from React Router's own Vite config, not from this repo.
- Node 22 not verified locally (dev machine runs Node 24); all dependencies declare Node 22.12+ support.

## Milestone 2 — Database (2026-11-26)

- Migrations (`server/db/migrations`): countries and per-country settings, the address field catalog with per-country `visibility`, `admin_areas` (PostGIS `geography`, `source` = osm/generated/manual, `name_en_reviewed`), companies/users, refresh tokens, `properties` (status/precision/currency CHECKs, currency taken from the country by trigger, `point` + stored `display_point`), `property_identifiers` (never public), images, contact numbers, saved listings, and the P2 tables phase 1 writes to (`price_history`, `property_views`).
- Services: phone encryption + keyed hash (`cryptoService`), password hashing, location (stored privacy offset, pin → deepest area with the 5 km nearest-centroid fallback and `needs_location_review`, area path), identifier normalization/matching and address field handling.
- Boundary import (`npm run db:import-boundaries -- JO`): reads `data/boundaries/JO/manifest.json` and upserts `admin_areas` in one transaction — 12 OSM governorates, 4 cities built from their OSM districts, and ~147 Amman neighbourhood cells (nearest-point cells clipped to Amman; Dabouq keeps its OSM polygon; Jubeiha placed by hand). Re-runs keep ids and slugs, never touch `manual` rows, and keep an English name marked reviewed unless the repo curates a replacement (manifest override, union group or manual point); missing English names are transliterated and flagged for review. OSM data is committed with sources and ODbL attribution in `data/boundaries/JO/SOURCES.md`; `scripts/fetch-osm-boundaries.ts` refreshes it.
- Dev seed (`server/db/seeds/01_dev_data.ts`, refuses to run in production, deterministic): 1 admin, 2 agents in a verified company, 3 owners; 40 published listings across Amman areas and other cities, 3 pending (one pinned just across the border, flagged for location review), 2 sold; exact/approximate mix, price history, property identifiers and contact numbers.
- Database tests (`npm run test:db`, `vitest.db.config.ts`): recreate a `*_test` database, check migrations roll back and forward, CHECK constraints match `app/shared/constants`, and cover the boundary import (re-run stability, reviewed/manual protection, pin lookup) and the seed. `npm test` excludes them. CI runs them against a PostGIS service with throwaway keys.

### Known gaps
- Generated Amman neighbourhood cells are approximations until admins redraw them (admin boundary editing is P2). The 21 Greater Amman municipal districts are recorded but not imported.
- An OSM `name:en` change does not replace a name already marked reviewed; curate it in `manifest.json` to force it.
