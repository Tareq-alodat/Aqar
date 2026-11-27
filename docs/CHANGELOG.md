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
- Services: phone encryption + keyed hash (`cryptoService`) of the country-normalized E.164 number (`normalizePhone(input, countryCode)` in `app/shared/phone.ts`: local formats for JO/KW/SA/AE or `+`/`00`; prefixes checked against `countries.phone_prefix`), index on `properties.owner_phone_hash`, scrypt password hashing at N=2^17, r=8, p=1 (older hashes still verify; `needsRehash()` for upgrade on login), location (stored privacy offset, pin → deepest area with the 5 km nearest-centroid fallback and `needs_location_review`, area path), identifier normalization/matching and address field handling.
- Boundary import (`npm run db:import-boundaries -- JO`): reads `data/boundaries/JO/manifest.json` and upserts `admin_areas` in one transaction — 12 OSM governorates, 4 cities built from their OSM districts, and ~147 Amman neighbourhood cells (nearest-point cells clipped to Amman; Dabouq keeps its OSM polygon; Jubeiha placed by hand). Re-runs keep ids and slugs, never touch `manual` rows, and keep an English name marked reviewed unless the repo curates a replacement (manifest override, union group or manual point); missing English names are transliterated and flagged for review. OSM data is committed with sources and ODbL attribution in `data/boundaries/JO/SOURCES.md`; `scripts/fetch-osm-boundaries.ts` refreshes it.
- Dev seed (`server/db/seeds/01_dev_data.ts`, refuses to run in production, deterministic): 1 admin, 2 agents in a verified company, 3 owners; 40 published listings across Amman areas and other cities, 3 pending (one pinned just across the border, flagged for location review), 2 sold; exact/approximate mix, price history, property identifiers and contact numbers.
- Database tests (`npm run test:db`, `vitest.db.config.ts`): recreate a `*_test` database, check migrations roll back and forward, CHECK constraints match `app/shared/constants`, and cover the boundary import (re-run stability, reviewed/manual protection, pin lookup) and the seed. `npm test` excludes them. CI runs them against a PostGIS service with throwaway keys.
- Runtime moved to **Node 24 LTS** now that hosting is a VPS: `engines.node` `>=24 <25`, `.nvmrc` `24`, `@types/node` ^24, CI, CLAUDE.md and SPEC §0 updated. esbuild's install script is approved in `allowScripts` (pinned to the installed version).

### Known gaps
- Generated Amman neighbourhood cells are approximations until admins redraw them (admin boundary editing is P2). The 21 Greater Amman municipal districts are recorded but not imported.
- An OSM `name:en` change does not replace a name already marked reviewed; curate it in `manifest.json` to force it.
- Each password hash or verify uses ~128 MiB and a few hundred ms. (Milestone 3: at most 2 run at once, and login is rate-limited.)
- (Done in milestone 3: dummy hash for unknown emails, `needsRehash()` on login.)

## Milestone 3 — Auth (2026-11-27)

