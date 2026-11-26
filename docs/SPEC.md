# AQAR (عقار) — Product & Technical Specification

Map-based real estate website for Jordan and the Gulf, Arabic-first (RTL) with English (LTR).

> This spec replaces the original Replit prompt. Build it **one milestone at a time** (see §15).
> Phase 1 = everything not marked **[P2]**. Phase 2 items are specified so the data model is ready for them, but they are not built in phase 1.

---

## 0. Key decisions

| Topic | Decision |
|---|---|
| Product shape | **The map is the website.** Home page = map search. List views exist, but every search is map-driven. |
| Frontend | React 19 + **React Router v7 (framework mode, SSR)** + TypeScript + Vite + Tailwind CSS |
| Backend | Node.js + Express, hosting the React Router request handler **and** a REST API at `/api/v1` (one server, one repo) |
| Database | PostgreSQL 16 + **PostGIS** |
| Maps | **MapLibre GL JS** + **OpenFreeMap** vector tiles (style URLs from env) — no paid APIs |
| Markets | Multi-country. Phase 1 launches **Jordan**; Saudi Arabia, Kuwait, UAE exist in the schema with `is_active = false` |
| Currency | One currency per country (JOD, SAR, KWD, AED). Not selectable per listing. All searches are scoped to one country. |
| Offers visibility [P2] | Chosen **per listing by the owner**: `public` / `amounts_only` / `private`. Bidders may also choose to appear as "مجهول". |
| Location privacy | Chosen **per listing by the owner**: `exact` pin or `approximate` (~300 m) |
| Dev environment | VS Code + Claude Code, PostgreSQL/PostGIS via Docker, `.env` for secrets |
| Software & services | **All software is free / open source; only hosting is paid.** No paid third-party services or APIs. |
| Hosting | **One Linux VPS** (provider TBD, e.g. GoDaddy VPS) running **Node 24 LTS** (app), **PostgreSQL 16 + PostGIS** (database) and **Caddy** (reverse proxy, automatic HTTPS). Port read from `process.env.PORT`. `engines.node` is `>=24 <25` (Node 24 LTS). |
| Production database | PostgreSQL 16 + PostGIS **on the same VPS**, connected via `DATABASE_URL` (listening on localhost only). Docker PostGIS (`docker-compose.yml`) is for local development. |
| Image storage | Always behind the storage interface. **`LocalDiskStorage` in development and production** — on the VPS, files live on its disk under `UPLOAD_DIR` and are served at `/uploads`. |
| Backups | **Nightly** `pg_dump` of the database and a copy of `UPLOAD_DIR`, kept off the VPS (destination TBD with the provider). |

---

## 1. Tech stack details

- **Language:** TypeScript everywhere (`strict: true`).
- **Routing/SSR:** React Router v7 framework mode. Public pages (map, listing detail, SEO pages) are server-rendered. Use loaders/actions for page data; the same service layer also backs `/api/v1`.
- **Server:** Express app using `@react-router/express`. Mounts:
  - `/api/v1/*` → REST API (JSON, used by client-side map interactions and future mobile apps)
  - `/uploads/*` → static images from `UPLOAD_DIR` (`LocalDiskStorage`); in production Caddy serves this path straight from disk
  - `*` → React Router handler
  - socket.io on the same HTTP server **[P2]**
