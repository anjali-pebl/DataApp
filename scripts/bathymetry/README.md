# Bathymetry tile pipeline

Turns a UKHO BAG file into depth + contour Web Mercator tiles for the
DataApp Bathymetry map mode. Spec: `BATHYMETRY_PIPELINE_HANDOFF.md`
(shipped with the source bathymetry zip).

## Layout

```
scripts/bathymetry/
├── bathymetry_lib.py        Shared algorithms (BAG->WGS84, tiles, contours, bake, upload)
├── pipeline_ramsey.py       Reference per-project pipeline — copy and edit per area
├── generate_z16.py          z16 generator (run after all per-project pipelines)
├── requirements.txt
├── raw/         (gitignored)  drop BAG files here, one subfolder per project
├── geotiffs/    (gitignored)  intermediate WGS84 GeoTIFFs
├── geojson/                   contour LineString FeatureCollections (kept in git when small)
└── tiles/       (gitignored)  output PNG tiles before Supabase upload
```

## Per-area workflow

```bash
cd scripts/bathymetry
pip install -r requirements.txt          # one-time

# 1. drop the .bag for <project> into raw/<project>/
# 2. cp pipeline_ramsey.py pipeline_<project>.py and edit:
#       PROJECT_KEY, BAG_PATH (and TIF_OUT / TILES_DIR / CONT_DIR / GEOJSON follow)
# 3. python pipeline_<project>.py
# 4. add a PROJECTS entry to generate_z16.py, then: python generate_z16.py
# 5. (later, manually) wire <project>_ukho and <project>_ukho_c into
#    src/components/map/LeafletMap.tsx — deferred until tiles are inspected
```

Per the handoff doc each area takes 15–30 min for z10–z15 and another 5–20 min
for z16. The output goes to the `bathymetry-tiles` Supabase bucket.

## Validation targets

The two reference areas are already on Supabase. If you run the pipeline for
either one, the tile counts should match exactly:

| Project       | z10 | z11 | z12 | z13 | z14 | z15 | z16  |
|---------------|----:|----:|----:|----:|----:|----:|-----:|
| Bideford Bay  |   4 |  10 |  29 |  80 | 227 | 741 | 2362 |
| Ramsey Sound  |   1 |   1 |   4 |  12 |  40 | 130 |  428 |

## Env

`.env.local` at the repo root must contain:

```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Bucket is `bathymetry-tiles` (public read).

## Notes

- Tile generation skips wholly-nodata tiles — counts above are the surviving (non-empty) tiles.
- Contour rendering walks every coord and uses an x-pixel spacing check
  (`abs(px - last_px) < N`) to decide whether to drop a depth label. Defaults:
  60 px at z10–z15, 80 px at z16. Don't go below ~30 px or labels overlap.
- Upload uses POST first, PUT on 409. Both succeed — re-running overwrites.
