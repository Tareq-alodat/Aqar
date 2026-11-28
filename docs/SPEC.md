# AQAR (عقار) — Product & Technical Specification

Map-based real estate website for Jordan and the Gulf, Arabic-first (RTL) with English (LTR).

> This spec replaces the original Replit prompt. Build it **one milestone at a time** (see §18).
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
| Roles | `super_admin`, `supervisor` (AQAR employees with a geographic scope), `agent` (brokers and companies; registration needs approval), `owner`, `financier` [P2]; visitors browse without an account (§3). |
| Supervisors | Every listing is **assigned to the supervisor whose scope contains its area**; all communication with interested users goes through that supervisor. Listers never receive buyers' contact details (§3, §8). |
| Offers | **Phase 1**, through the supervisor; minimum offer per country (default 80 % of the listed price). The public sees only the number of approved offers and the highest approved amount — never names. Replaces the owner-chosen `offers_visibility` (§21). |
| Location privacy | **Every listing is shown publicly as an approximate area** (~300 m), for all property types (no owner choice). The owner places the exact pin; the supervisor shares the exact location and map link with the client when a viewing is confirmed (§22). |
| Dev environment | VS Code + Claude Code, PostgreSQL/PostGIS via Docker, `.env` for secrets |
| Software & services | **All software is free / open source; only hosting is paid.** No paid third-party services or APIs. |
| Hosting | **One Linux VPS** (provider TBD, e.g. GoDaddy VPS) running **Node 24 LTS** (app), **PostgreSQL 16 + PostGIS** (database) and **Caddy** (reverse proxy, automatic HTTPS). Port read from `process.env.PORT`. `engines.node` is `>=24 <25` (Node 24 LTS). |
| Production database | PostgreSQL 16 + PostGIS **on the same VPS**, connected via `DATABASE_URL` (listening on localhost only), with the **`postgresql-contrib`** package installed (the `pg_trgm` extension used by text search, §5.6). Docker PostGIS (`docker-compose.yml`) is for local development. |
| Image storage | Always behind the storage interface. **`LocalDiskStorage` in development and production** — on the VPS, files live on its disk under `UPLOAD_DIR` and are served at `/uploads`. |
| Backups | **Nightly** `pg_dump` of the database and a copy of `UPLOAD_DIR`, kept off the VPS (destination TBD with the provider). |
| Revenue model | **Commission on completed deals**, paid by the lister (agent or owner): 1 % by default, per country, overridable per agreement, stored per deal; the deal's supervisor earns a share of collected commission (§19). Collected manually in phase 1 (bank transfer / CliQ, proof required, confirmed by super_admin); online payment [P2]. Waivers, downward price corrections, refunds and cancellations need super_admin approval. Brokerage licensing and the terms text need legal review per country before charging. |
| Currency | Listings stay in their country's currency. Other currencies are a **display conversion only**, marked "≈", no margin (§24). |
| Financing | Phase 1: an estimate calculator on the listing page. Licensed banks and financial brokers as financing providers are **[P2]**; AQAR takes no fee from them (§25). |
| Workflows | **Fixed, predefined in code** (no configurable workflow/SLA/permission engine in phase 1). Every status change is stored with actor, time and reason, so an engine can be added later (§26). |
| Text search | **PostgreSQL only**: full-text search (`arabic` / `english` configs) + `pg_trgm` + an Arabic normalization function (§5.6). No Elasticsearch or paid search service. |
| Email | A **free-tier** email provider (to be chosen; free products only) for verification, password reset and security notices (§20). No SMS in phase 1 (SMS is always paid). |

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
- **Map:** `maplibre-gl` 6, built-in GeoJSON clustering, `terra-draw` (MapLibre adapter) for draw-to-search. Arabic labels: MapLibre 6 shapes Arabic and orders RTL text itself, so the (now deprecated) RTL text plugin is not loaded. Basemap labels are rewritten to the page language (`name:ar` / `name:en`, falling back to `name`). The map worker is served as a bundled asset (`setWorkerUrl`); pin images come from `setMissingStyleImageResolver`.
- **Tiles:** **OpenFreeMap** (free, no API key); dark/light style URLs from `MAP_STYLE_URL_DARK` / `MAP_STYLE_URL_LIGHT`. Show the OpenFreeMap / OpenMapTiles / © OpenStreetMap attribution. Do **not** use `tile.openstreetmap.org` (usage policy) or paid tile providers.
- **Scheduled jobs:** run inside the app process (one VPS process): overdue reminders every 15 minutes (§26), exchange rates daily (§24). No external scheduler or queue in phase 1.
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
- **Boundary data:** imported by `scripts/import-boundaries.ts` from GeoJSON files in `data/boundaries/{country}/` (sources, queries, dates and licences recorded in `data/boundaries/{country}/SOURCES.md`). `source` records where each boundary came from: `osm` (OpenStreetMap, ODbL — the site credits "© OpenStreetMap contributors"), `generated` (derived by the import, e.g. nearest-point cells), or `manual` (drawn by the super_admin). Generated boundaries are meant to be replaced by the super_admin later; boundary editing is **[P2]**, phase 1 ships with a read-only boundary viewer.
- **Jordan:** governorates = OSM `admin_level=4`. Cities = union of the city's OSM districts (`admin_level=5`): Amman = Qasabah + Marka + Quaismeh + Al-Jami'ah + Wadi Essier; Irbid, Zarqa, Aqaba = their Qasabah district. Amman areas = one cell per OSM neighbourhood point (`place=neighbourhood`, 146 points; nearest-point/Voronoi cells clipped to the Amman city boundary), plus Jubeiha (not in OSM); the 21 Greater Amman municipal districts (`place=suburb`, e.g. منطقة تلاع العلي) are not imported — they are recorded in `SOURCES.md` for a later optional level between city and area; an area with a real OSM polygon (e.g. Dabouq) keeps it. English names missing in OSM are transliterated from Arabic with `name_en_reviewed = false` for review by the super_admin.
- Fallback: if a pin falls outside every boundary, store the nearest area (`ST_Distance` to centroid, within 5 km) and flag the listing for review by its supervisor.

### 2.3 Address fields (configured per country by the super_admin)
The super_admin decides which fields describe an exact address in each country, in what order, and who may see them.

- `address_fields` — catalog of every field the platform supports: `key PK`, `kind ENUM[admin_area, text, number, identifier]`, `label_ar`, `label_en`, `pattern` (optional regex), `strip_leading_zeros bool` (identifiers).
  - `admin_area` fields (governorate, city, district, area, block) are filled from the pin (§2.2), never typed.
  - `text` / `number` fields (street, avenue, building number, floor, unit number, postal code) are typed by the owner.
  - `identifier` fields are property/unit identifiers (§2.4).
- `country_address_fields (country_code, field_key, position, is_required default false, visibility ENUM[public, exact_only, admin_only], map_min_zoom, is_active)`, PK `(country_code, field_key)`. `map_min_zoom` applies to `admin_area` levels (map drill-down, §5.2). `visibility` applies to `text`/`number` fields: `public` = shown on the listing page; `exact_only` = never public (every listing is public as an approximate area, §4.3) — the supervisor shares it with the client when a viewing is confirmed (§22); `admin_only` = never public. Identifiers are never public regardless.
- Typed (non-identifier) values are stored in `properties.address jsonb` (`{field_key: value}`), validated by a Zod schema built from the country's settings.
- Jordan default: governorate, city, area (from pin) · street, building number (`exact_only`, so not public) · apartment number (`admin_only`) · land-registry identifier (§2.4). No floor field: the floor is the public feature `floor_number` (§4.1).

### 2.4 Property identifiers (GIS / unit IDs)
`property_identifiers (id, property_id FK, country_code FK, scheme FK → address_fields.key, value, value_normalized, verified_by FK users nullable, verified_at nullable, created_at)`, unique `(property_id, scheme)`, index `(country_code, scheme, value_normalized)` for duplicate detection (supervisors and the super_admin see "other listings with the same identifier").

- **Only property/unit identifiers — never personal civil IDs.** E.g. Kuwait PACI address number (الرقم الآلي للعنوان), never الرقم المدني.
- Schemes: Jordan land registry `jo_land_parcel`, Kuwait `kw_paci`, Saudi National Address short code `sa_national_address`. UAE schemes depend on the emirate (Makani is Dubai only) and are deferred.
- **`jo_land_parcel`** is entered as parts and stored as `directorate/village/basin/parcel`, plus `/apartment` for apartment listings. A parcel number is only unique within its directorate, village and basin. **Duplicate = same full key.** The same parcel with different apartment numbers is not a duplicate; `identifierService` reports it to the reviewer as a "same building" hint.
- **Normalization** (`value_normalized`, applied to each part separately for multi-part schemes): trim and remove whitespace, convert Arabic-Indic (`٠-٩`) and Persian (`۰-۹`) digits to Western, uppercase Latin letters, strip leading zeros where the scheme allows (`strip_leading_zeros`).
- **Who sees them:** owners and agents enter and see identifiers on their own listings; supervisors see those of listings in their scope; the super_admin sees all; financiers see them for listings in financing requests addressed to them [P2, §25]; **never public** (no public API response, loader data, or rendered HTML). Optional by default; the super_admin can mark a scheme required per country.
- **Verification:** the listing's supervisor (or the super_admin) can mark an identifier verified (`verified_by`, `verified_at`).

