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

## Hotfix — dev server (2026-11-27)

- **Symptom:** `npm run dev` answered every page with "App services are not set (provideServices must run first)".
- **Cause:** a dev server process started before pulling milestones 3–4. `tsx` does not reload `server/index.ts`, but Vite reloads `server/app.ts` and the routes from disk on every request, so new route code ran inside the old Express app, which never set the services. A freshly started `npm run dev` worked (Windows, Node 24).
- **Fix:** `npm run dev` now runs `tsx watch`, so the server restarts when server code changes (e.g. after `git pull`). The React Router handler and its `getLoadContext` are now created in `server/createServer.ts` for both modes (dev: Vite's `virtual:react-router/server-build`; production: React Router's default `build/server/index.js`) and close over this process's services, so `provideServices`/`res.locals.services` and `server/app.ts` are gone.
- **Test:** `server/createServer.db.test.ts` builds the real development setup (Vite middleware, React Router, auth) against the test database and renders `/ar/jo/map`, `/en/login` and `/`.

## Milestone 5 — Listing detail page (2026-11-27)

- **Page** `/:lang/property/{id}-{slug}` (server-rendered): gallery, title, price and price per m², type/category badges, breadcrumb from the area hierarchy (each step opens the map there) plus the address fields the listing allows (§4.3), features grid (land hides rooms/floors), amenity chips (fixed tag list `AMENITY_TAGS`), description, location map (pin for exact listings, a ~300 m circle for approximate ones, loaded when scrolled near), proxy contact (call / WhatsApp, sticky bar on mobile), save, share (native share where available, copy link, WhatsApp), view count, owner/agent card (initials avatar, member since, company + verified badge; never a phone or email; individuals — owners and admins — show their **first name only**, agents their full name with the company, in the page and the API), similar listings. Title, meta description and canonical link (JSON-LD, Open Graph and hreflang are milestone 9). A missing or wrong slug redirects (301) to the canonical URL.
- **Visibility:** `published`, `reserved`, `sold` and `rented` are public; reserved/sold/rented show a status banner, and sold/rented show no contact number. `draft`, `pending`, `rejected` and `archived` are 404, except for the owner and admins, who get a preview with a banner, `<meta name="robots" content="noindex">`, `X-Robots-Tag: noindex` and `Cache-Control: private, no-store` (page and API).
- **Gallery** (own component, no new dependency): native scroll-snap swipe that mirrors in RTL, arrow keys in reading direction (in Arabic ← is next) plus Home/End, thumbnail strip, full-screen lightbox (`<dialog>`, Esc closes), only the current photo and its neighbours loaded.
- **Contact** (`contactService.resolveContactNumber`, SPEC §8): property → area and each ancestor → country → global, active numbers only. **`properties.contact_number_id` is dropped** (migration `20261128000100`, existing values carried over first): a listing's own number is a `contact_numbers` row with `scope = 'property'`.
- **Views** (`viewService`): the page reports a view from the browser after it loads (bots and prefetches don't count); at most once per visitor per listing per rolling 24 h; never the owner or admins; only public listings. The visitor is an HMAC of a first-party httpOnly `aqar_vid` cookie (or of the IP without cookies); raw ids are never stored. `POST /api/v1/listings/:id/view` has its own limit (30/min per IP, not counted in the general 100/min) and always answers 204.
- **Similar listings:** published only, same category and type, nearest 4 within 5 km (`ST_DWithin`), the rest filled from the same city, newest first.
- **API:** `GET /api/v1/listings/:id`, `GET /api/v1/listings/:id/similar`, `POST /api/v1/listings/:id/view`, `PUT`/`DELETE /api/v1/listings/:id/save` (signed in; public listings only). One public serializer (`listingService.getListingDetail`) with an explicit field list for the page loader and the API.
- **Map:** result cards (and the mobile mini card) link to the detail page; cards carry `slug`.
- **Seed:** listing photos are SVG placeholders generated locally into `UPLOAD_DIR/seed` (nothing downloaded); listings now have amenities and apartment numbers (`admin_only`).
- `publicOrigin` (from `PUBLIC_BASE_URL`) is passed to loaders through the load context for absolute URLs; MapLibre's one-time setup moved to `app/components/map/mapSetup.ts` (shared by both maps).
- Tests: 371 unit (listing URLs, contact links, circle ring, visitor ids/hashes/cookie, public owner name) and 129 database/HTTP. New: the API and the **rendered page HTML** never contain the owner's phone (in any written form), the true point of approximate listings, property identifiers, `admin_only` fields, `exact_only` fields of approximate listings, or an individual owner's full name (or surname); visibility and preview headers; contact resolution order; view counting (dedupe, rolling 24 h across midnight, owner/admin, statuses, 429); similar listings; save/unsave; slug redirect and 404s. Browser check in Edge (headless) on the dev server: ar/en × dark/light, desktop and mobile, gallery keys/swipe/lazy loading/lightbox, approximate circle, save toggle, card links.

### Known gaps
- No photos are uploaded yet (milestone 6); listings without photos show a placeholder panel.
- Similar listings fill up from the listing's `city` level; a listing with no city in its path only gets nearby ones.
- The view count shown is the stored counter as of the page render (it does not update live).
- Pre-existing, seen while testing: `/en/login?next=…` logs a React hydration warning because the header's language/login links encode `next` differently on the server and in the browser.

## Spec update — missing features and revenue model (2026-11-27, docs only)

- **Text search** (SPEC §5.6, new milestone **4b**, scheduled right after milestone 6): bilingual free-text search over titles, descriptions and area names with Arabic normalization (`أ/إ/آ → ا`, `ة → ه`, `ى → ي`, diacritics removed) and typo tolerance, location autocomplete over `admin_areas`, and "near me" (browser location on user action only). PostgreSQL only: full-text search + `pg_trgm`.
- **Milestone 7 additions** (§9): agent applications (approval sets `role = agent` and links/verifies the company), enquiry log (caller data encrypted; listers see counts only; enquiries let a deal be traced to AQAR), append-only `audit_log` for every admin action, real-phone view, commission change and failed login.
- **Milestone 8 additions** (§11): agent dashboard and owner statistics.
- **Revenue model** (new §19, §0): commission on concluded deals, paid by the lister (agent or owner), 1 % by default and configurable per country, stored per deal; terms accepted at submission (milestone 6); final price captured when marking sold/rented (milestone 8, admin correction in 7); `commissions` table, admin commission screens and invoices (milestone 7), "My commissions" for listers (milestone 8); manual collection in phase 1. Brokerage licensing and the terms need legal review. Open questions listed (exchange deals, deals outside AQAR enquiries, sales tax/invoicing).
- **Launch readiness** (new §20, milestone **11**): free-tier email provider, email verification, password reset, new-device login notice, personal-data export and account deletion (Jordan PDPL). No SMS OTP in phase 1. **Deployment** becomes milestone **12** (§18).
- **Phase 2** (§12): price insights, home/discovery page, CSV bulk upload, follow agents/companies, admin broadcasts, daily interest notifications, email notifications, ownership documents, "Get directions", online commission payment, compare up to 4 (to decide), PWA with push, SMS OTP as a later option.
- Related updates: roles (§3), listing fields and status rules (§4.1–4.2), submission step 5 (§7), security notes (§13), email variables in the environment example (§16).
- **Closing a listing** (§4.1–4.2, §9, §19): archiving a published or reserved listing asks for a reason (`close_reason`: sold/rented through AQAR, elsewhere, or no longer available; stored with `closed_at` and audited). "Through AQAR" goes to the final-price step and ends as `sold`/`rented` with a commission record, like marking sold/rented directly. The admin commissions screen (milestone 7) lists archived listings that had enquiries, for follow-up.
- **Decisions:** unverified accounts cannot submit listings once email verification exists (milestone 11; until then submission is allowed). Exchange deals carry no commission at launch (revisit later).
- Fixed §4.1: `properties.contact_number_id` (dropped in milestone 5) is removed from the field list; a listing's own proxy number is a `contact_numbers` row with `scope = 'property'` (§8).

## Design refresh (2026-11-27, before milestone 6)

- **Brand files** in `public/brand/` (logo, mark, favicon SVGs in light and dark versions, plus a preview image). The header shows `aqar-logo.svg` in light mode and `aqar-logo-dark.svg` in dark mode, and only the mark below 400 px wide; alt text "عقار – AQAR" (i18n key `header.logoAlt`).
- **Fonts:** IBM Plex Sans Arabic (Arabic) and IBM Plex Sans (Latin), weights 400/500/600/700, self-hosted via `@fontsource` (OFL). Cairo and DM Sans are removed.
- **Palette** (SPEC §14): new light and dark tokens; the token names are kept and new ones added (`border`, `primary-hover`, `on-primary`, `secondary`, `secondary-hover`, `on-secondary`, `accent`, `warning`, `sale`, `rent`, `exchange`, `pin-outline`). **Light is now the default theme** (dark stays available via the toggle); the `users.theme` column default follows (migration `20261128000200`).
- **WCAG AA:** dark `primary` (#A04A5A) and `error` (#B3261E) are too dark for text on the dark backgrounds (≈2.7:1 and 2.4:1), so text in those colours uses new `primary-text` / `error-text` tokens (light: the same colours; dark: #E0949F and #F2827A, ≥ 5.9:1). Form-control borders use `muted` (≥ 3:1, WCAG 1.4.11) instead of the decorative `border`. Primary buttons darken to `primary-hover` on hover. `app/theme.contrast.test.ts` checks every token pair the UI uses in both themes.
- **Map pins:** sale #7A3542, rent #3E586E, exchange #6C6251 with white labels (≥ 6:1), a light outline that keeps them readable on the dark basemap and between overlapping pins, and an accent ring for featured listings (the hovered pin gets a ring in the text colour). Outlines, drawn areas and the approximate-location circle use the AA-visible brand tint.
- **Icons:** `npm run icons` (`scripts/generate-icons.ts`, sharp, a new dev dependency) generates `favicon.ico` (16/32/48, PNG inside ICO), `apple-touch-icon.png` (180, opaque), `icon-192.png`, `icon-512.png` and `site.webmanifest` (brand colours) from `aqar-favicon.svg`; the outputs are committed. The root route links them and sets `<meta name="theme-color">` per theme. This closes the missing-favicon gap.
- Docs: SPEC §14 (palette table, contrast rules, fonts, logo, icons) and the §5.2 pin colours; CLAUDE.md (light default, text/border tokens, fonts).
- Tests: 393 unit (+ contrast guard for both themes, ICO writer, committed icons/manifest) and 129 database/HTTP. Browser check in Edge (headless) against the dev server: map, listing detail (exact and approximate), login (with errors), register and 404 in ar/en × light/dark × desktop/mobile (48 combinations), each run through axe-core (`color-contrast`, `image-alt`, `link-name`, `button-name`, `label`, `document-title`, `html-has-lang`) with no violations; fonts, logo switching and map pins/circle checked on screenshots.

### Known gaps
- axe cannot measure text drawn inside the map canvas (pins, area labels); pin contrast is checked on the token values and screenshots.
- The 404 page (root error boundary) has no header or logo (unchanged).

## Milestone 6 — Submit wizard (2026-11-28)

- **Pages:**
  - `/:lang/listings/new`: step 1 creates the draft; it also lists the lister's drafts to continue or delete, and today's remaining submissions. Works without JavaScript.
  - `/:lang/listings/:id/edit?step=type|location|details|photos|review`: the wizard. Owner-only (others get 404), `Cache-Control: private, no-store`, `noindex`.
  - `/:lang/terms/commission`: placeholder terms in Arabic and English, rate from `countries.commission_rate`, marked "draft — pending legal review".
  - Entry points: "Add listing" in the header (a "+" icon on narrow screens) and "Add" in the mobile bottom navigation. Visitors log in first; admins are told they can't list.
- **Owner API** `/api/v1/my/listings` (Zod everywhere, always `private, no-store`): create, get, save one step (`PATCH`), delete a draft; upload, reorder and delete photos; submit.
- **Location step:**
  - Governorate/city jump, then click to place and drag to move the pin. A click from far out zooms in.
  - The server looks up the area path on save; a pin more than 5 km outside every area is refused (`out_of_area`), and the fallback flags it for review.
  - **Every listing is shown publicly as an approximate area (business decision).** There is no exact/approximate choice. The public point is computed once per pin move and stored. The lister sees their exact pin and the ~300 m public-preview circle.
  - Owners and admins may see and drag the true pin in the editing flow only (CLAUDE.md rule 2 exception).
  - The country's typed address fields and identifiers come from its settings, each labelled with its visibility. `exact_only` fields are now never public: they are shared at the viewing, in a later milestone. Invalid fields are reported and not saved, while the rest of the step is saved.
- **Details step:** price checked against the currency's decimals; features adapt to the category (land hides rooms and floors); amenities; Arabic and English title and description.
- **Photos:**
  - Resized in the browser first (≤ 2000 px; the canvas re-encode drops EXIF), then uploaded with `multer` (in memory, ≤ 10 MB, one file per request).
  - The server checks the format from the content with sharp: JPEG, PNG and WebP only, so SVG, GIF, TIFF and renamed files are refused. A 50 MP pixel limit guards against decompression bombs.
  - Re-encoded to WebP ≤ 2000 px plus a 400 px thumbnail, with all metadata (including GPS) removed. At most 2 images are processed at a time.
  - ≤ 20 per listing; reorder by drag-and-drop or the earlier/later buttons; the first is the cover.
  - Stored through the new `storageService` (`LocalDiskStorage`, `UPLOAD_DIR/listings/{id}/{random}.webp`; keys are generated, checked and never overwritten). Deleting a photo or a draft deletes its files.
  - **At least one photo is required, except for land** (optional, with a warning).
- **Drafts and autosave:** a step saves 1.2 s after the last change (choices and the pin at once). Saves run one at a time, failed saves are retried, and pending changes are saved before changing step or submitting. At most 10 drafts per user.
- **Review and submit:**
  - Missing items link back to their step. A summary, offers visibility, and the phone shown **masked** (`+962 •••••••67`) with "use a different number" — a new number goes only into the submit request and is never sent back.
  - The required **commission-terms** checkbox, version `2026-11-draft`.
  - Submit runs in one transaction: it locks the lister, re-validates everything, stores the phone encrypted (or copies the profile phone's ciphertext), and records `commission_payer_type` (from the submitter's role), the terms version and the acceptance time, the slug (category-type-area, no personal data) and the first price-history row. The status becomes `pending`.
- **Limits (business decision):** **no limit on active listings** (the 5-listing owner limit is removed). Instead, `SUBMISSIONS_PER_DAY` (default 10) submissions per user per rolling 24 h, counted in the database so restarts don't reset it; 429 with `Retry-After`. Photo uploads: 30/min per user.
- **Migration** `20261128000300`:
  - Existing exact listings get an approximate public point (computed once), and a CHECK keeps `location_precision = 'approximate'`.
  - Commission fields on `properties`; `countries.commission_rate` (default 0.01); an index on `(owner_id, status)`.
- **Docs:**
  - SPEC: §0, §2.3, §3, §4.1, §4.3, §4.4 (photo rule), §7, §10, §12, §13, §16, §17; milestone 11 now says the server must refuse to start in production while the terms version is a draft.
  - CLAUDE.md rule 2 (editing-flow exception; only `public` address fields are ever public); `.env.example` (`SUBMISSIONS_PER_DAY`).
- Dependencies: `sharp` moved to runtime dependencies; `multer` (MIT) added. Neither has an install script.
- **Tests:** 413 unit and 152 database/HTTP.
  - Unit tests:
    - The step schemas and the completeness rules, including photos except land.
    - Decimals and masked phones.
    - Image processing: EXIF/GPS removed after orientation; GIF/TIFF/SVG/non-images refused; size and pixel limits.
    - Storage keys: no path traversal, no overwrite.
  - Database/HTTP tests:
    - Owner-only access and 404s; the draft limit; no active-listing limit.
    - The submission rate and its window.
    - Pin and area, with the public point stored once per pin move; out-of-area pins.
    - Address and identifier validation; price decimals.
    - Photos: WebP without EXIF, reorder, delete, 20 max, the per-user upload limit; files removed with the draft.
    - Submit errors (incomplete, terms, outdated terms, phone) and the full submit, with no phone echoed.
    - The pages: login redirect; private headers; masked phone with no full number in the HTML; the no-JavaScript form; the terms page.
  - Existing privacy tests now assert that every listing is approximate and that no `exact_only` field is public.
- **Browser check** in Edge (headless), on a separate throwaway database:
  - The full flow (log in → type → pin → address → details → 2 photos → reorder → review → refused without terms → submit) in English light desktop and Arabic dark mobile.
  - axe-core (contrast, labels, names, ARIA) on every step and on the terms page: no violations.
  - Found and fixed: duplicate ids in the details step, and the terms version reading backwards in Arabic (now isolated as LTR).

### Known gaps
- Editing rejected or published listings (resubmission; back to pending on price, pin or photo changes) comes with milestone 8, as agreed.
- The terms text is a placeholder pending legal review. The startup check that refuses a draft version in production is milestone 11.
- An animated WebP or APNG upload keeps only its first frame (sharp decodes one frame).
- The narrow-mobile header is crowded (logo, add, language, theme, name, log out); a profile menu comes with milestone 8.
- Pre-existing: the `/en/login?next=…` hydration warning (unchanged).

## Spec update — business model v2 (2026-11-28, docs only)

- **Roles** (§3): `super_admin` (replaces `admin`), `supervisor` (AQAR employees, created only by the super_admin, each with a geographic scope of one or more areas, possibly across countries; they see only data in scope), `agent` (brokers and companies), `owner`, `financier` [P2]; visitors. Agent registrations need approval by the area's supervisor (`submitted → under_review → approved | rejected | info_requested`); owners self-register; suspend/reactivate by the super_admin; status history.
- **Listings** (§4): assigned on submission to the supervisor whose scope contains the area (deepest match; else the super_admin's queue; reassignable). New status **`returned`** (returned for changes). Price/pin/photo edits → re-review. "Sold through AQAR" now opens a deal for the supervisor. No location choice: every listing is public as an approximate area; the exact location is shared by the supervisor at a confirmed viewing. `offers_visibility` removed.
- **Contact** (§8): the public number is the assigned supervisor's work mobile (`contact_numbers` as fallback). All communication goes through the supervisor; listers never receive buyers' details. Supervisors see the lister's phone for listings in scope (audited).
- **Back office** (§9, was "Admin panel"): one back office for the super_admin and supervisors, scope-filtered.
- **New sections:** Offers (§21; per-country minimum, default 80 %; supervisor review and relay; the public sees only the count and the highest approved amount), Enquiries & viewings (§22), Deals (§23; asking, accepted and final prices kept separately; only verified final prices feed analytics), Currency display (§24; "≈", no margin), Financing (§25; calculator in phase 1; licensed banks/brokers [P2], no fee to AQAR, a clearly labelled "AQAR customer benefit"), Workflows, status history & reminders (§26; fixed workflows, `status_history`, 48 h overdue reminders), Later phases (§27).
- **Revenue** (§19): commission per country, overridable per agreement; due when a deal completes; supervisor share from confirmed collections only; payments recorded with proof by the supervisor and confirmed by the super_admin; super_admin approval for waivers, downward price corrections, refunds and deal cancellations; cancellation refund = collected commission − 10 % administrative fee (configurable).
- **Build order** (§18): 7 back office & supervisor model, 8 profile, 9 enquiries & viewings, 10 offers, 11 deals/commission/collections, 12 currency display & financing calculator, 13 SEO, 14 hardening, 15 launch readiness, 16 deployment; then [P2]/[P3]. References to the old milestone numbers in the SPEC are updated.
- **CLAUDE.md:** rule 1 (lister phone to the super_admin/supervisor in scope; buyers' details), rule 2 (who sees the exact pin; sharing at a confirmed viewing), rule 4 (`returned`; status history), rule 5 (display conversion), new rule 10 (roles and scope; super_admin approvals).

## Design v2 + brand update (2026-11-28)

- **Brand:** platform "AQAR" / "عقار" (titles, manifest); operating company "شركة الذكاء العقاري – Aqar Intelligence" in the new footer and on the terms page (i18n `brand.company`). New logo/mark/favicon files; old preview image removed; icons regenerated (manifest name "AQAR", theme colour #154E75; `<meta name="theme-color">` follows the header).
- **Header:** navy `header` token (#154E75 / dark #0F2A3D), white controls, translucent country chip, amber "أضف إعلانك / Add listing"; `aqar-logo-dark.svg` in both languages, mark below 400 px; alt "AQAR – شركة الذكاء العقاري". Filter bar on `card` with a bottom border.
- **Palette** replaced (names kept; new `accent-hover`, `header`, `on-header`, `map-water`, `map-green`). AA tints where needed: dark `primary-text` #E8A0AE, dark `on-secondary` #121519. Contrast test updated (white on header, ink on amber/exchange).
- **Map:** callout pins with tail, white 2px outline, soft shadow, larger when hovered, amber ring for featured; exchange pins amber with dark ink. Clusters in primary with white count, ring and halo, darker on hover. Area hover and drawn area: primary 2px, 8 % fill. Basemap water/green tinted (light and dark). Layer colours are re-applied after a theme switch (they used to keep the previous theme's colours).
- **Cards:** image on top (4:3; type-colour gradient with a category icon when there is no photo), large primary price, solid type badge, facts with `lucide-react` icons (ISC), lift on hover; two-column results grid; 4-column similar listings.
- **Seed:** colourful per-category SVG placeholders (`server/db/seedPlaceholders.ts`).
- **Mobile filter row:** under the header on the map page, the listing-type chips (All / For sale / For rent / Exchange, scrolling sideways) and the filters button with a count badge (moved out of the map overlay).
- **Motion:** 150–200 ms transitions; global `prefers-reduced-motion` rule.
- Docs: SPEC §14 and §5.2, CLAUDE.md conventions.
- Tests: 420 unit (incl. contrast guard, basemap tint, pin stretch zones, placeholders) and 152 database/HTTP. Browser check (throwaway database): map, listing, login, register, 404 × ar/en × light/dark × desktop/mobile — axe-core: no violations; pins, cluster hover, card ↔ pin, theme switch and water tint checked on screenshots.

### Known gaps
- Pins are drawn without a visible size animation (the hovered pin is redrawn larger).

## Milestone 4b — Text search (2026-11-28)

- **Search bar** on the map page (desktop filter bar; mobile row above the type chips): one bilingual free-text box (`q`, ≤ 100 characters), an ARIA combobox with **location autocomplete** (`GET /api/v1/areas/suggest`, up to 8 areas of every level with their path, e.g. "عبدون، عمان"; choosing one flies the map there instead of filtering by text), and **"near me"** (browser location only when pressed, rounded to 3 decimals; radius 1/2/5/10 km, default 2; the radius circle is drawn on the map).
- **Scope** (decision): `q` searches the whole country and the map fits to the results (`bbox` of all matches on the points response); "Search this area" limits it to the view (`in=view`), "Search all of Jordan" goes back; a drawn polygon or near me limits `q`; near me and a polygon are mutually exclusive. New sort "Best match" (`relevance`, the default with `q`). Result counts read "N properties found" for country-wide and near-me searches.
- **PostgreSQL only:** `pg_trgm`; `aqar_normalize_ar()` (diacritics, tatweel, alef forms, ة/ى, Arabic-Indic/Persian digits, lower case; TS twin `app/shared/normalizeText.ts`); trigger-kept `properties.search_tsv` (`arabic`/`english`/`simple`, titles A, area path B, descriptions C/D; GIN) and `search_norm` (normalized titles + area path; GIN trigram), refreshed when an area on the path is renamed or moved; `admin_areas.search_norm` (generated; GIN trigram). Every query word must match by full-text or by trigram word similarity (0.6, the pg_trgm default — tuned in tests: typos like "عبدوم"/"abdon" match, "عمان" matches exactly the Amman listings); stop words are skipped; only published listings.
- **Rate limits:** `/areas/suggest` has its own 120/min per IP (not counted in the general 100/min).
- **Privacy:** request logs redact `near`, `lat` and `lng` (`server/middleware/requestLog.ts`); the location is never stored.
- **Contact details in listing text** (new business rule, SPEC §8.1, CLAUDE.md rule 1): shared detector `app/shared/contactDetails.ts` (phones in any digit form and separator, +962/00962/07, emails, links incl. bare domains and `wa.me`/`t.me`, `@handles`, WhatsApp/Telegram/Instagram/Facebook mentions in Arabic and Latin). This milestone: **masked as `•••` in all public output** (result cards, listing title/description incl. meta tags) and **never indexed** (`aqar_strip_contacts()`, built from a snapshot of the detector's patterns; a database test checks SQL and TS agree). The moderation-queue flag and its audit entry come with milestone 7; OCR of photos is [P2].
- Test configs exclude `.claude/**` (Claude Code worktrees with their own `node_modules` were being collected and failing).
- Seed: one listing has a phone number and "واتساب" in its description, to show the masking.
- Docs: SPEC §0 (production needs `postgresql-contrib`), §5.6 (decisions), new §8.1, §9, §12, §13, §18 (milestones 7 and 16); CLAUDE.md.
- Tests: 477 unit (detector fixtures and clean texts, normalization, search state, log redaction) and 175 database/HTTP (SQL normalization/stripping parity, index triggers, text search variants/typos/area path/stop words, masking, near-me radius, suggest ranking and rate limit). Server-rendered check on a throwaway database: country-wide, in-view and near-me pages in `/ar` and `/en`, masking on the listing page, redacted log lines.

### Known gaps
- No interactive browser check of the search box, suggestions and near me this time (the browser extension was not connected); typecheck, lint and server-rendered pages are clean.
- Detection is pattern-based: numbers spelled out in words and deliberately obfuscated addresses ("name at gmail dot com") are not caught; very long digit runs (e.g. a written price range "150000-200000") are masked as phones.
- Renaming an area bumps `updated_at` on the listings under it (their search columns are refreshed).