- **DB access:** Knex (migrations + query builder). PostGIS operations via parameterized `knex.raw` with `?` bindings. **Never** string-concatenate SQL.
- **Validation:** Zod schemas shared between client and server (`/app/shared/schemas`).
- **Styling:** Tailwind CSS using logical utilities (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`, `text-start`) plus `rtl:`/`ltr:` variants. No left/right utilities for layout.
- **State:** Zustand for client-only state (map view, filters, compare tray [P2]). URL search params are the source of truth for map position and filters.
- **i18n:** URL-prefixed locales `/ar/...` (default) and `/en/...`. Translation files `app/i18n/ar.json`, `app/i18n/en.json`. `<html lang dir>` set server-side from the locale.
- **Images:** `sharp` on upload → WebP, max 2000 px long edge + 400 px thumbnail. Storage behind an interface: `LocalDiskStorage` (VPS disk under `UPLOAD_DIR`) in development and production. Code outside the storage service must not assume files live on local disk, so another backend can be added later without touching callers.
- **Map:** `maplibre-gl`, MapLibre RTL text plugin (for Arabic labels), built-in GeoJSON clustering, `terra-draw` (MapLibre adapter) for draw-to-search.
- **Tiles:** **OpenFreeMap** (free, no API key); dark/light style URLs from `MAP_STYLE_URL_DARK` / `MAP_STYLE_URL_LIGHT`. Show the OpenFreeMap / OpenMapTiles / © OpenStreetMap attribution. Do **not** use `tile.openstreetmap.org` (usage policy) or paid tile providers.
- **Testing:** Vitest (unit/service), Playwright (a few critical flows) — added from milestone 2 on.

---

## 2. Markets & geography

### 2.1 Countries
`countries (code PK char(2), name_ar, name_en, currency char(3), currency_decimals smallint, phone_prefix, default_center geography(Point,4326), default_zoom, is_active)`

Seed: `JO` (JOD, 3 decimals, active), `SA` (SAR, 2), `KW` (KWD, 3), `AE` (AED, 2) — Gulf inactive in phase 1.

### 2.2 Administrative areas (hierarchy + boundaries)
`admin_areas (id, country_code FK, parent_id FK nullable, level FK → address_fields.key, name_ar, name_en, name_en_reviewed bool, slug, boundary geography(MultiPolygon,4326), centroid geography(Point,4326), source ENUM[osm, generated, manual], source_ref, is_active)`

- **Levels are per country**, not a fixed list: they are the area-backed fields in the country's address settings (§2.3), in order. Jordan: governorate → city → area. Kuwait (later): governorate → area → block. A child's parent is the area one level up that contains it; if a level is missing, the next one up.
- GIST index on `boundary`. Unique `(country_code, parent_id, slug)` (nulls not distinct).
- `centroid` is `ST_PointOnSurface` (always inside the shape), used for labels and the nearest-area fallback.
- **Pin → location:** when a listing pin is set, the server finds the deepest `admin_area` whose boundary contains the point (`ST_Covers`) and stores `admin_area_id`. Higher levels are derived by walking up `parent_id`. The owner never types a location hierarchy.
- **Boundary data:** imported by `scripts/import-boundaries.ts` from GeoJSON files in `data/boundaries/{country}/` (sources, queries, dates and licences recorded in `data/boundaries/{country}/SOURCES.md`). `source` records where each boundary came from: `osm` (OpenStreetMap, ODbL — the site credits "© OpenStreetMap contributors"), `generated` (derived by the import, e.g. nearest-point cells), or `manual` (drawn by an admin). Generated boundaries are meant to be replaced by an admin later; admin boundary editing is **[P2]**, phase 1 ships with a read-only boundary viewer.
- **Jordan:** governorates = OSM `admin_level=4`. Cities = union of the city's OSM districts (`admin_level=5`): Amman = Qasabah + Marka + Quaismeh + Al-Jami'ah + Wadi Essier; Irbid, Zarqa, Aqaba = their Qasabah district. Amman areas = one cell per OSM neighbourhood point (`place=neighbourhood`, 146 points; nearest-point/Voronoi cells clipped to the Amman city boundary), plus Jubeiha (not in OSM); the 21 Greater Amman municipal districts (`place=suburb`, e.g. منطقة تلاع العلي) are not imported — they are recorded in `SOURCES.md` for a later optional level between city and area; an area with a real OSM polygon (e.g. Dabouq) keeps it. English names missing in OSM are transliterated from Arabic with `name_en_reviewed = false` for admin review.
- Fallback: if a pin falls outside every boundary, store the nearest area (`ST_Distance` to centroid, within 5 km) and flag the listing for admin review.

### 2.3 Address fields (admin-configured per country)
The admin decides which fields describe an exact address in each country, in what order, and who may see them.

- `address_fields` — catalog of every field the platform supports: `key PK`, `kind ENUM[admin_area, text, number, identifier]`, `label_ar`, `label_en`, `pattern` (optional regex), `strip_leading_zeros bool` (identifiers).
  - `admin_area` fields (governorate, city, district, area, block) are filled from the pin (§2.2), never typed.
  - `text` / `number` fields (street, avenue, building number, floor, unit number, postal code) are typed by the owner.
  - `identifier` fields are property/unit identifiers (§2.4).
- `country_address_fields (country_code, field_key, position, is_required default false, visibility ENUM[public, exact_only, admin_only], map_min_zoom, is_active)`, PK `(country_code, field_key)`. `map_min_zoom` applies to `admin_area` levels (map drill-down, §5.2). `visibility` applies to `text`/`number` fields; identifiers are never public regardless.
- Typed (non-identifier) values are stored in `properties.address jsonb` (`{field_key: value}`), validated by a Zod schema built from the country's settings.
- Jordan default: governorate, city, area (from pin) · street, building number (`exact_only`) · apartment number (`admin_only`) · land-registry identifier (§2.4). No floor field: the floor is the public feature `floor_number` (§4.1).

### 2.4 Property identifiers (GIS / unit IDs)
`property_identifiers (id, property_id FK, country_code FK, scheme FK → address_fields.key, value, value_normalized, verified_by FK users nullable, verified_at nullable, created_at)`, unique `(property_id, scheme)`, index `(country_code, scheme, value_normalized)` for duplicate detection (admins see "other listings with the same identifier").

- **Only property/unit identifiers — never personal civil IDs.** E.g. Kuwait PACI address number (الرقم الآلي للعنوان), never الرقم المدني.
- Schemes: Jordan land registry `jo_land_parcel`, Kuwait `kw_paci`, Saudi National Address short code `sa_national_address`. UAE schemes depend on the emirate (Makani is Dubai only) and are deferred.
- **`jo_land_parcel`** is entered as parts and stored as `directorate/village/basin/parcel`, plus `/apartment` for apartment listings. A parcel number is only unique within its directorate, village and basin. **Duplicate = same full key.** The same parcel with different apartment numbers is not a duplicate; `identifierService` reports it to admins as a "same building" hint.
- **Normalization** (`value_normalized`, applied to each part separately for multi-part schemes): trim and remove whitespace, convert Arabic-Indic (`٠-٩`) and Persian (`۰-۹`) digits to Western, uppercase Latin letters, strip leading zeros where the scheme allows (`strip_leading_zeros`).
- **Who sees them:** owners and agents enter and see identifiers on their own listings; admins see all; **never public** (no public API response, loader data, or rendered HTML). Optional by default; the admin can mark a scheme required per country.
- **Verification:** an admin can mark an identifier verified (`verified_by`, `verified_at`).

---

## 3. Users & roles

JWT auth. Roles: `admin`, `agent`, `owner`.

| Role | Rights |
|---|---|
| **admin** | Approve/reject/edit any listing; see real owner phones (admin endpoint only); manage proxy contact numbers; manage users (suspend, change role); view analytics; delete any comment/offer [P2]; system notifications [P2] |
| **agent** | Unlimited listings; manage own portfolio (edit, delete, mark sold/rented); request featured placement; belongs to a `company` (name, logo, license, verified badge) |
| **owner** | Up to **5 active listings** (pending + published + reserved), enforced server-side; favorites; offers [P2]; comments [P2] |

Visitors (not logged in) can browse the map, view listings, and see the proxy contact number.

---

## 4. Listings

### 4.1 Fields
**Basic:** `title_ar`, `title_en`, `description_ar`, `description_en` (at least one language required; the missing one falls back to the other on display), `category ENUM[house, apartment, land, villa, commercial]`, `listing_type ENUM[sale, rent, exchange]`, `rent_period ENUM[monthly, yearly]` (rent only), `price numeric(14,3)` (null allowed only for `exchange`), `currency` (copied from country, not user input).

**Features:** `area_sqm`, `bedrooms`, `bathrooms`, `floors`, `floor_number`, `age_years`, `parking`, `garden`, `pool`, `elevator`, `furnished ENUM[yes, no, partial]`, `amenities text[]` (from a fixed tag list in i18n). Land listings hide room/floor fields.

**Location:** `point geography(Point,4326)` (true pin), `display_point geography(Point,4326)`, `location_precision ENUM[exact, approximate]`, `admin_area_id FK`, `address jsonb` (typed address fields per §2.3; replaces `street_ar/en`), `country_code FK`. Unit identifiers live in `property_identifiers` (§2.4).

**Contact:** `owner_phone_encrypted` (AES-256-GCM, pre-filled from the user's profile phone, editable per listing), `contact_number_id FK nullable` (property-level proxy override).

**Owner settings:** `offers_visibility ENUM[public, amounts_only, private]` default `amounts_only` [used in P2].

**System:** `status`, `rejection_reason`, `is_featured`, `featured_requested_at`, `view_count`, `slug`, `published_at`, `created_at`, `updated_at`, `needs_location_review bool`.

### 4.2 Status (single vocabulary — use these exact values everywhere)
`draft → pending → published | rejected`, then `published → reserved | sold | rented | archived`.

- Submit → `pending`.
- Admin approve → `published` (+ `published_at`).
- Admin reject → `rejected` + `rejection_reason`; owner can edit and resubmit → `pending`.
- Owner can mark `sold` / `rented` / `archived`.
- `reserved` is set when an offer is accepted [P2].
- Any owner edit to price, pin, or photos on a `published` listing → back to `pending`. Edits to text/features stay published.

### 4.3 Location privacy
- `exact`: `display_point = point`.
- `approximate`: `display_point` = `point` offset by a random bearing/distance of 150–300 m, **computed once on save and stored**. Never recompute per request (averaging repeated random offsets would reveal the true point). Public map shows a ~300 m circle instead of a pin on the detail page.
- `point` is **never** returned by any public endpoint or loader. Public code reads only `display_point`.
- **Address details can reveal the location as precisely as `point`.** Typed address fields follow their `visibility` (§2.3): `public` always shown; `exact_only` shown only when `location_precision = exact`; `admin_only` never public. Property identifiers (§2.4) are never public. Public serializers use the allow-list of fields this rule permits for the listing.

### 4.4 Images
Up to 20 per listing; first = cover; drag-and-drop reorder; jpg/png/webp, max 10 MB each; client-side resize before upload; server converts to WebP + thumbnail.
`property_images (id, property_id FK, url, thumbnail_url, width, height, order_index, uploaded_at)` — cover = `order_index = 0`.

---

## 5. Map search (core feature)

### 5.1 Layout
- **Desktop (≥1024px):** split view — map ~60% / results list ~40% (list on the start side: right in Arabic, left in English). Filter bar above both.
- **Mobile:** full-screen map; results in a **bottom sheet** with three snap points (peek showing count, half, full). Bottom nav: Map, Saved, Add, Profile.
- Hovering a result card highlights its pin; clicking a pin scrolls/highlights the card (desktop) or opens a mini card (mobile).

### 5.2 Behaviour
- **Search as I move the map** (toggle, default on): on `moveend`, debounce 300 ms, query by current bbox.
- **Draw to search:** polygon tool (terra-draw). Active polygon replaces bbox filtering; "Clear area" button restores it.
- **URL holds state:** `/ar/jo/map?lat=31.95&lng=35.91&z=12&type=sale&cat=apartment&minPrice=50000&maxPrice=150000&beds=2,3&poly=<encoded>`. Any view is shareable and restorable on refresh.
- **Country switcher** in header flies the map to the country's default center and resets currency.
- **Jump to location:** governorate/city dropdowns (from `admin_areas`) fly the map to that area's bounds. No external geocoding API in phase 1.
- **Drill-down:** area outlines and labels appear by level as the user zooms in (each level's `map_min_zoom`, §2.3) — cities first, then neighbourhoods. The full address path of the area in view (country › governorate › city › area) is shown and updates while drilling down.
- **Pins:** price label in short form (`85K`, `1.2M`, `450/mo`), colour by listing type — sale = gold `#d4a843`, rent = teal `#2a9d8f`, exchange = purple `#8b7fd4`. Featured listings get a ring.
- **Clustering:** MapLibre GeoJSON source with `cluster: true`; cluster bubbles show count; click zooms in.
- Result count always visible ("124 عقار في هذه المنطقة").

### 5.3 Filters
Listing type, category, price range, area range, bedrooms (multi), bathrooms (min), amenities (pool, parking, garden, elevator, furnished), max property age, governorate/city. Sort (list only): newest, price ↑, price ↓, most viewed, price per m² ↑.

### 5.4 API
- `GET /api/v1/map/points?country=JO&bbox=minLng,minLat,maxLng,maxLat&<filters>` → GeoJSON `FeatureCollection` of `display_point`s with minimal properties `{id, price, currency, listing_type, category, is_featured}`. Cap 3,000 features; if exceeded return `truncated: true` and the client shows "zoom in to see all".
- `POST /api/v1/map/points` with `{ polygon: GeoJSON, ...filters }` for draw-to-search.
- `GET /api/v1/listings?country=JO&bbox=...|polygon=...&<filters>&sort=&page=&pageSize=20` → result cards (cover thumb, title, price, type, category, area name, beds, baths, area_sqm).
- Spatial predicates: `ST_Intersects(display_point, ST_MakeEnvelope(...)::geography)` / `ST_Covers(polygon, display_point)`. Only `status = 'published'`.

### 5.5 Indexes
GIST on `properties.display_point`; btree on `(country_code, status, listing_type, category, price)`; btree on `(status, published_at desc)`.

---

## 6. SEO pages

Google cannot read a map, so the site also generates server-rendered landing pages that link into the map:

- **Area pages:** `/ar/jo/amman/abdoun/apartments-for-sale` (country / city / area / `{category}-for-{type}`), with H1 like "شقق للبيع في عبدون", a server-rendered list of listings, a static-position map preview, and a "عرض على الخريطة" button opening the map at that area's bounds with filters applied.
- **Listing detail:** `/ar/property/{id}-{slug}` — SSR, `<title>`, meta description, Open Graph image (cover), JSON-LD (`schema.org` `RealEstateListing` / `Offer`), canonical URL.
- `hreflang` alternates for ar/en on every page; `sitemap.xml` generated from published listings and area pages; `robots.txt`.
- Only render area pages that have ≥1 published listing (avoid thin pages).

---

## 7. Listing submission (multi-step form)

1. **Type:** category, listing type (and rent period).
2. **Location:** pick governorate/city to fly the map, then **drop/drag a pin**. Show the detected area path live (server lookup). Fill the country's typed address fields and property identifiers (§2.3–2.4; required ones as configured by the admin), with a note on which are never shown publicly. Choose location privacy (exact / approximate) with a preview of what the public will see.
3. **Details:** price, features (fields adapt to category), amenities, titles/descriptions (ar/en tabs).
4. **Photos:** upload, reorder, choose cover.
5. **Contact & review:** confirm phone (shown with note "لن يظهر رقمك للعامة"), offers visibility setting, summary, submit → `pending`.

Drafts autosave (`status = draft`). Owner 5-listing limit checked before step 1 and again on submit.

---

## 8. Contact privacy & proxy numbers (critical)

- Owner's real phone stored **AES-256-GCM encrypted** (`ENCRYPTION_KEY` from env; store IV + auth tag with ciphertext). Also store `owner_phone_hash` (HMAC-SHA256, indexed) so admins can search by phone without decrypting.
- Phones are normalized to E.164 for the listing's/user's country before encrypting and hashing (`normalizePhone(input, countryCode)` in `app/shared/phone.ts`, prefix = `countries.phone_prefix`). Accepted input: the local format (JO `07XXXXXXXX`, KW 8 digits, SA/AE `05XXXXXXXX`) or international `+`/`00`; spaces, dashes, brackets, Arabic-Indic digits and a trunk `0` after the country code are tolerated. Only the normalized form is hashed, so every way of typing a number gives the same hash.
- Real phone is returned **only** by `GET /api/v1/admin/listings/:id/contact` (admin role).
- **It must never appear in:** any public API response, **any React Router loader return value** (loader data is serialized into the HTML), client state, localStorage, logs, or error messages. Public serializers use an explicit allow-list of fields — never spread DB rows into responses.
- `contact_numbers (id, phone_number, whatsapp bool, label, scope ENUM[global, country, admin_area, property], country_code, admin_area_id FK, property_id FK, is_active, created_by FK, created_at)`
- **Resolution order** (server-side `resolveContactNumber(listing)`):
  1. property-level number
  2. number on the listing's `admin_area`, then each ancestor (area → city → governorate)
  3. country-level number
  4. global default
- Public page shows the resolved number with **call** and **WhatsApp** buttons.

---

## 9. Admin panel (`/ar/admin`)

- **Moderation queue:** pending listings (thumbnail, title, price, submitter, area, submitted at, location-review flag); detail view with map showing true `point`; approve, reject (reason modal, reason shown to owner in "My Listings"), edit any field, bulk approve/reject.
- **Address settings:** per country, pick address fields from the catalog, order them, mark required, set visibility and map zoom levels (§2.3).
- **Property identifiers:** shown on the moderation detail view with a "verify" action and a warning when another listing has the same normalized identifier (§2.4).
- **Contact numbers:** table + create/edit; scope picker with area tree and property search; preview "which number would listing X get".
- **Users:** list with role, join date, listing count, status; suspend/unsuspend; change role; company verification for agents.
- **Boundaries viewer:** map of `admin_areas` per country/level, read-only in phase 1; highlights `source = generated` boundaries and English names with `name_en_reviewed = false`.
- **Analytics (basic in phase 1):** counts of listings by status, users by role, top viewed listings. Charts (by city, per month) **[P2]**.

---

## 10. Property detail page

Gallery (swiper + thumbnail strip + lightbox), title, price (+ price per m²), type/category badges, breadcrumb from admin area hierarchy (country › governorate › city › area) plus the typed address fields allowed by §4.3, features grid, amenity chips, description, map (pin or approximate circle), proxy contact (call / WhatsApp), favorite toggle, share (copy link + WhatsApp share), view count, owner/agent card (name, avatar, member since, company + verified badge — **no phone**), similar listings (same category & type, nearest 4 within 5 km via `ST_DWithin`, else same city).

View counting: increment at most once per visitor per listing per 24 h (cookie/IP hash).

---

## 11. Accounts & profile (phase 1 subset)

Tabs: **My Listings** (status badges, rejection reasons, edit/delete/mark sold-rented), **Saved** (favorites), **Settings** (name, email, phone, password, language, theme). Agents: company profile page with logo, listings map, verified badge.

`saved_properties (id, user_id FK, property_id FK, saved_at, UNIQUE(user_id, property_id))`

---

## 12. Phase 2 features [P2]

- **Offers:** on `sale` and `rent` listings; amount ≥ 80% of listed price (validated client **and** server, 400 on violation, message "الحد الأدنى للعرض هو {amount}"). `exchange` listings take a text "exchange proposal" instead of an amount. Visibility per `offers_visibility`: `public` = amount + name (or مجهول), `amounts_only` = amount + time only, `private` = owner and bidder only. Statuses pending/accepted/rejected/withdrawn; accept → listing `reserved`, other pending offers auto-rejected, all bidders notified. Real-time via socket.io room `property:{id}`.
  `offers (id, property_id, bidder_id, amount, currency, note, is_anonymous, status, created_at, decided_at)`
- **Compare:** up to 3 listings, floating compare tray, side-by-side table, best price per m² highlighted with a recommendation line.
- **Comments:** threaded, likes (`comment_likes` table), delete own, admin delete any.
- **Interest:** "أبدي اهتمامك" once per user per listing (`property_interests` table); owner sees count.
- **Notifications:** bell with unread badge, last 20 dropdown, full history; socket.io room `user:{id}`. Triggers: listing approved/rejected, new offer, offer decided, new comment/reply, price drop on saved listing, new listing matching a saved search.
- **Saved searches:** store filters **+ map area** (bbox or polygon) — "notify me about new listings in this area".
- **Price history** (`price_history` table, written from phase 1 on so history exists).
- **Analytics charts**, admin boundary editor, nearby places layer (schools, mosques, hospitals), featured-listing billing, Gulf country activation.

---

## 13. Security

- Access JWT 15 min + refresh token 30 days, both in **httpOnly, Secure, SameSite=Lax cookies** (SSR loaders need to read auth). Refresh token rotation with server-side revocation table.
- CSRF protection on cookie-authenticated mutations (double-submit token or SameSite + origin check).
- Role middleware on every protected API route; equivalent checks in loaders/actions.
- Zod validation on every endpoint, loader input, and action.
- Rate limits: 100 req/min general, 5 req/min auth, 30 req/min on map endpoints per IP.
- Parameterized SQL only. Uploads: MIME sniffing (not extension), images only, 10 MB max, re-encoded by sharp (strips EXIF incl. GPS).
- AES-256-GCM for phones; key only from env; never logged.
- Seed credentials are **development only**; seed script refuses to run when `NODE_ENV=production`.

---

## 14. UI / design

- Dark theme default, light mode toggle; mobile-first, 360–1440 px.
- Palette: background `#0f0f13`, surface `#16161d`, card `#1c1c26`, primary/gold `#d4a843`, success/rent `#2a9d8f`, exchange `#8b7fd4`, error `#e63946`, text `#f0ede8`, text secondary `#8a8795`.
- Map style should match the dark theme (dark basemap in dark mode, light basemap in light mode).
- Fonts: Cairo (Arabic), DM Sans (English); numbers use Western digits by default (setting for Arabic-Indic later).
- Loading skeletons, empty states, toasts, smooth transitions.

---

## 15. Folder structure

```
/app                      # React Router v7 app
  /routes                 # file routes: $lang.$country.map, $lang.property.$id, $lang.admin.*, ...
  /components
    /map                  # MapView, PricePin, ClusterLayer, DrawControl, BottomSheet
    /listing              # ListingCard, Gallery, FeaturesGrid, ContactBox
    /form                 # SubmitWizard steps
    /ui                   # buttons, inputs, toasts, skeletons
  /hooks                  # useMapUrlState, useAuth, useFavorites
  /store                  # zustand stores
  /i18n                   # ar.json, en.json, i18n setup
  /shared/schemas         # zod schemas shared client/server
  /utils                  # formatPrice, formatArea, shortPrice
/server
  /api                    # express routers under /api/v1
  /services               # listingService, mapService, contactService, cryptoService, storageService
  /db
    /migrations
    /seeds
  /middleware             # auth, rbac, rateLimit, validate, csrf
  index.ts                # express + react-router handler (+ socket.io in P2)
/scripts                  # import-boundaries.ts, generate-sitemap.ts
/data/boundaries/JO       # GeoJSON boundary files + manifest.json + SOURCES.md
/docs                     # SPEC.md, decisions
docker-compose.yml        # postgis/postgis
.env.example
```

---

## 16. Environment

`.env.example`:
```
DATABASE_URL=postgres://aqar:aqar@localhost:5433/aqar
JWT_SECRET=
REFRESH_TOKEN_SECRET=
ENCRYPTION_KEY=          # 32 bytes, base64
PHONE_HASH_KEY=
MAP_STYLE_URL_DARK=
MAP_STYLE_URL_LIGHT=
PUBLIC_BASE_URL=http://localhost:3000
UPLOAD_DIR=./uploads
```

---

## 17. Seed data (Jordan)

- Users: 1 admin, 2 agents (1 company, verified), 3 owners — dev passwords only.
- Boundaries: Jordan governorates; cities Amman, Irbid, Zarqa, Aqaba; all Amman neighbourhoods from OSM (§2.2), including Abdoun, Khalda, Sweifieh, Jubeiha, Dabouq, Tla' Al-Ali.
- Address settings: the address field catalog and Jordan's country settings (§2.3); a few listings with land-registry identifiers: one verified, two with the same full key written with different digits (duplicate warning), and two apartments in the same parcel (same-building hint).
- Listings: 40 published spread across those areas with realistic coordinates, mixed category/type/price (JOD); 3 pending (one with `needs_location_review`); 2 sold; mix of exact/approximate precision.
- Contact numbers: 1 global, 1 country (JO), 1 for Amman city, 1 for Abdoun area, 1 property-specific.

---

## 18. Phase 1 build order (one milestone per Claude Code session)

1. **Scaffold:** RR v7 + Express + TS + Tailwind, Docker PostGIS, Knex, `.env.example`, ar/en routing with RTL/LTR, theme toggle, layout shell.
2. **Database:** all phase 1 migrations (+ P2 tables that phase 1 writes to, e.g. `price_history`), address field catalog and country settings, property identifiers, boundary import script, seeds.
3. **Auth:** register/login/logout, cookies, refresh rotation, roles, CSRF, rate limiting.
4. **Map search:** map page, points endpoint, clustering, price pins, filters, URL state, list panel/bottom sheet, draw-to-search.
5. **Listing detail page** incl. contact resolution, similar listings, view counting.
6. **Submit wizard** incl. pin → area lookup, privacy offset, image pipeline, drafts, limits.
7. **Admin:** moderation queue, contact numbers, users, boundary viewer, basic counts.
8. **Profile:** My Listings, Saved, Settings; agent company page.
9. **SEO:** area pages, meta/JSON-LD, hreflang, sitemap, robots.
10. **Hardening:** tests for contact privacy (assert real phone and true point never appear in public responses or rendered HTML), Playwright happy paths, performance check with 10k seeded listings.

Each milestone ends with: typecheck clean, tests passing, short note in `docs/CHANGELOG.md`.