---

## 3. Users & roles

JWT auth (details in §13). Roles (`users.role`): **`super_admin`**, **`supervisor`**, **`agent`**, **`owner`**, and **`financier`** [P2] (the value exists from phase 1; §25). Visitors browse without an account. `super_admin` replaces the former `admin` role.

| Role | Who | Rights |
|---|---|---|
| **super_admin** | AQAR management | Everything: all countries and areas; creates supervisors and sets their scopes; reassigns listings; suspends/reactivates agents and users; country settings (address fields, contact numbers, commission rate, supervisor share, minimum offer, cancellation fee); confirms payments; approves waivers, downward final-price corrections, refunds and deal cancellations (§19); approves financiers [P2] |
| **supervisor** | AQAR employees, **created only by the super_admin** | Works **only within their geographic scope**: reviews agent registrations, moderates and is assigned listings, handles enquiries, viewings, offers and deals, records payments with proof; sees the lister's real phone for listings in scope (audited, §8). Has a **work mobile number** (an AQAR number) on their profile — the public contact for their listings |
| **agent** | Brokers and brokerage companies | Registration needs approval (below); unlimited listings; belongs to a `company` (name ar/en, logo, licence, verified badge); dashboard (§11); pays the commission on deals for listings they submitted (§19) |
| **owner** | Property owners | Self-registers; no limit on active listings (anti-spam: `SUBMISSIONS_PER_DAY` per rolling 24 h, default 10, §7); favorites; enquiries, viewings and offers as a buyer (§21–22); listing statistics (§11); pays the commission on deals for listings they submitted directly (§19) |
| **financier** [P2] | Staff of a licensed bank or financial broker | Sees only financing requests addressed to their organisation (§25) |

Visitors (not logged in) can browse the map, view listings, call the listing's supervisor number, see the public offer summary and use the financing calculator. Enquiries, viewing requests and offers need an account.

**Supervisor scope.** `supervisor_scopes (supervisor_id FK users, admin_area_id FK, PRIMARY KEY (supervisor_id, admin_area_id))` — one or more areas, possibly in several countries; an area includes everything inside it (descendants). A supervisor sees only data inside their scope: listings, agent registrations, enquiries, viewings, offers, deals and payments. `supervisor_profiles (user_id PK FK, work_phone_e164, work_phone_whatsapp bool, title_ar, title_en, is_active)` — the work mobile is AQAR's number, public on listings (§8). Supervisors are never self-registered.

**Registration and approval.**
- **Owners and visitors** self-register (email verification from milestone 15, §20) and are active at once.
- **Agents / companies** register as agents (or an owner applies to become one) with company name (ar/en), licence number, logo, office area (an `admin_area`, which routes the review) and optional documents (private files, never under public `/uploads`). Status: `submitted → under_review → approved | rejected (reason) | info_requested` (the applicant answers → `under_review` again). The review goes to the **supervisor whose scope contains the office area** (deepest match; else the super_admin). Approval sets `role = agent`, creates or links the `company` and marks it verified. Until approved, the account can sign in and see its status but cannot submit listings as an agent.
- **Suspend / reactivate** (any user) — super_admin only, with a reason.
- **Status history** for every registration and account status change: actor, time, reason (§26).
- `agent_applications (id, user_id FK, company_name_ar, company_name_en, license_number, logo_url, office_admin_area_id FK, documents jsonb, status ENUM[submitted, under_review, info_requested, approved, rejected], reason, assigned_supervisor_id FK nullable, company_id FK nullable, decided_by FK, decided_at, created_at, updated_at)`.

---

## 4. Listings

### 4.1 Fields
**Basic:** `title_ar`, `title_en`, `description_ar`, `description_en` (at least one language required; the missing one falls back to the other on display), `category ENUM[house, apartment, land, villa, commercial]`, `listing_type ENUM[sale, rent, exchange]`, `rent_period ENUM[monthly, yearly]` (rent only), `price numeric(14,3)` (null allowed only for `exchange`), `currency` (copied from country, not user input).

**Features:** `area_sqm`, `bedrooms`, `bathrooms`, `floors`, `floor_number`, `age_years`, `parking`, `garden`, `pool`, `elevator`, `furnished ENUM[yes, no, partial]`, `amenities text[]` (from a fixed tag list in i18n). Land listings hide room/floor fields.

**Location:** `point geography(Point,4326)` (true pin), `display_point geography(Point,4326)`, `location_precision` (no longer a user setting: always `approximate`, enforced by a CHECK; the column stays for compatibility), `admin_area_id FK`, `address jsonb` (typed address fields per §2.3; replaces `street_ar/en`), `country_code FK`. Unit identifiers live in `property_identifiers` (§2.4).

