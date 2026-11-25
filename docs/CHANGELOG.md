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
- Vitest: 33 tests covering Arabic/English plurals, ar/en key parity, route-param validation and the health endpoint.
- Repo hygiene: `.gitattributes` (LF), extended `.gitignore` (`.env`, `node_modules`, build output, `uploads/`), `.env.example`, `.nvmrc`.

### Known gaps
- Node 22 not verified locally (dev machine runs Node 24); all dependencies declare Node 22.12+ support.
