# AQAR (عقار) — Claude Code instructions

Map-based real estate website for Jordan and the Gulf (phase 1: Jordan only). Arabic-first (RTL) with English (LTR).
**Full specification: `docs/SPEC.md`** — read the relevant section before starting any task.

## Stack
- React 19 + React Router v7 (framework mode, SSR) + TypeScript (strict) + Vite + Tailwind CSS
- Express server hosting the React Router handler and REST API at `/api/v1`
- PostgreSQL 16 + PostGIS (Docker in dev), Knex for migrations and queries, Zod for validation
- MapLibre GL JS + OpenFreeMap vector tiles (`MAP_STYLE_URL_*` env), terra-draw for draw-to-search
- **All software free/open source; only hosting is paid.** No paid third-party services, APIs or libraries.
- Production: one Linux VPS — Node 24 LTS app, PostgreSQL 16 + PostGIS on the same host, Caddy for HTTPS, images on the VPS disk via the storage interface, nightly `pg_dump` + image backups (SPEC §0).

## Commands
Node 24 LTS (`>=24 <25`, see `.nvmrc`). Copy `.env.example` to `.env` first.
- `docker compose up -d` — start local PostGIS (dev only; production PostgreSQL + PostGIS runs on the VPS)
- `npm run dev` — Express + Vite dev server with SSR on `PORT` (default 3000); `/` → `/ar/jo/map`
- `npm run build` / `npm start` — production build (`build/`) and server (`NODE_ENV=production`)
- `npm run db:migrate` / `npm run db:rollback` / `npm run db:seed` — Knex via `tsx` (`knexfile.ts`)
- `npm run typecheck` — `react-router typegen` + `tsc --noEmit`
- `npm run lint` — ESLint (`eslint.config.ts`); custom rule `aqar/no-physical-direction` (`eslint-rules/`) fails on left/right Tailwind utilities in `app/` TS/TSX and CSS `@apply`; `css/prefer-logical-properties` covers left/right CSS properties
- `npm test` — Vitest (`*.test.ts` next to the code)

## Layout notes
- `server/index.ts` — Express entry: `/api/v1` (`server/api`), `/uploads` (dev only — Caddy serves it in production), then React Router (`server/app.ts`).
- `app/routes.ts` — route config: `/:lang` (layout, validates locale) → `:country/map` (validates against `ACTIVE_COUNTRIES` in `app/shared/countries.ts`).
- i18n: `getT(locale)` / `useT()` in `app/i18n`; plurals are nested objects keyed by `Intl.PluralRules` category (`zero/one/two/few/many/other`), `other` required.
- Theme: cookie `theme` (`dark` default) read in the root loader; toggled via POST `/theme`.

## How to work
- **Review existing code and docs before writing new code.** Before changing a feature, read the files involved and summarize what exists.
- Work one milestone from `docs/SPEC.md` §18 at a time. For anything larger than a small fix, propose a short plan and wait for approval.
- Stay inside the requested scope. Do not build `[P2]` features unless asked.
- After each milestone: typecheck and lint clean, tests pass, add a short entry to `docs/CHANGELOG.md`.
- If the spec is ambiguous or contradicts the code, ask — don't guess silently.

## Non-negotiable rules
1. **Owner phone privacy:** the real phone (`owner_phone_encrypted`) is returned only by `GET /api/v1/admin/listings/:id/contact`. Never in public API responses, React Router loader data (it is serialized into HTML), client state, localStorage, or logs. Public serializers use explicit field allow-lists — never spread DB rows.
2. **Location privacy:** public code reads `display_point` only. The true `point` is admin-only. The approximate offset is computed once on save and stored, never per request. Address details can pinpoint a property just like `point`: typed address fields follow their per-country `visibility` (`public` / `exact_only` — only when the listing's precision is `exact` / `admin_only`), and **property identifiers (`property_identifiers`, e.g. land parcel or PACI numbers) are never public** — only the listing's owner/agent and admins see them. Never collect personal civil IDs. Same leak surfaces as rule 1 (API responses, loader data, client state, logs). See SPEC §2.3–2.4, §4.3.
3. **SQL:** parameterized only (Knex builder or `knex.raw` with bindings). PostGIS uses `geography` with SRID 4326; longitude comes first in coordinates.
4. **Status values** are exactly: `draft, pending, published, rejected, reserved, sold, rented, archived`.
5. **Money:** `numeric(14,3)`; currency comes from the listing's country, never from user input. Format with the country's decimal count.
6. **i18n:** no hard-coded user-facing strings — everything goes through `app/i18n/ar.json` and `en.json` (add both keys together). Bilingual content is stored as `*_ar` / `*_en` columns.
7. **RTL:** use logical Tailwind utilities (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`, `text-start`). Don't use `left`/`right`/`pl-`/`pr-`/`ml-`/`mr-` for layout. Check every new screen in both `/ar` and `/en`.
8. **Validation:** Zod on every API endpoint, loader input, and action; share schemas from `app/shared/schemas`.
9. **Secrets** only from `.env` (never commit it; keep `.env.example` current). Seed credentials are dev-only.

## Conventions
- Components: PascalCase files; hooks `useX`; services in `server/services` hold business logic, and routes/loaders stay thin.
- Map state and filters live in URL search params (`useMapUrlState`), not only in component state.
- Dark theme is the default; colours come from the Tailwind theme tokens defined from SPEC §14, not ad-hoc hex values.
