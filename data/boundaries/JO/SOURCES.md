# Jordan boundary data — sources

Imported by `npm run db:import-boundaries -- JO` using `manifest.json` (SPEC §2.2).
OSM files were downloaded on **2026-11-26** with `npx tsx scripts/fetch-osm-boundaries.ts`
(free Overpass API; relations are assembled into polygons by PostGIS `ST_BuildArea`).

## Licence and attribution

Files named `osm-*.geojson` are derived from **OpenStreetMap** and are licensed under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
The site must credit **"© OpenStreetMap contributors"** wherever these boundaries are shown
(the map attribution already includes it). Boundaries the import generates from this data
(`source = generated`) are derived databases under the same licence.

## Files

| File | Contents | Count | OSM query |
|---|---|---|---|
| `osm-governorates.geojson` | Governorates (`boundary=administrative`, `admin_level=4`) | 12 | `area["ISO3166-1"="JO"][admin_level=2]; relation(area)[boundary=administrative][admin_level=4]; out geom;` |
| `osm-city-districts.geojson` | Districts (لواء, `admin_level=5`) merged into the four seed cities | 8 | `relation(id:13376001,13376002,13376005,13376006,13376007,13376097,13376133,13376081); out geom;` |
| `osm-amman-neighbourhood-points.geojson` | Neighbourhood points in Amman governorate (`place=neighbourhood`) | 146 | `rel(2926344); map_to_area; node(area)[place=neighbourhood]; out;` |
| `osm-amman-neighbourhood-polygons.geojson` | Neighbourhoods drawn as areas in OSM (Dabouq) | 1 | `way(id:277741642); out geom;` |
| `osm-amman-municipal-district-points.geojson` | Greater Amman municipal districts (`place=suburb`) — **not imported**, see below | 21 | `rel(2926344); map_to_area; node(area)[place=suburb]; out;` |
| `manual-amman-neighbourhood-points.geojson` | Neighbourhoods missing from OSM, placed by hand (Jubeiha) | 1 | — |

## How each level is built

- No simplification (`simplify_m: 0`): simplifying each polygon separately opened ~1.5 ha overlaps
  between neighbouring governorates.
- **Governorate** — the 12 OSM polygons as they are (`source = osm`). English names from OSM `name:en`,
  with spelling overrides in `manifest.json` (Jerash, Ajloun, Karak, Ma'an).
- **City** — OSM has no municipal boundaries for these cities, so each city is the union of its
  districts (`source = generated`):
  - Amman = Amman Qasabah + Marka + Quaismeh + Al-Jami'ah + Wadi Essier
  - Irbid = Irbid Qasabah · Zarqa = Zarqa Qasabah · Aqaba = Aqaba Qasabah

  These are larger than the built-up city (Aqaba Qasabah includes desert).
- **Area (Amman neighbourhoods)** — one nearest-point (Voronoi) cell per neighbourhood point,
  computed in UTM 36N and clipped to the Amman city boundary (`source = generated`, an admin can
  replace any of them later). Points with the same Arabic name are merged into one area
  (currently الياسمين). Dabouq keeps its real OSM outline (`source = osm`) plus the part of its cell
  outside it; neighbouring cells exclude the outline, so areas never overlap and leave no gaps.
  Dabouq's OSM outline straddles the OSM Amman/Balqa governorate border (~41% in Balqa); only the
  part inside Amman city is used.
  Points outside the Amman city boundary are skipped (the import reports them): البنيات الجنوبية,
  البنيات الشمالي, ام الجدايل. Result: 144 areas (146 points − 3 outside − 1 merged + Dabouq + Jubeiha).
- **English names** missing in OSM are transliterated from Arabic and stored with
  `name_en_reviewed = false` for an admin to correct.

## Manual points

`manual-amman-neighbourhood-points.geojson` — Jubeiha (الجبيهة) has no neighbourhood point in OSM.
Its position is recorded in the file's `note` property; **verify it on a map** and adjust if needed.

## Not imported: Greater Amman municipal districts

OSM tags 21 Greater Amman Municipality districts (مناطق) as `place=suburb`. Each contains several
neighbourhoods, so mixing them into the neighbourhood cells would take space away from their own
neighbourhoods. They are kept in `osm-amman-municipal-district-points.geojson` for a possible later
level between city and area (it would need its own entry in the address field catalog and Jordan's
settings, and a `cells` layer clipped to Amman):

| Arabic | English (OSM) | OSM | Lat, Lng |
|---|---|---|---|
| منطقة القويسمة | Al Quwaysimah | node/798906612 | 31.9167, 35.9500 |
| شفا بدران | — | node/1923515191 | 32.0402, 35.9072 |
| منطقة مرج الحمام | Marj Al-hamam | node/4064715581 | 31.9017, 35.8517 |
| الكمالية | Al Kamaleyah | node/4232938787 | 32.0294, 35.8260 |
| منطقة أبو نصير | Abu-Nusair | node/4267496190 | 32.0520, 35.8805 |
| منطقة وادي السير | Wadi Al-Seer | node/4267499255 | 31.9546, 35.8299 |
| منطقة طارق | — | node/4301448530 | 31.9930, 35.9447 |
| منطقة المقابلين | — | node/7489174028 | 31.8963, 35.9041 |
| جاوا | — | node/7489665448 | 31.8594, 35.9350 |
| منطقة اليرموك | — | node/7489752744 | 31.9356, 35.9381 |
| منطقة رأس العين | — | node/7489808015 | 31.9308, 35.9277 |
| منطقة ناعور | — | node/7528884902 | 31.8704, 35.8202 |
| منطقة تلاع العلي | — | node/7529858090 | 31.9947, 35.8662 |
| منطقة بسمان | — | node/7529869944 | 31.9877, 35.9239 |
| منطقة النصر | — | node/7533627218 | 31.9526, 35.9668 |
| منطقة ماركا | — | node/7537470429 | 31.9777, 35.9801 |
| منطقة التطوير | — | node/7537845238 | 31.9968, 36.0536 |
| منطقة بدر | — | node/7537887410 | 31.9307, 35.9070 |
| منطقة زهران | — | node/7537893769 | 31.9543, 35.9041 |
| منطقة احد | — | node/7542445322 | 31.8876, 36.0326 |
| منطقة المدينة | — | node/7546179365 | 31.9450, 35.9288 |

## Refreshing

1. `npx tsx scripts/fetch-osm-boundaries.ts` (or `--only=points` etc.) with the dev database running.
2. Review the diff; update the date and counts above.
3. `npm run db:import-boundaries -- JO` and check the report (warnings, unreviewed names).