**Contact:** `owner_phone_encrypted` (AES-256-GCM, pre-filled from the user's profile phone, editable per listing). The public contact is the **assigned supervisor's work mobile**; `contact_numbers` rows (including `scope = 'property'`) are the fallback (§8).

**Assignment:** `assigned_supervisor_id FK users nullable` (set on submission, §4.2; null = the super_admin's queue), `assigned_at`.

**Offers:** the owner-chosen `offers_visibility` setting is **removed** (offer visibility is fixed, §21; the column is dropped when offers are built).

**Commission (§19):** `commission_payer_type ENUM[agent, owner]` (set at submission from the submitter's role), `commission_terms_version`, `commission_terms_accepted_at` (the lister accepts the listing terms at submission — commission, and from the next terms version also consent to share property data with licensed financiers when a buyer applies for financing, §25).

**Prices:** the asking price is `price`; the accepted offer amount and the final price live on the deal (§23) and are never written back over the asking price.

**System:** `status`, `status_reason` (rejection or return reason; replaces `rejection_reason`), `is_featured`, `featured_requested_at`, `view_count`, `slug`, `published_at`, `created_at`, `updated_at`, `needs_location_review bool`, `close_reason ENUM[via_aqar, elsewhere, unavailable] nullable` and `closed_at` (why and when a published/reserved listing was taken off the market, §4.2).

### 4.2 Status (single vocabulary — use these exact values everywhere)

`draft → pending → published | rejected | returned`, then `published → reserved | sold | rented | archived`. **`returned`** (returned for changes) is new in the business model v2; every change is stored in the status history with actor, time and reason (§26).

- **Submit → `pending`**, and the listing is **automatically assigned** to the supervisor whose scope contains its area (the **deepest** matching scope area on the listing's area path; ties → the supervisor with fewer open listings; no match → the super_admin's queue, `assigned_supervisor_id = null`). The super_admin can **reassign** any listing (with a reason).
- **Supervisor (or super_admin) review:**
  - approve → `published` (+ `published_at`);
  - reject → `rejected` + reason (final; the lister may submit a new listing);
  - return for changes → `returned` + reason; the lister edits and resubmits → `pending` (same supervisor).
- Any lister edit to **price, pin or photos** on a `published` listing → back to `pending` (re-review). Edits to text/features stay published.
- An accepted offer → `reserved` (§21). A completed deal → `sold` (sale) or `rented` (rent) (§23). A cancelled deal → back to `published` (super_admin approval, §19).
- The lister can **archive** a listing. Archiving a `published` or `reserved` listing asks for a reason (`close_reason`, `closed_at`, audited):
  - **Sold/rented through AQAR** (`via_aqar`) → opens a **deal** for the supervisor to complete (§23): the listing is `reserved` while the deal is open; the supervisor records the final price and evidence; the listing becomes `sold`/`rented` when the deal completes. Exchange listings carry no commission at launch, so they are archived with the reason only.
  - **Sold/rented elsewhere** (`elsewhere`) / **No longer available** (`unavailable`) → `archived`, no deal.
  - Archived listings that had enquiries are listed for the supervisor's follow-up (§19).
- Overdue reviews (pending > 48 h) trigger reminders (§26).

### 4.3 Location privacy

- **Every public listing shows an approximate area, for all property types**; there is no owner choice. `display_point` = `point` offset by a random bearing/distance of 150–300 m, **computed once when the pin is saved and stored**. Never recompute per request (averaging repeated random offsets would reveal the true point). The detail page shows a ~300 m circle, never a pin.
- `point` is **never** returned by any public endpoint or loader. Public code reads only `display_point`.
- **Who sees the exact pin:** the listing's owner/agent (in the editing flow), the supervisor of the listing's area (in scope), and the super_admin — always `Cache-Control: private, no-store`. Financiers see it for listings in requests addressed to them [P2, §25].
- **Sharing with a client:** the supervisor shares the exact location (pin and map link) and the `exact_only` address fields with a client **when a viewing is confirmed** (§22). The share is recorded on the appointment (who, when) and in the audit trail; the client sees it on their own viewing page only.
- **Address details can reveal the location as precisely as `point`.** Only `public` address fields are shown publicly; `exact_only` fields are shared as above; `admin_only` fields and property identifiers (§2.4) are never public. Public serializers use the allow-list of fields this rule permits.

### 4.4 Images
Up to 20 per listing; **at least 1 photo is required to submit, except for land** (optional, with a warning when there are none); first = cover; drag-and-drop reorder; jpg/png/webp, max 10 MB each; client-side resize before upload; server converts to WebP + thumbnail.
`property_images (id, property_id FK, url, thumbnail_url, width, height, order_index, uploaded_at)` — cover = `order_index = 0`.

---

## 5. Map search (core feature)

### 5.1 Layout
- **Desktop (≥1024px):** split view — map ~60% / results list ~40% (list on the start side: right in Arabic, left in English). Filter bar above both.
- **Mobile:** full-screen map; results in a **bottom sheet** with three snap points (peek showing count, half, full). Bottom nav: Map, Saved, Add, Profile.
- Hovering a result card highlights its pin; clicking a pin scrolls/highlights the card (desktop) or opens a mini card (mobile).

### 5.2 Behaviour
- **Search as I move the map** (toggle, default on): on `moveend`, debounce 300 ms, query by current bbox; when off, a "Search this area" button appears. Points are fetched for the view padded by 25 % on each side and cached in the browser: while the view stays inside that area with the same filters (zooming in, small pans), nothing is refetched; a truncated response is never reused. A 429 shows a gentle message and retries after `Retry-After`.
- **Draw to search:** polygon tool (terra-draw). Active polygon replaces bbox filtering; "Clear area" button restores it.
- **URL holds state:** `/ar/jo/map?lat=31.95&lng=35.91&z=12&type=sale&cat=apartment&minPrice=50000&maxPrice=150000&beds=2,3&poly=<encoded>`. Any view is shareable and restorable on refresh.
- **Country switcher** in header flies the map to the country's default center and resets currency.
- **Jump to location:** governorate/city dropdowns (from `admin_areas`) fly the map to that area's bounds. No external geocoding API in phase 1.
- **Drill-down:** area outlines and labels appear by level as the user zooms in (each level's `map_min_zoom`, §2.3) — cities first, then neighbourhoods. The full address path of the area in view (country › governorate › city › area) is shown and updates while drilling down: it is the path of the deepest area containing the map centre among the levels visible at the current zoom; each part zooms back out to that area. Clicking an area zooms to it.
- **Basemap & credit:** OpenFreeMap `positron` (light, default theme) and `dark` — both muted so the pins stand out, with water and green areas softly tinted (§14); switching theme swaps the basemap. "© OpenStreetMap contributors" (linked to the OSM copyright page) is always visible next to OpenFreeMap's own credit, never collapsed.
- **Pins:** price label in short form (`85K`, `1.2M`, `450/mo`) on a callout with a pointer tail, colour by listing type — sale `#A32A44`, rent `#1D6A9E` (white labels), exchange `#F2A93B` (dark ink) (§14) — white 2px outline and soft shadow; the hovered pin grows slightly; featured listings get an amber ring.
- **Clustering:** MapLibre GeoJSON source with `cluster: true`; cluster bubbles in the primary colour with a white count and halo, sized by count, darker on hover; click zooms in.
- Result count always visible ("124 عقار في هذه المنطقة").

### 5.3 Filters
Listing type, category, price range, area range, bedrooms (multi), bathrooms (min), amenities (pool, parking, garden, elevator, furnished), max property age, governorate/city. Sort (list only): newest, price ↑, price ↓, most viewed, price per m² ↑.

### 5.4 API
- `GET /api/v1/map/points?country=JO&bbox=minLng,minLat,maxLng,maxLat&<filters>` → GeoJSON `FeatureCollection` of `display_point`s with minimal properties `{id, price, currency, listing_type, rent_period, category, is_featured}` (`rent_period` for the "450/mo" label). Cap 3,000 features; if exceeded return `truncated: true` and the client shows "zoom in to see all". **Rate limit: 60/min per IP, separate from (not counted in) the general 100/min.**
- `GET /api/v1/areas/tree?country=JO` → area levels with their `map_min_zoom` and the first two levels' areas with bounds (jump-to dropdowns). `GET /api/v1/areas/outlines?country=JO&level=` → that level's boundaries simplified for display (cached; label point and bounds per area). `GET /api/v1/areas/at?country=JO&lng=&lat=&z=` → address path at a point for a zoom.
- Search state (URL, page loader and API share one Zod schema, `app/shared/schemas/mapSearch.ts`): `type, cat, minPrice, maxPrice, minArea, maxArea, beds` (list; `5` = 5+), `baths` (min), `amen` (`pool, parking, garden, elevator, furnished`), `maxAge, area` (governorate/city id, includes everything inside), `sort, page`, and `poly` (encoded polyline, ≤ 100 corners, must not cross itself).
- `POST /api/v1/map/points` with `{ polygon: GeoJSON, ...filters }` for draw-to-search.
- `GET /api/v1/listings?country=JO&bbox=...|polygon=...&<filters>&sort=&page=&pageSize=20` → result cards (cover thumb, title, price, type, category, area name, beds, baths, area_sqm).
- Spatial predicates: `ST_Intersects(display_point, ST_MakeEnvelope(...)::geography)` / `ST_Covers(polygon, display_point)`. Only `status = 'published'`.

### 5.5 Indexes
GIST on `properties.display_point`; btree on `(country_code, status, listing_type, category, price)`; btree on `(status, published_at desc)`.

### 5.6 Text search (milestone 4b)
- **Search bar** on the map page: one bilingual free-text box over listing title, description and area names (the listing's area path). Tolerant of typos and of Arabic spelling variants.
- **Arabic normalization** (`aqar_normalize_ar(text)`, an `IMMUTABLE` SQL function used both when indexing and on the query): remove diacritics (tashkeel U+064B–U+0652, superscript alef U+0670) and tatweel (U+0640); `أ إ آ` → `ا`; `ة` → `ه`; `ى` → `ي`; Arabic-Indic and Persian digits → Western; lower-case Latin.
- **Matching and ranking:** PostgreSQL full-text search (`to_tsvector('arabic', …)` for Arabic text, `'english'` for English, `'simple'` for area names) in a stored `tsvector` column on `properties` with a GIN index, plus `pg_trgm` (GIN `gin_trgm_ops` on the normalized title and area names) for typo tolerance (`word_similarity`). A listing matches on full-text **or** trigram similarity above a threshold; results are ranked by `ts_rank` and similarity. Only `status = 'published'`.
- **Location autocomplete** over `admin_areas` (Arabic and English names, normalized, `pg_trgm` index): suggestions show the area path (e.g. "عبدون، عمان"); choosing one flies the map to the area's bounds (like jump-to, §5.2) rather than filtering by text.
- **Near me:** a button that asks for the browser's location **only when pressed** (never on page load), then searches within a radius (default 2 km; choices 1/2/5/10 km) of that point with `ST_DWithin` on `display_point`. The location is not stored or logged on the server; in the URL it is rounded to 3 decimals (~100 m).
- **Search state:** new URL/API parameters `q` (free text, ≤ 100 characters), `near=lng,lat&radius=` and `in=view` in the shared schema (`app/shared/schemas/mapSearch.ts`); they combine with the filters (§5.3). Scope (milestone 4b decision):
  - `q` alone searches **the whole country** and the map fits to the results (the points response carries the `bbox` of all matches); moving the map does not change the results.
  - **"Search this area"** keeps `q` and limits it to the map view (`in=view`, so the link restores it; "Search all of {country}" goes back).
  - A drawn polygon or "near me" limits `q` to that area. **Near me and a drawn polygon are mutually exclusive**: setting one clears the other (a URL with both keeps the polygon; the API answers 400).
  - Choosing an autocomplete suggestion flies the map there; with a country-wide `q` it switches to `in=view`.
  - Text searches sort by **relevance** (`sort=relevance`, "Best match": `ts_rank` + word similarity) unless another sort is chosen.
- **Matching details:** every word of the query must match (full-text in any of the three configs, or trigram word similarity ≥ 0.6 for typos); stop words ("في", "in") are skipped. Index columns `properties.search_tsv` / `search_norm` are kept by triggers (titles, descriptions, area path; refreshed when an area on the path is renamed or moved); `admin_areas.search_norm` is a generated column. **Contact details** written into listing text (§8.1) are removed before indexing (`aqar_strip_contacts`), so they are never searchable.
- **API:** `q` / `near` on `GET /api/v1/listings` and `/api/v1/map/points`; `GET /api/v1/areas/suggest?country=JO&q=` → up to 8 areas with path and bounds. Points and listings keep their limits (§13); **`/areas/suggest` has its own limit, 120/min per IP**, not counted in the general one, so typing does not use it up. Request logs redact `near`, `lat` and `lng`.
- **Constraint:** PostgreSQL only (built-in full-text search + `pg_trgm`); no Elasticsearch or other search server, and no paid search API.

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
2. **Location:** pick governorate/city to fly the map, then **drop/drag a pin**. Show the detected area path live (server lookup). Fill the country's typed address fields and property identifiers (§2.3–2.4; required ones as configured by the super_admin), with a note on which are never shown publicly. The lister sees their exact pin and a preview of what the public will see: the approximate area (~300 m circle) around the stored public point. There is no exact/approximate choice (§4.3).
3. **Details:** price, features (fields adapt to category), amenities, titles/descriptions (ar/en tabs).
4. **Photos:** upload, reorder, choose cover.
5. **Contact & review:** confirm phone (shown with note "لن يظهر رقمك للعامة"), summary, **accept the listing terms** (required checkbox, link to the terms page in Arabic and English: commission §19, and data sharing with financiers §25), submit → `pending` and assigned to the area's supervisor (§4.2). (The offers-visibility setting is removed, §21.) The listing stores `commission_payer_type`, `commission_terms_version` and `commission_terms_accepted_at`.

Drafts autosave (`status = draft`; at most 10 drafts per user). No limit on active listings; each user may submit at most `SUBMISSIONS_PER_DAY` listings per rolling 24 h (default 10; counted from the database at submit, 429 with `Retry-After`). The phone in step 5 is shown masked (e.g. `+962 •••••••67`) with "use a different number"; a new number goes only into the submit request and is never sent back to the page (§8). Commission terms: version `2026-11-draft` until the reviewed text is published. From milestone 15, submitting requires a **verified email** (§20); until then, submission is allowed without it. Agents can submit only once their registration is approved (§3). Drafts can be saved either way.

---

## 8. Contact privacy & proxy numbers (critical)

- **All communication with interested users goes through the listing's supervisor.** Listers (agents and owners) **never receive buyers' contact details**; buyers never receive the lister's.
- **Public contact number** on a listing (server-side `resolveContactNumber(listing)`):
  1. the **assigned supervisor's work mobile** (`supervisor_profiles.work_phone_e164`, an AQAR number, with WhatsApp if enabled);
  2. if no supervisor is assigned (or the profile is inactive), the `contact_numbers` fallback in order: property-level number → the listing's `admin_area`, then each ancestor (area → city → governorate) → country → global default.
- Public page shows the resolved number with **call** and **WhatsApp** buttons.
- Lister's real phone stored **AES-256-GCM encrypted** (`ENCRYPTION_KEY` from env; IV + auth tag with the ciphertext), plus `owner_phone_hash` (HMAC-SHA256, indexed) for search without decrypting.
- Phones are normalized to E.164 for the listing's/user's country before encrypting and hashing (`normalizePhone(input, countryCode)` in `app/shared/phone.ts`, prefix = `countries.phone_prefix`). Accepted input: the local formats — JO mobile `07[789]XXXXXXX` with or without the leading `0`, JO landline `0[2356]XXXXXXX` (leading `0` required); KW 8 digits; SA/AE mobile `05XXXXXXXX` or `5XXXXXXXX` — or international `+`/`00`; spaces, dashes, brackets, Arabic-Indic digits and a trunk `0` after the country code are tolerated. Jordanian numbers must be a 077/078/079 mobile or a 02/03/05/06 landline however they are typed (including `+962…`). Only the normalized form is hashed. A phone is optional at registration and required when submitting a listing.
- **Who may see the lister's real phone:** the super_admin (any listing) and the **supervisor for listings in their scope**, only through `GET /api/v1/backoffice/listings/:id/contact`; every view is written to the audit trail. Financiers never see it [P2].
- **It must never appear in:** any public API response, **any React Router loader return value** outside that back-office view (loader data is serialized into the HTML), client state, localStorage, logs, or error messages. Public serializers use an explicit allow-list of fields — never spread DB rows into responses.
- **Buyers' contact details** (enquiries, viewings, offers) are visible to the supervisor in scope and the super_admin only — encrypted at rest like phones, never shown to listers.
- `contact_numbers (id, phone_number, whatsapp bool, label, scope ENUM[global, country, admin_area, property], country_code, admin_area_id FK, property_id FK, is_active, created_by FK, created_at)` — fallback numbers, managed by the super_admin.

### 8.1 Contact details in listing text

All contact goes through the supervisor, so **listers must not put their own contact details in listing text** (titles and descriptions, Arabic and English).

- **Detection** (shared detector `app/shared/contactDetails.ts`, unit-tested): phone numbers in any form (Western or Arabic-Indic/Persian digits; spaces, dashes, dots or brackets between digits; `+962` / `00962` / `07…` prefixes; 9+ digits, or `+` and 8+), email addresses, links/URLs (with or without `http://`/`www.`, e.g. `wa.me/…`, `t.me/…`, `name.com`), `@handles`, and WhatsApp/Telegram/Instagram/Facebook mentions (Arabic spellings with `ال`/`بال`/`و`… prefixes, and Latin), incl. a handle after a colon.
- **On submit and on every edit** (milestone 7): the listing is **flagged to its supervisor** in the moderation queue with the detected text highlighted; the supervisor removes it (edit) or **returns the listing for changes** before publishing. Each detection is recorded in the audit trail (`audit_log`, §9: action `contact_details_detected`, the kinds and positions found — not the values).
- **Safety net (from milestone 4b):** in all public output (pages, API, search results: card titles, listing title and description, meta tags), detected contact details are **masked** as `•••`, even if a listing was published with them. The owner's own editing flow shows the text as written.
- **Search index:** detected contact details are never indexed (`aqar_strip_contacts`, §5.6).
- [P2] Contact details written inside photos (OCR).

---

## 9. Back office (`/ar/backoffice`) — super_admin and supervisors

One back office for both roles; **supervisors see only their scope**, the super_admin sees everything (§3). Every list shows items **overdue** per §26.

- **Supervisors (super_admin):** create supervisor accounts (never self-registered), set work mobile, scopes (area tree, several countries allowed), activate/deactivate; a supervisor's open work is reassigned when deactivated.
- **Agent registrations** (§3): queue per scope; approve / reject (reason) / request more information; documents viewer (private). Suspend/reactivate users — super_admin only.
- **Moderation queue:** pending listings assigned to me (super_admin: all, plus the unassigned queue); thumbnail, title, price, submitter, area, submitted at, waiting time, location-review flag, **contact-details flag** (detected text highlighted, §8.1); detail view with the **true pin** and identifiers (duplicate / same-building warnings, verify action, §2.4); **approve, reject (reason), return for changes (reason)**, edit any field; bulk approve. Reassign (super_admin).
- **Lister contact:** "show phone" on a listing in scope (audited, §8).
- **Enquiries & viewings** (§22), **offers** (§21), **deals** (§23): queues and detail screens per scope.
- **Commissions & collections** (§19): due / overdue / partially paid / paid / waived; record payments with proof (supervisor); confirm payments, approve waivers, downward corrections, refunds and cancellations (super_admin); printable invoice; supervisor earnings.
- **Follow-up list:** archived listings that had enquiries (archive reason, enquiry count, last status), so the supervisor can check whether a deal went through AQAR and open one (§23).
- **Settings (super_admin):** per country — address fields (§2.3), contact numbers (§8), commission rate, supervisor share, minimum offer %, cancellation fee %, payment due period, display currencies (§24); commission agreements (§19).
- **Boundaries viewer:** map of `admin_areas` per country/level, read-only in phase 1; highlights `source = generated` boundaries and English names with `name_en_reviewed = false`.
- **Analytics (basic in phase 1):** counts by status; per-supervisor workload and overdue items; top viewed listings; verified final prices only for price figures (§23). Charts **[P2]**.
- **Audit trail:** every back-office action is written to an **append-only** `audit_log`: approve, reject, return, reassign, edit (before/after values of the changed fields), registration decisions, suspend/reactivate, scope and role changes, contact-number changes, **viewing a real phone or a buyer's contact details**, sharing an exact location (§22), offer, deal and payment actions, approvals (§19) — and, from listers, closing a listing. Failed logins are recorded there too (email as a keyed hash, IP hash). Personal data (phones, names, emails) is never copied into `before`/`after`; the entry records that the field changed. Append-only is enforced in the database (a trigger rejects `UPDATE` and `DELETE`). Screen to browse and filter it (super_admin; supervisors see entries for their scope).
  `audit_log (id bigserial, actor_user_id FK nullable, action, entity_type, entity_id, before jsonb, after jsonb, reason, ip_hash, created_at)`

---

## 10. Property detail page

Gallery (thumbnail strip + lightbox), title, price (+ price per m²; optional **≈ conversion** into the visitor's display currency, §24), type/category badges, breadcrumb from the admin area hierarchy (country › governorate › city › area) plus the `public` address fields (§4.3), features grid, amenity chips, description, map (approximate circle — never a pin), **contact: the supervisor's work mobile** (call / WhatsApp, §8), favorite toggle, share (copy link + WhatsApp share), view count, owner/agent card (first name only for individual owners; name, company + verified badge for agents — **no phone**), similar listings (same category & type, nearest 4 within 5 km via `ST_DWithin`, else same city).

Added by the business model v2:
- **Send an enquiry** and **request a viewing** (logged-in users; §22).
- **Offers** (sale and rent listings, logged-in users): make an offer; the public summary shows only the **number of approved offers and the highest approved amount**, never names (§21).
- **Financing calculator** (estimate only), later the entry point for financing requests (§25).

View counting: at most once per visitor per listing per 24 h (cookie/IP hash).

---

## 11. Accounts & profile (phase 1 subset)

Tabs:
- **My Listings** (listers): status badges with the reason for `rejected`/`returned`; edit and resubmit `returned` listings; edit published listings (price/pin/photos → re-review); archive with a reason (§4.2); offers received on my listings, as forwarded by the supervisor, with accept / reject / counter (§21); enquiry and viewing **counts** (never buyers' details).
- **My enquiries, viewings and offers** (buyers): status of each; confirmed viewings show the exact location once the supervisor shares it (§22); my own offers and counter-offers.
- **Saved** (favorites).
- **My commissions** (listers): amount, status, due date, payments, invoices (§19).
- **Registration status** (agents): the approval steps and any request for more information (§3).
- **Settings:** name, email, phone, password, language, theme, display currency (§24); data export and account deletion from milestone 15 (§20).

- **Agent dashboard:** portfolio summary; status pipeline (pending / returned / published / reserved / sold / rented counts); views over time per listing (from `property_views`, per day); enquiry, viewing and offer counts per listing.
- **Owner statistics:** views, enquiry and offer counts per listing over time.
- Agents: company profile page with logo, listings map, verified badge.

`saved_properties (id, user_id FK, property_id FK, saved_at, UNIQUE(user_id, property_id))`

---

## 12. Phase 2 features [P2]

Offers moved into phase 1 (§21). Larger later-phase items are in §27 (and financing providers in §25).

- **Compare:** up to 3 listings (4 under consideration — decide later), floating compare tray, side-by-side table, best price per m² highlighted with a recommendation line.
- **Comments:** threaded, likes (`comment_likes` table), delete own; supervisors (in scope) and the super_admin delete any.
- **Interest:** "أبدي اهتمامك" once per user per listing (`property_interests` table); owner sees count.
- **Notifications:** bell with unread badge, last 20 dropdown, full history; socket.io room `user:{id}`. Triggers: listing approved/rejected/returned, offer forwarded/decided/countered, viewing proposed/confirmed, new comment/reply, price drop on saved listing, new listing matching a saved search. (Phase 1 has back-office overdue reminders and email for key events, §26.)
- **Saved searches:** store filters **+ map area** (bbox or polygon) — "notify me about new listings in this area".
- **Price history** (`price_history` table, written from phase 1 on so history exists).
- **Analytics charts**, boundary editor (super_admin), nearby places layer (schools, mosques, hospitals), featured-listing billing, Gulf country activation.
- **Price insights** on the listing page: price and price per m² compared with similar listings in the same area (median, range) and with recently sold/rented ones.
- **Home / discovery page:** featured carousel, category shortcuts, recently viewed and nearby listings, all linking into the map.
- **Bulk upload for agents:** CSV import with a validation report; listings are created as `pending`.
- **Follow agents/companies:** followers are notified of new listings.
- **Broadcasts** by the super_admin, targeted by role, country/city and category.
- **Interest notifications** to listers, aggregated per day.
- **Email notifications** (and push later) in addition to in-app ones.
- **Ownership documents:** the lister uploads a title deed or contract (private: the listing's supervisor and the super_admin only) to support identifier verification (§2.4).
- **"Get directions"** button (opens the user's maps app; to the approximate area, since the exact address is shared at viewing time).
- **Online commission payment** (§19); collecting commission in another currency (§24).
- **Installable web app (PWA)** with push notifications; native iOS/Android apps are [P3] (§27).
- **SMS OTP** (verification/login codes) as a later option; SMS is always paid.
- **Contact details in photos:** OCR of listing photos for phone numbers and handles, flagged like text (§8.1).

---

## 13. Security

- **Sessions:** access JWT (HS256, `JWT_SECRET`) 15 min + opaque refresh token, both in **httpOnly, SameSite=Lax, Path=/ cookies** (`aqar_at` / `aqar_rt`; `Secure` and the `__Host-` prefix when `PUBLIC_BASE_URL` is https), so SSR loaders can read auth. The access token holds only user id, role and session (family) id; every request re-reads the user (role, status) and checks the session is still active, so suspension, role changes and logout take effect immediately. The server refuses to start without `JWT_SECRET` and `REFRESH_TOKEN_SECRET`.
- **Refresh tokens:** stored only as HMAC-SHA256 (`REFRESH_TOKEN_SECRET`) in `refresh_tokens`; one-time use, rotated by the server whenever a request arrives with an expired access token (pages and API) or on `POST /api/v1/auth/refresh`. All tokens of one login form a family. A rotated token presented again within **30 s** is treated as a concurrent request (served, no new tokens); later, as theft: the whole family is revoked. **Lifetime:** sliding expiry after **30 days** of inactivity, never more than **90 days** from login (`family_started_at`); **super_admin and supervisors: 1 day / 7 days** (financiers too, [P2]). The cap uses the user's current role.
- **Login:** an unknown email is checked against a dummy scrypt hash, so timing does not reveal which emails exist; the same error (`invalid_credentials`) for a wrong email or password; "suspended" only after the right password; hashes with old scrypt parameters are re-hashed on login (`needsRehash`). At most 2 scrypt runs at once (~128 MiB each); others queue. Registration creates `owner` accounts, or agent registrations pending approval (§3); supervisors are created only by the super_admin. Email verification, password reset and new-device login notices arrive in milestone 15 (§20).
- **CSRF:** SameSite=Lax cookies + origin check on every POST/PUT/PATCH/DELETE (API and page actions): `Origin`, else `Sec-Fetch-Site: same-origin`, else `Referer` must match `PUBLIC_BASE_URL` (plus `localhost`/`127.0.0.1` in development); requests with none of them are refused (403). Logout is POST only. `?next=` redirects accept only same-site paths.
- Role middleware on every protected API route (`requireAuth`, `requireRole`); equivalent checks in loaders/actions (`requireUser`, `requireRole` in `app/utils/auth.server.ts`). Pages receive only `{ id, name, role }` of the signed-in user.
- **Scope checks:** every supervisor query is filtered server-side to their scope (`supervisor_scopes`, descendants included); an out-of-scope id is a 404. Scope filtering lives in services, never only in the UI.
- Zod validation on every endpoint, loader input, and action.
- Rate limits (in memory, one process): 100 req/min general (`/api/v1`, including listings and area calls), 5 req/min auth (login + register, API and page forms combined), 60 req/min on `/api/v1/map/points` per IP (its own limit, not counted in the general one; milestone 4 decision); 120 req/min on `/api/v1/areas/suggest` per IP (location autocomplete; its own limit, milestone 4b); plus 10 failed logins per email per 15 min; photo uploads 30/min per user; listing submissions `SUBMISSIONS_PER_DAY` per user per rolling 24 h (default 10, counted in the database so restarts do not reset it). 429 with `Retry-After`. Behind Caddy, Express trusts the loopback proxy for the client IP.
- Parameterized SQL only. Uploads: MIME sniffing (not extension), images only, 10 MB max, re-encoded by sharp (strips EXIF incl. GPS).
- AES-256-GCM for phones and buyers' contact details (owner, user, supervisor-recorded caller and enquiry phones); private files (agent documents, payment proofs, deal evidence, financing documents [P2]) are never served from public `/uploads`; key only from env; never logged.
- Back-office actions, real-phone and contact views, exact-location shares and failed logins go to the append-only `audit_log` (§9).
- Seed credentials are **development only**; seed script refuses to run when `NODE_ENV=production`.
- **One-time passwords (milestone 7a):** supervisor accounts are created (and their passwords reset) by the super_admin with a server-generated one-time password, shown once in that response and never stored in plain text, logged or audited (the audit entry is `password_issued`). It sets `users.must_change_password`: until the user picks their own password, pages redirect to `/:lang/account/password`, other page form submissions and every API route except `/auth/password`, `/auth/me`, `/auth/refresh`, `/auth/logout` and `/health` return 403 `password_change_required`. A reset revokes the user's sessions.
- **Session revocation (milestone 7a):** any change to a user's role or status, or to a supervisor profile's `is_active`, revokes all of that user's refresh-token families in the same transaction (database triggers, so every code path is covered).
- **Append-only tables:** `audit_log` and `status_history` triggers reject UPDATE, DELETE and TRUNCATE; there is no bypass in the schema. The dev seed and database tests clean them with `session_replication_role = replica` (superuser only, `server/db/devTruncate.ts`); the **production application role must not be a superuser** (milestone 16).

---

## 14. UI / design

- **Brand:** the platform is **AQAR** (Arabic: **عقار**); the operating company is **شركة الذكاء العقاري – Aqar Intelligence**. Page titles and the web manifest use "AQAR" (Arabic pages: "عقار"); the footer and legal/terms pages name the company (i18n `brand.company`). The repository name stays.
- **Light theme default**, dark mode via the header toggle (cookie `theme`); mobile-first, 360–1440 px.
- **Palette (design v2)** (tokens in `app/app.css`; components use the Tailwind tokens, never hex values):

  | Token | Light | Dark |
  |---|---|---|
  | `background` | `#F7F4EF` | `#121519` |
  | `surface` | `#FBF9F6` | `#181D23` |
  | `card` | `#FFFFFF` | `#1E252D` |
  | `border` (dividers, cards) | `#E6DFD4` | `#2C3640` |
  | `foreground` (text) | `#22262B` | `#F1ECE4` |
  | `muted` (secondary text, form-control borders) | `#5F6670` | `#9AA3AD` |
  | `primary` (buttons, fills, clusters) | `#A32A44` | `#C2415A` |
  | `primary-hover` | `#7E1F33` | `#A32A44` |
  | `on-primary` (text on primary, sale/rent and status colours) | `#FFFFFF` | `#FFFFFF` |
  | `secondary` | `#1D6A9E` | `#6FB3E0` |
  | `secondary-hover` | `#154E75` | `#8EC5EA` ¹ |
  | `on-secondary` | `#FFFFFF` | `#121519` ¹ |
  | `accent` (amber: "Add listing" button, featured ring/badge) | `#F2A93B` | `#F2A93B` |
  | `accent-hover` | `#C98516` | `#C98516` |
  | `on-accent` (ink on accent, exchange and warning) | `#22262B` | `#22262B` |
  | `header` (top bar) | `#154E75` | `#0F2A3D` |
  | `on-header` (text and icons on the header) | `#FFFFFF` | `#FFFFFF` |
  | `primary-text` (brand colour as text, links, focus rings) | `#A32A44` | `#E8A0AE` ¹ |
  | `error-text` (error messages) | `#B3261E` | `#F2827A` ¹ |
  | `map-water` / `map-green` (basemap tints) | `#CFE3F0` / `#DCEBD6` | `#17293A` / `#1C2A21` ¹ |

  Status (both themes): success `#2F7D5B`, error `#B3261E`, warning `#E0A43A` (dark text on it).
  Listing types (pins and badges, both themes): sale `#A32A44` and rent `#1D6A9E` with white labels, exchange `#F2A93B` with dark ink.
  ¹ Not given in the brand palette: chosen to meet WCAG AA in dark mode (dark `primary` is ≈3.1–3.7:1 as text on the dark backgrounds, and white on dark `secondary` is 2.3:1) or as the darker equivalents of the light tints.
- **Contrast:** WCAG AA. Text ≥ 4.5:1 on `background`/`surface`/`card` and on the header; form-control borders and focus indicators ≥ 3:1, so inputs use `muted` borders (`border` is for decorative dividers only). `app/theme.contrast.test.ts` checks the token pairs in both themes (incl. white on the header and ink on amber).
- **Header:** the `header` colour with white text and icons, the country as a translucent white chip, and an amber **"أضف إعلانك / Add listing"** button (`accent`, ink text, `accent-hover`). Below it on the map page, the filter bar on a white surface (`card`; dark: card colour) with a subtle bottom border, framing the map. On mobile, a row of listing-type chips (All / For sale / For rent / Exchange, scrolling sideways) and the filters button takes its place.
- **Logo** (`public/brand/`): "AQAR" large with "شركة الذكاء العقاري" underneath. The header (coloured) shows `aqar-logo-dark.svg` in both languages and themes; `aqar-logo.svg` is for light backgrounds; only the mark (`aqar-mark-dark.svg` on the header, `aqar-mark.svg` on light backgrounds) below 400 px wide. Alt text "AQAR – شركة الذكاء العقاري". Don't recolour or stretch the files.
- **Icons:** `aqar-favicon.svg` is the source for `favicon.ico` (16/32/48), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` and `site.webmanifest` (name "AQAR", theme colour `#154E75`), all generated by `npm run icons` (`scripts/generate-icons.ts`, sharp) and committed. `<meta name="theme-color">` follows the header colour per theme. UI icons: `lucide-react` (ISC).
- **Fonts:** IBM Plex Sans Arabic (Arabic) and IBM Plex Sans (Latin), weights 400/500/600/700, self-hosted via `@fontsource` (OFL). Numbers use Western digits by default (setting for Arabic-Indic later).
- **Map:** basemap follows the theme (OpenFreeMap `positron` in light mode, `dark` in dark mode) with water tinted `map-water` and parks/green areas `map-green`. **Pins:** callouts with a pointer tail, in the listing-type colour, white 2px outline and a soft shadow; the hovered/selected pin is slightly larger; featured listings get an amber ring. **Clusters:** `primary` with a white count, a white ring and a soft halo, growing with the count, darker on hover. **Selected/hovered area and drawn search area:** `primary` 2px outline, 8 % fill.
- **Listing cards:** white (`card`), `rounded-xl`, soft shadow, lift and a stronger shadow on hover; image on top (4:3; without a photo, a gradient in the type's colour with a category icon); price large and bold in the primary colour; solid type badge; key facts as icons with numbers (beds, baths, m²); highlighted with their pin (card ↔ pin). Two-column grid in the results panel.
- **Footer** (all pages except the full-screen map): the operating company and links.
- **Motion:** 150–200 ms transitions on hover/focus, smooth bottom-sheet and panel transitions; everything respects `prefers-reduced-motion` (global CSS rule; MapLibre skips animations itself).
- Loading skeletons, empty states, toasts.
---

## 15. Folder structure

```
/app                      # React Router v7 app
  /routes                 # file routes: $lang.$country.map, $lang.property.$id, $lang.backoffice.*, ...
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
SUBMISSIONS_PER_DAY=10   # listing submissions per user per rolling 24 h
# §24: free exchange-rate source (to be chosen; free products only).
EXCHANGE_RATES_URL=
# Milestone 15 (§20): email provider to be chosen (free tier only); names may change with the provider.
EMAIL_FROM=
EMAIL_PROVIDER_API_KEY=
```

---

## 17. Seed data (Jordan)

- Users: 1 super_admin; 2 supervisors with work mobiles (one scoped to Amman city, one to the other Jordanian governorates); 2 agents (1 company, verified) and 1 agent registration under review; 3 owners — dev passwords only.
- Boundaries: Jordan governorates; cities Amman, Irbid, Zarqa, Aqaba; all Amman neighbourhoods from OSM (§2.2), including Abdoun, Khalda, Sweifieh, Jubeiha, Dabouq, Tla' Al-Ali.
- Address settings: the address field catalog and Jordan's country settings (§2.3); a few listings with land-registry identifiers: one verified, two with the same full key written with different digits (duplicate warning), and two apartments in the same parcel (same-building hint).
- Listings: 40 published spread across those areas with realistic coordinates, mixed category/type/price (JOD); 3 pending (one with `needs_location_review`); 2 sold; all approximate (public point 150–300 m from the pin).
- Contact numbers (fallback): 1 global, 1 country (JO), 1 for Amman city, 1 for Abdoun area, 1 property-specific. Published listings are assigned to the supervisor of their area.
- From the milestones that add them: sample enquiries, viewings, offers, a completed deal with a confirmed payment, and a cancellation request.

---

## 18. Phase 1 build order (one milestone per Claude Code session)

Done: 1–6, 4b and 7a (supervisor model; 7b–7e follow, see `docs/CHANGELOG.md`). The order from milestone 7 on follows the business model v2: the supervisor model, assignment and contact come with the back office (7); offers, enquiries/viewings, deals, commission and collections are phase 1 milestones (9–11).

1. **Scaffold:** RR v7 + Express + TS + Tailwind, Docker PostGIS, Knex, `.env.example`, ar/en routing with RTL/LTR, theme toggle, layout shell.
2. **Database:** all phase 1 migrations (+ P2 tables that phase 1 writes to, e.g. `price_history`), address field catalog and country settings, property identifiers, boundary import script, seeds.
3. **Auth:** register/login/logout, cookies, refresh rotation, roles, CSRF, rate limiting.
4. **Map search:** map page, points endpoint, clustering, price pins, filters, URL state, list panel/bottom sheet, draw-to-search.
5. **Listing detail page** incl. contact resolution, similar listings, view counting.
6. **Submit wizard** incl. pin → area lookup, approximate public point, image pipeline, drafts, submission rate limit, listing terms checkbox (§19).

**4b. Text search** (scheduled right after milestone 6): search bar with bilingual free-text search, Arabic normalization, typo tolerance, location autocomplete, "near me" (§5.6). PostgreSQL only.

7. **Back office & supervisor model:** roles `super_admin` (replaces `admin`), `supervisor` (and the reserved `financier` value); supervisor accounts, work mobiles and scopes; scope filtering; **agent registration approval** with status history; **listing assignment** on submission (deepest scope match, super_admin queue fallback, reassignment); moderation (approve / reject / **return for changes**); **public contact = supervisor's work mobile** with the `contact_numbers` fallback; lister-phone view (audited); **contact details in listing text** flagged in the moderation queue on submit and every edit, with the detection audited (§8.1); `status_history` and `audit_log`; overdue reminders (§26); address settings, contact numbers, users, boundary viewer, basic counts (§3, §4.2, §8, §9).
8. **Profile:** My Listings (returned/rejected reasons, edit and resubmit, re-review on price/pin/photo edits, archive with reason), Saved, Settings (incl. display currency), registration status; agent company page; agent dashboard; owner statistics (§11).
9. **Enquiries & viewings:** enquiry form and supervisor-logged calls, enquiry pipeline, viewing appointments (request, propose, confirm, reschedule, cancel, outcome), exact-location sharing on confirmation (audited) (§22).
10. **Offers:** submission with the per-country minimum, supervisor review, forwarding, accept / reject / counter, reservation, public summary (§21).
11. **Deals, commission & collections:** deal recording with evidence and confirmations, completion → commission due; commission agreements; payments with proof and super_admin confirmation; supervisor share; approvals (waivers, downward corrections, refunds, cancellations) and refunds with the administrative fee; invoices; My commissions; follow-up list (§19, §23).
12. **Listing page extras:** display currency conversion with stored rates (§24) and the financing calculator (§25).
13. **SEO:** area pages, meta/JSON-LD, hreflang, sitemap, robots.
14. **Hardening:** tests for contact privacy (real phone, buyers' details, true point never in public responses or rendered HTML; scope isolation between supervisors), Playwright happy paths, performance check with 10k seeded listings.
15. **Launch readiness:** the server refuses to start in production while the active terms version is a draft (§20); email sending (free-tier provider), password reset, email verification (required before submitting listings), new-device login notice, personal-data export and account deletion (§20).
16. **Deployment:** the VPS setup from §0 — Node 24 LTS app, PostgreSQL 16 + PostGIS on localhost (with `postgresql-contrib` for `pg_trgm`), Caddy with automatic HTTPS (behind Cloudflare: Caddy trusts Cloudflare's IP ranges and forwards the real client IP, so rate limits see visitors, not Cloudflare), `/uploads` served by Caddy, private files outside it, nightly `pg_dump` + file backups off the VPS; the app connects as a non-superuser role (owner of its tables), so the append-only audit triggers cannot be skipped.

**After launch** (§25, §27): [P2] financing providers, disputes, market intelligence, the other §12 items; [P3] property catalog, configurable workflow/SLA/permission engines, native mobile apps.

Each milestone ends with: typecheck clean, tests passing, short note in `docs/CHANGELOG.md`.

---

## 19. Revenue model: commission, supervisor share and collections

**Decision:** AQAR earns a commission on deals completed for listings on the site. **Legal:** brokerage licensing must be confirmed per country with a lawyer before charging any commission, and the terms text needs legal review (Arabic and English).

**Commission**
- **Rate:** per country (`countries.commission_rate numeric(6,4)`, default `0.0100`), **overridable per agreement**: `commission_agreements (id, country_code FK, user_id FK nullable, company_id FK nullable, rate numeric(6,4), valid_from, valid_to nullable, notes, created_by FK, created_at)` — set by the super_admin for an agent, a company or an owner. The applicable rate (agreement on the deal date, else the country's) is **copied into each commission record**, so later changes never affect existing deals.
- **Basis:** sale → the **final** sale price; rent → the **annual** rent (monthly rent × 12 for `monthly`, the yearly rent for `yearly`). Exchange deals: no commission at launch (revisit later).
- **Payer — the lister:** the agent if an agent submitted the listing, otherwise the owner (`commission_payer_type`, §4.1).
- **Terms:** accepted at submission (§7), stored per listing (`commission_terms_version`, `commission_terms_accepted_at`). A new terms version applies to listings submitted after it.
- **When it is due:** a commission record is created with status `due` when the **deal completes** (§23); the due date is the completion date plus the country's payment period (`countries.commission_due_days`).
- `commissions (id, deal_id FK, property_id FK, payer_user_id FK, payer_type ENUM[agent, owner], deal_type ENUM[sale, rent], basis_amount numeric(14,3), currency char(3), rate numeric(6,4), agreement_id FK nullable, commission_amount numeric(14,3), collected_amount numeric(14,3) default 0, status ENUM[due, partially_paid, paid, waived, refunded, partially_refunded], due_date, notes, created_at, updated_at)`. "Overdue" is derived (`due_date` passed and not paid/waived), not stored. Amounts use the country's decimal count; currency from the listing's country.

**Supervisor share**
- The deal's supervisor earns a share of AQAR's commission: `countries.supervisor_share_rate numeric(6,4)` (percentage of the commission, per country). It is **calculated only from collected commission confirmed by the super_admin**: each confirmed payment accrues `payment.amount × share rate` (rate copied at confirmation); refunds reverse it proportionally.
- `supervisor_earnings (id, supervisor_id FK, commission_id FK, payment_id FK nullable, refund_id FK nullable, amount numeric(14,3) (negative for reversals), currency, rate numeric(6,4), status ENUM[accrued, paid_out], paid_out_at, created_at)`.

**Collections**
- Phase 1 collection is **manual** (bank transfer / CliQ / cash / other); online payment is [P2].
- The **supervisor records each payment with proof** (transfer reference and/or receipt image — private file); the **super_admin confirms** (or rejects with a reason) each payment. Only confirmed payments change `collected_amount` and the commission status.
- `commission_payments (id, commission_id FK, amount numeric(14,3), currency, method ENUM[bank_transfer, cliq, cash, other], reference, proof_file_key nullable, recorded_by FK, recorded_at, status ENUM[recorded, confirmed, rejected], confirmed_by FK nullable, confirmed_at, reason)`.
- A collection in another currency records the rate used and any margin (§24).

**Controls — super_admin approval required**
- **Commission waivers** (full or partial), **downward corrections of a final price** (upward ones are audited but need no approval), **all refunds**, and **cancelling a completed deal**.
- `approval_requests (id, type ENUM[commission_waiver, final_price_decrease, refund, deal_cancellation], entity_type, entity_id, payload jsonb (amounts), reason, requested_by FK, requested_at, status ENUM[pending, approved, rejected], decided_by FK nullable, decided_at, decision_reason)`.
- **Cancellation of a completed deal:** request with reason → super_admin approval → the deal is `cancelled`, the listing returns to `published` (or `archived`), and a **refund = collected commission − administrative fee**, the fee being **10 % of the collected commission** (`countries.cancellation_fee_rate`, default `0.10`). `commission_refunds (id, commission_id FK, approval_request_id FK, collected_amount, fee_amount, refund_amount, currency, method, reference, proof_file_key, status ENUM[approved, paid], paid_by FK, paid_at)`.
- **Everything is audited** (§9) and every status change is in the status history (§26).

**Screens:** back office (§9) — due / overdue / paid / waived / refunded, filters by country, supervisor, payer, date; payment recording and confirmation; approvals queue; a downloadable **invoice** for the payer (printable page, saved as PDF from the browser — no paid service), with the deal's enquiries shown for traceability; supervisor earnings. Listers: **My commissions** (§11).

**Placement:** listing terms checkbox — milestone 6; everything else — milestone 11 (follow-up list included).

**Open question (decide before milestone 11):** sales tax on the commission and invoice numbering requirements in Jordan (accounting/legal review).

---

## 20. Launch readiness (milestone 15)

- **Commission terms:** the server **refuses to start in production while the active commission terms version is a draft** (milestone 6 ships `2026-11-draft`, pending legal review, §19).
- **Email:** sent through a **free-tier** provider (to be chosen; free products only), behind an `emailService` interface so the provider can change. Bilingual templates (the user's language). A sending failure never blocks the user's action, and addresses and tokens are never logged.
- **Email verification at registration:** a one-time code or link (to be chosen at the start of the milestone); tokens stored as HMAC hashes with an expiry, single use. **Unverified accounts cannot submit listings** (they can browse, save and keep drafts); the check applies from milestone 15, and until then submission is allowed without verification.
- **Password reset** by email link: single-use, short-lived token (stored hashed); the same response whether or not the email exists; a reset revokes the user's sessions (refresh-token families, §13).
- **No SMS OTP in phase 1** (SMS is always paid); listed as a later option (§12).
- **New-device login notice:** an email when someone logs in from a device not seen before (device identified by a first-party cookie id stored as a hash, plus a coarse user-agent summary); the email says how to secure the account.
- **Personal data (Jordan Personal Data Protection Law):**
  - **Export:** the user downloads their data (profile, listings, saved listings, enquiries, viewings, offers, deals and commission records) as a file.
  - **Account deletion:** the user deletes their account; their listings are archived; personal data (name, email, phones, profile) is removed or anonymized; sessions are revoked. The audit trail, status history, deals and commission records keep only non-personal references (e.g. a user id with no personal data attached) where the law allows. Enquiry, viewing and offer contact data follows the same rules on request; financing data [P2] per the consent records (§25).
  - The exact retention rules need legal review before launch.

---

## 21. Offers (milestone 10)

- **Who:** logged-in users (not the listing's own lister) on `sale` and `rent` listings that are `published`. Exchange listings take a text **exchange proposal** instead of an amount (no minimum).
- **Minimum:** amount ≥ **X % of the listed price**, X per country (`countries.min_offer_ratio numeric(4,3)`, default `0.800`), set by the super_admin. Validated **server-side** (and in the form), 400 with a clear message: "الحد الأدنى للعرض هو {amount}" / "The minimum offer is {amount}". Rentals: on the listed rent for the listed period.
- **Flow (fixed, §26):** `submitted → under_review` (the listing's supervisor) `→ forwarded` (to the lister) `→ accepted | rejected | countered`; the supervisor can also decline before forwarding (`declined`, reason) and the bidder can `withdraw` an open offer; offers can `expire` (expiry date set by the supervisor). A **counter** is a new linked offer in the other direction (lister → bidder), relayed by the supervisor, with the same states; the chain continues until one side accepts or rejects.
- **Accepted:** the listing becomes `reserved` (§4.2) and a deal is opened (§23); the other open offers on the listing are closed (`superseded`) and their bidders informed through the supervisor.
- **Visibility (replaces `offers_visibility`):**
  - **Visitors and other users:** only the **number of approved offers** (forwarded or later) and the **highest approved amount** — never names, never the bidder's details.
  - **The lister:** all offers forwarded to them (amount, time, conditions; the bidder shown as "a buyer" — no contact details).
  - **The supervisor (in scope) and the super_admin:** all offers with bidder details.
  - **A bidder:** their own offers and counters.
- `offers (id, property_id FK, bidder_id FK, parent_offer_id FK nullable (counter chain), direction ENUM[to_lister, to_bidder], amount numeric(14,3) nullable, currency, proposal_text nullable (exchange), conditions, status ENUM[submitted, under_review, forwarded, accepted, rejected, countered, declined, withdrawn, expired, superseded], status_reason, supervisor_id FK, expires_at, created_at, updated_at)`. The accepted amount is copied to the deal (§23); the asking price is never changed by an offer.
- Overdue reminders: offers `submitted`/`under_review` for more than 48 h, `forwarded` without a lister answer for more than 48 h (§26).

---

## 22. Enquiries & viewings (milestone 9)

**Enquiries**
- **Sources:** the **enquiry form** on the listing page (logged-in users; message, preferred contact time) and **calls/WhatsApp** received on the supervisor's number, logged by the supervisor (caller name and phone encrypted, §8).
- Assigned to the **listing's supervisor** (else the super_admin queue). Pipeline: `new → contacted → qualified → viewing_requested → offer_submitted → converted | closed | lost` (with reason).
- Listers see only **counts** per listing, never the enquirer's details.
- `enquiries (id, property_id FK, user_id FK nullable, source ENUM[web_form, call, whatsapp, other], contact_name_encrypted nullable, contact_phone_encrypted nullable, contact_phone_hash nullable, message, supervisor_id FK nullable, status ENUM[new, contacted, qualified, viewing_requested, offer_submitted, converted, closed, lost], status_reason, created_at, updated_at)` (replaces the earlier call-only enquiry log).

**Viewings**
- Request (by the user, from the listing or an enquiry) → the supervisor **proposes** time(s) → the user **confirms** → it can be **rescheduled** or **cancelled** (by either side, with reason) → after the viewing the supervisor records the **outcome** (`interested`, `not_interested`, `offer_expected`, `no_show`) and notes.
- **Exact location:** when a viewing is **confirmed**, the supervisor shares the exact pin, a map link and the `exact_only` address fields with that client (§4.3). The share is recorded on the appointment (`location_shared_at`, `location_shared_by`) and audited; the client sees it on their viewing page only (`private, no-store`).
- `viewing_appointments (id, property_id FK, enquiry_id FK nullable, user_id FK, supervisor_id FK, status ENUM[requested, proposed, confirmed, rescheduled, cancelled, completed], proposed_times jsonb, scheduled_at, location_shared_at, location_shared_by FK nullable, outcome ENUM[interested, not_interested, offer_expected, no_show] nullable, notes, cancel_reason, created_at, updated_at)`.
- Overdue reminders: requests without a proposal for more than 48 h (§26).

---

## 23. Deals (milestone 11)

- A deal opens when an offer is accepted (listing `reserved`), or when the lister reports "sold/rented through AQAR" (§4.2), or when the supervisor opens one from the follow-up list.
- **Flow:** `reserved → price_recorded` (the supervisor records the **final price** and **evidence**: the contract, or written confirmations — private files) `→ awaiting_confirmation` (buyer and seller confirm in their accounts, or the supervisor records each party's confirmation, with how it was given) `→ completed` (the listing becomes `sold`/`rented`; the **commission is due**, §19). A reserved deal can be `abandoned` (reason; the listing returns to `published`). A completed deal can be **cancelled only with super_admin approval** (§19).
- **Prices are kept separately:** `asking_price` (the listing's price at the time), `accepted_offer_amount` (if any), `final_price`. **Only verified final prices** (completed deals with evidence) feed analytics and price insights; asking prices and negotiated amounts are labelled as such.
- `deals (id, property_id FK, offer_id FK nullable, buyer_user_id FK nullable, lister_user_id FK, supervisor_id FK, deal_type ENUM[sale, rent], asking_price, accepted_offer_amount nullable, final_price nullable, rent_period nullable, annual_amount nullable, currency, status ENUM[reserved, price_recorded, awaiting_confirmation, completed, abandoned, cancellation_requested, cancelled], evidence jsonb (private file keys), buyer_confirmed_at, buyer_confirmation_method, seller_confirmed_at, seller_confirmation_method, completed_at, final_price_verified bool, financing_offer_id nullable (§25, [P2]), status_reason, created_at, updated_at)`.

---

## 24. Currency display (milestone 12)

- Every listing stays in its **country's currency** (CLAUDE.md rule 5). Prices can additionally be shown **converted into a display currency** chosen by the visitor (setting, cookie for visitors), marked **"≈"** and labelled as an estimate.
- **No margin** on display conversion. Rounded to the nearest 1 below 1,000 and to the nearest 10 from 1,000 up (in the display currency).
- **Rates** from a **free** source (to be chosen; free products only, `EXCHANGE_RATES_URL`), fetched daily by a scheduled job and stored: `exchange_rates (id, base char(3), quote char(3), rate numeric(18,8), rate_date, source, fetched_at)`. The rate and its date are stored with any record that used one (e.g. a payment in another currency), so amounts can be reproduced later.
- **Margins** apply only when **collecting commission in another currency** (§19): the rate, the margin and the date are recorded on the payment.

---

## 25. Financing

**Calculator (phase 1, milestone 12)**
- On the listing page: price (prefilled with the asking price, editable), down payment (amount or %), annual rate (labelled "interest or profit rate"), years → **monthly instalment** and **total cost** (annuity formula; 0 % handled). Clearly marked as an **estimate**, not an offer. Calculation in the browser; nothing stored.
- Later the entry point for financing requests (below).

**Financing providers [P2]** (role `financier`)
- **Who:** licensed financial brokerage companies and licensed banks offering mortgage financing.
- **Onboarding:** an organisation account — name (ar/en), type (`bank`, `financial_broker`), licence number, regulator, countries served, logo — **approved only by the super_admin after licence verification**. The organisation has several staff users (role `financier`) and **sees only requests addressed to it**.
- **Financing request:** a logged-in user applies from the listing page (starting from the calculator): income, employer, existing obligations, down payment, requested tenor, documents (**private, encrypted**). The applicant chooses one or more financiers, or all active financiers in the country, and gives **explicit consent per financier** to share their data (consent record with time and text version — Jordan PDPL).
- **Financier access:** for each request addressed to it, the full property data needed for valuation (exact location, area, features, photos, parcel identifiers) — **never the owner's real phone**. The listing terms include the lister's consent to share property data with licensed financiers when a buyer applies for financing (§4.1, §7).
- **Financier response:** decision (`approved`, `conditionally_approved`, `rejected`, `more_info_needed`) with reason; offer details: financing amount, rate type (**interest or Islamic profit rate, fixed or variable**, labelled correctly), rate, tenor, monthly instalment, fees, conditions, offer expiry date.
- **Applicant:** compares received offers side by side and selects one; the selection is linked to the deal (`deals.financing_offer_id`). AQAR never presents an offer as guaranteed.
- **AQAR customer benefit:** AQAR takes **no fee or commission from financiers**. Each financier's agreement defines an "AQAR customer benefit" (rate discount, processing-fee waiver, or cashback on funding), stored per financier with validity dates. **Every financier response states this benefit in a separate, clearly labelled field**, shown on the offer and in the comparison. The applicant-facing text says the benefit is provided by the financier under its agreement with AQAR, and that **AQAR receives nothing from the financing**.
- **Controls:** every view of applicant data is audited; expected response time per financier (e.g. 3 business days) with overdue reminders; financiers see only their own requests.
- **Data model:** `financiers`, `financier_users`, `financier_benefits (validity dates)`, `financing_requests`, `financing_request_targets` (per financier, with consent), `financing_consents (text version, time)`, `financing_documents` (encrypted, private), `financing_offers`. **Prepared in phase 1** where it avoids later migrations or re-consent: the `financier` role value (milestone 7), `deals.financing_offer_id` (milestone 11, nullable; FK added in P2), and the data-sharing clause in the listing terms (next terms version, before launch). The rest is delivered in phase 2.

---

## 26. Workflows, status history & reminders

- **Workflows are fixed and predefined in code** (listing review, agent registration, enquiries, viewings, offers, deals, payments, approvals). There is **no configurable workflow, SLA or permission engine in phase 1** (§27).
- **Every status change is stored** with actor, time and reason: `status_history (id bigserial, entity_type, entity_id, from_status, to_status, actor_user_id FK nullable, reason, created_at)` — append-only like `audit_log`, so an engine can be added later without losing history.
- **Overdue reminders (simple):** a scheduled job in the app process (every 15 minutes) flags items waiting longer than fixed thresholds — **48 h** for pending listing reviews, agent registrations, offers under review or awaiting the lister, viewing requests without a proposal, and payments awaiting confirmation. Overdue items are highlighted in the back office (per supervisor and for the super_admin) and, from milestone 15, emailed daily to the person responsible. Thresholds are constants in code.

---

## 27. Later phases

- **[P2] Financing providers** (§25).
- **[P2] Disputes:** initiation (by a party or the supervisor), assignment, evidence (private files), resolution and full history.
- **[P2] Market intelligence:** asking vs. negotiated vs. verified final prices, price per m², trends by area and period, with a data-confidence indicator (sample size, share of verified prices).
- **[P3] Property catalog** separate from listings: asset hierarchy (land → building → units); listings reference assets; identity resolution (identifiers, location, features) with **manual review of uncertain matches**; merge history.
- **[P3] Configurable workflow, SLA and permission engines** (built on `status_history`, §26).
- **[P3] Native mobile apps** (iOS/Android), after launch, on the same `/api/v1`.