- **Sessions** (SPEC §13): 15-minute HS256 access JWT (`sub`, `role`, `sid`) + opaque 256-bit refresh token, in httpOnly SameSite=Lax cookies (`Secure` + `__Host-` over https). Every API and page request re-reads the user and checks the session is active, so suspension, role changes and logout apply at once. Refresh tokens are stored as HMAC-SHA256, rotated on use (pages and API) with a 30 s grace window for concurrent requests; reuse after that revokes the whole family. Lifetime: 30 days idle / 90 days absolute, admins 1 day / 7 days (new column `refresh_tokens.family_started_at`; the cap follows the user's current role).
- **Auth service** (`server/services/authService.ts`): register (always `owner`, optional phone normalized for the country), login (dummy scrypt hash for unknown emails, one error for wrong email or password, "suspended" only after the right password, `needsRehash` re-hash, `last_login_at`, expired tokens pruned), session resolution, logout. scrypt runs at most 2 at a time.
- **API** `/api/v1/auth`: `POST register | login | refresh | logout`, `GET me` — Zod-validated, explicit response fields, error codes with 400/401/403/409/429. `requireAuth` / `requireRole` middleware; `requireUser` / `requireRole` for loaders and actions.
- **CSRF**: origin check on every POST/PUT/PATCH/DELETE (API and page actions, including `/theme`) against `PUBLIC_BASE_URL` (`Origin` → `Sec-Fetch-Site` → `Referer`; none → 403). Logout is POST only; `?next=` accepts same-site paths only.
- **Rate limits** (`rate-limiter-flexible`, in memory): 100/min per IP on `/api/v1`, 5/min per IP for login + register (API and forms share it), 10 failed logins per email per 15 min; 429 with `Retry-After`. `trust proxy` = loopback in production (Caddy).
- **Pages**: `/:lang/login`, `/:lang/register` (forms with translated field errors, RTL/LTR checked), logout button and user name in the header (`useAuth()`); the root loader passes only `{ id, name, role }`.
- **Phones**: Jordanian landlines `0[2356]XXXXXXX`, mobiles typed without the leading 0 (JO, SA, AE), and Jordanian mobiles limited to 077/078/079 (also for `+962…` input).
- **Env**: `JWT_SECRET`, `REFRESH_TOKEN_SECRET` (32 bytes base64, different) required at startup; `PUBLIC_BASE_URL` validated. CI generates throwaway keys.
- New dependencies (MIT/ISC, no install scripts): `jose`, `rate-limiter-flexible`, `cookie`.
- Tests: 318 unit (tokens, cookies, origin check, `next` paths, limits, semaphore, schemas, phones, role middleware) and 88 database/HTTP (register/login, dummy hash, re-hash, suspension, rotation, grace, reuse, idle/absolute caps incl. admin and promotion, logout, API status codes and field allow-lists, CSRF, 429s). A 22-step end-to-end run against the dev server (forms, cookies, rotation, logout, leak check of page HTML, rate limit) passed.

### Known gaps
- Rate-limit counters live in memory: they reset on restart and do not work across several processes (fine for one VPS process).
- No email verification or password reset (needs sending email; not in phase 1). No "log out on all devices" yet.
- Registration is for Jordan only (`DEFAULT_COUNTRY`) until other countries go live.
- Old `refresh_tokens` rows are pruned per user on login; there is no scheduled cleanup yet.

## Milestone 4 — Map search (2026-11-27)

- **Map** (`app/components/map/MapView.tsx`, client-only): MapLibre GL 6 + OpenFreeMap tiles, no API key. `dark` basemap for the dark theme (default) and `positron` for light, both muted so the pins stand out; the basemap swaps with the theme. Basemap labels show one language (`name:ar` / `name:en`, falling back to `name`). **Arabic is shaped by MapLibre 6 itself**: the RTL text plugin is deprecated there and replaces the built-in support, so it is not loaded. "© OpenStreetMap contributors" is always visible (never collapsed, also on mobile) next to OpenFreeMap's own credit. Controls mirror in RTL (`controlPosition()`).
- **Drill-down**: governorate / city / neighbourhood outlines and labels appear from each level's `map_min_zoom` (6 / 9 / 12 for Jordan); clicking an area zooms to it. The full address path of the area in view (e.g. الأردن › عمان › عمان › عبدون) updates while panning and zooming; each part zooms back out. Governorate and city dropdowns jump to an area. No external geocoding.
- **Pins and clusters**: short prices (`85K`, `1.2M`, `450/mo`, translated suffix) in sale gold / rent teal / exchange purple from the theme tokens, a ring for featured listings, clusters that zoom in on click. Hovering a card highlights its pin; clicking a pin scrolls to its card (desktop) or opens a mini card (mobile).
- **Search**: filters of SPEC §5.3, sort, pages of 20, "search as I move" (300 ms debounce) or "Search this area", draw-to-search (terra-draw) with "Clear area". All of it lives in the URL (`useMapUrlState`), so every view is shareable; map moves update the URL without re-running loaders (`shouldRevalidate`).
- **Client cache**: points are fetched for the view padded by 25 %; zooming in or small pans inside it with the same filters do not refetch. A 429 shows a gentle message and retries after `Retry-After`.
- **API**: `GET/POST /api/v1/map/points` (cap 3,000 + `truncated`; adds `rent_period` to the SPEC's point properties), `GET /api/v1/listings` (cards in the page language), `GET /api/v1/areas/tree | outlines | at`. One Zod schema for URL, loader and API (`app/shared/schemas/mapSearch.ts`); published listings and `display_point` only, explicit fields (no phone, true point, address or identifiers — tested). Self-crossing polygons are refused (400).
- **Rate limits**: `/map/points` has its own 60/min per IP and is not counted in the general 100/min; listings and area calls stay under 100/min.
- **Page**: server-rendered first paint (results, count, address path); desktop split view with the list on the start side; mobile full-screen map with a three-position bottom sheet, filters sheet and a bottom nav with Map and the account link only (Saved/Add/Profile come with milestones 6 and 8).
- **RTL lint rule** extended: physical keys/values in JSX `style` objects, MapLibre `addControl(…, "top-left")` corners and left/right `Popup`/`Marker` anchors.
- **Theme**: new token `--color-on-accent` for text on gold/teal/purple (pins, badges); the gold buttons now use it, fixing light-on-gold text in the light theme.
- Fixed while testing in a browser: MapLibre 6's worker is now served as a bundled asset (`setWorkerUrl`) — without it the map failed to load in both dev and the production build; pin images use `setMissingStyleImageResolver` (the `styleimagemissing` event only served the first tile, so most pins were invisible); the map container is sized explicitly (MapLibre's CSS overrides `position`).
- New dependencies (BSD/MIT, no install scripts): `maplibre-gl`, `terra-draw`, `terra-draw-maplibre-gl-adapter`, `zustand`.
- Tests: 359 unit (search schema/URL round-trip, polyline, geometry, price labels and formatting, points cache, basemap label rewrite and theme swap, control positions, new lint rule cases) and 102 database/HTTP (published-only, display point never the true point, every filter, polygon search, invalid input, paging/sorting/language fallback, area tree/outlines/path per zoom, the separate 60/min limit). Browser check in Edge (headless) against the dev server and the production build: ar/en × dark/light, drill-down path, no refetch on zoom-in, URL state, filter refetch, mobile sheet and nav, worker and attribution.

### Known gaps
- Listing cards are not links yet: the detail page arrives in milestone 5. There are no photos until the submit wizard (milestone 6), so cards show a category icon.
- The map chunk is ~1.2 MB (≈320 kB gzipped) plus a ~550 kB worker, loaded only on the map page.
- The overlay panels (address path, jump-to, tools) can cover pins near the top of the map on small screens.
- The site has no favicon yet (`/favicon.ico` → 404; not new).
- Vite's dev live-reload socket fails when another dev server already uses its port (24678) — development only.
