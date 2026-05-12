# Bathymetry tile integration — implementation plan & session handoff

Working doc for finishing the integration of UKHO bathymetry tiles into the
DataApp `/map-drawing` page. Self-contained: if you only had this file you
should be able to pick up exactly where the previous session left off.

- **Branch:** `bathymetry-tiles` (created off `mobile-optimizing`)
- **Spec reference:** `BATHYMETRY_PIPELINE_HANDOFF.md` shipped inside the
  source bathymetry zip (`C:\Users\anjal\Downloads\11 - Bathymetry data-20260512T010944Z-3-001.zip`,
  entry `11 - Bathymetry data/BATHYMETRY_PIPELINE_HANDOFF.md`). An extracted
  copy is also at `C:\Users\anjal\AppData\Local\Temp\bathy_handoff\BATHYMETRY_PIPELINE_HANDOFF.md`.
- **Pipeline code:** `scripts/bathymetry/` (this folder)
- **Live tile bucket:** Supabase `bathymetry-tiles` (public read), creds in
  `.env.local` at repo root (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).

---

## 1. Status snapshot

| Stage | State |
|---|---|
| Pipeline scripts built | ✅ `bathymetry_lib.py`, `pipeline_<area>.py`, `generate_z16.py` |
| Python deps installed  | ✅ rasterio 1.5.0, scikit-image 0.26.0, dotenv 1.2.2 (system Python 3.13) |
| Pipeline validated against handoff doc reference tile counts | ✅ Bideford Bay matches 4/10/29/80/227/741 exactly |
| Local tile generation for Blakeney, Pabay, St Brides (Block 4a), Ramsey Sound | ✅ done (`UPLOAD=False`) |
| Tile upload to Supabase for the 3 new areas | ❌ pending |
| z16 generation for the 3 new areas | ❌ pending (slow stage) |
| `LeafletMap.tsx` config (`UKHO_DEPTH_TILES` / `UKHO_CONTOUR_TILES`) | ❌ pending — does not exist in repo yet |
| Frontend overlay rendering | ❌ pending |
| Bathymetry toggle wiring | ⚠️ partial — toggle exists but only swaps basemap (no UKHO overlay) |
| Cleddau, Milford Haven | ⏸ deferred — source zips ship CSV point clouds, no BAG. User to locate BAGs. |

---

## 2. Local artifacts inventory

All under `scripts/bathymetry/`. Subfolders `raw/`, `geotiffs/`, `tiles/` are gitignored.

### Raw BAGs (`raw/`)
| Folder | BAG filename | Size | Area |
|---|---|---|---|
| `bidefordbay/`  | `2007 HI1158 Barnstaple Bay Part 1 2m SB-…bag` | 184 MB | Bideford Bay (validation reference) |
| `blakeney/`     | `2014 HI1447 Blakeney Overfalls 1m CUBE-…bag` | 76 MB  | Blakeney Overfalls |
| `pabay/`        | `2019 HI1567 Linne Crowlin and Loc Carron 2m SDTP-…bag` | 68 MB | Pabay / Inner Sound |
| `ramseysound/`  | `2012 HI1365 St Brides Bay Blk 5 2m SB-…bag` | 17 MB | Ramsey Sound (BAG internal name is misleading; data is Ramsey) |
| `stbrides/`     | `2012 HI1365 St Brides Bay Blk 4a 2m SB-…bag` | 9 MB | St Brides Bay Block 4a |

### Intermediate WGS84 GeoTIFFs (`geotiffs/`)
One `.tif` per area. Big files (10s–100s MB); also gitignored.

### Tiles (`tiles/`)
Each area has `<key>_ukho/` (depth) and `<key>_ukho_c/` (depth + contour + labels).
Tile counts per zoom (matches what `_ukho/` and `_ukho_c/` both have, since the contour pass copies non-intersecting depth tiles through unchanged):

| Area | z10 | z11 | z12 | z13 | z14 | z15 | Contour features |
|---|---:|---:|---:|---:|---:|---:|---:|
| `bidefordbay`  | 4 | 10 | 29 | 80 | 227 | 741 | 753 |
| `blakeney`     | 2 | 4 | 7 | 22 | 67 | 220 | 575 |
| `pabay`        | 5 | 7 | 22 | 55 | 164 | 493 | 1461 |
| `ramseysound`  | 1 | 1 | 4 | 12 | 40 | 130 | 876 |
| `stbrides`     | 4 | 4 | 6 | 12 | 34 | 106 | 65 |

### Contour GeoJSONs (`geojson/`)
`<key>_contours.geojson` per area, LineString FeatureCollection with `properties.depth` per feature.

### Per-area pipeline scripts
- `pipeline_bidefordbay.py`  (validation run, can be deleted if you want — already on Supabase)
- `pipeline_blakeney.py`
- `pipeline_pabay.py`
- `pipeline_ramseysound.py`
- `pipeline_stbrides.py`
- `pipeline_ramsey.py`  ← original handoff-doc template, points to a non-existent generic `ramsey.bag`. Keep as a "copy me" template or delete; up to you.

---

## 3. Supabase bucket state (`bathymetry-tiles`)

What's there as of last check:

```
bidefordbay/            (z10-z14 only, 18 tiles total)  ← pre-pipeline / older import; NOT the _ukho version
bidefordbay_ukho/       (z10-z16, 3453 tiles)           ← reference pipeline output
bidefordbay_ukho_c/     (z10-z16, 3453 tiles)
ramseysound/            (z10-z14 only)                  ← older pre-pipeline import
ramseysound_ukho/       (z10-z16, 616 tiles)            ← reference pipeline output
ramseysound_ukho_c/     (z10-z16, 616 tiles)
blakeneyoverfalls/      (z10-z14 only)                  ← older import, NOT pipeline output
milfordhaven/           (z10-z14 only)                  ← older import
pabayinnersound/        (z10-z14 only)                  ← older import
lochbay/                (z10-z14 only)                  ← extra area not in our TODO list
lochsunart/             (z10-z14 only)                  ← extra area not in our TODO list
geojson/
  bidefordbay_contours.geojson
  ramseysound_contours.geojson
```

The bare `<area>/` folders (no `_ukho` suffix) appear to be an earlier first-pass tile set predating the UKHO pipeline. The handoff doc's frontend lookup only references `_ukho` / `_ukho_c` folders, so these are essentially orphaned — leave them or clean them later.

After step 4.1 below the bucket will additionally contain:
```
blakeney_ukho/   blakeney_ukho_c/
pabay_ukho/      pabay_ukho_c/
stbrides_ukho/   stbrides_ukho_c/
geojson/blakeney_contours.geojson  pabay_contours.geojson  stbrides_contours.geojson
```

Note: the locally generated `ramseysound_ukho/` is bit-equivalent to what's already on Supabase (counts match exactly: 1/1/4/12/40/130). Re-uploading is a no-op; safe but unnecessary.

---

## 4. Step-by-step execution plan

### 4.1 — Upload the 3 new tile sets to Supabase  *(~15 min wall-clock)*

In each of `pipeline_blakeney.py`, `pipeline_pabay.py`, `pipeline_stbrides.py`:

```python
UPLOAD = True
```

Then run them. The library's "geotiff exists" guard skips reprojection
(the `.tif`s are already on disk and >1 MB), so each run jumps straight to
re-tiling + uploading. Re-tiling is cheap. Tile uploads use POST then PUT-on-409
with `x-upsert: true` — idempotent.

```bash
cd scripts/bathymetry
python pipeline_blakeney.py
python pipeline_pabay.py
python pipeline_stbrides.py
```

Also push the contour GeoJSONs into the `geojson/` subfolder of the bucket
(small files; can be done with a one-liner — see snippet at §9.1).

**Expected:** `ok` counts in upload summary should equal the tile counts in §2
(322, 746, 166 tiles per layer respectively). Re-running is safe — any failed
uploads will retry, successful ones overwrite identically.

**Verification:** `node -e "..."` snippet in §9.2 lists what's in the bucket.

### 4.2 — Generate z16 tiles  *(~30–60 min wall-clock, slow stage)*

Per decision #3, `ramseysound` and `bidefordbay` are NOT added — their z16 tiles are
already on Supabase. Only the 3 new areas need z16 generation.

Edit `generate_z16.py` and add to `PROJECTS`:

```python
PROJECTS = [
    {
        "name":      "Blakeney Overfalls",
        "tif":       BASE / "geotiffs" / "blakeney_ukho.tif",
        "tiles_dir": BASE / "tiles"    / "blakeney_ukho",
        "cont_dir":  BASE / "tiles"    / "blakeney_ukho_c",
        "geojson":   BASE / "geojson"  / "blakeney_contours.geojson",
        "depth_key": "blakeney_ukho",
        "cont_key":  "blakeney_ukho_c",
    },
    {  # repeat for pabay and stbrides
        "name": "Pabay / Inner Sound",
        "tif": BASE/"geotiffs"/"pabay_ukho.tif",
        "tiles_dir": BASE/"tiles"/"pabay_ukho",
        "cont_dir":  BASE/"tiles"/"pabay_ukho_c",
        "geojson":   BASE/"geojson"/"pabay_contours.geojson",
        "depth_key": "pabay_ukho",
        "cont_key":  "pabay_ukho_c",
    },
    {
        "name": "St Brides Bay (Block 4a)",
        "tif": BASE/"geotiffs"/"stbrides_ukho.tif",
        "tiles_dir": BASE/"tiles"/"stbrides_ukho",
        "cont_dir":  BASE/"tiles"/"stbrides_ukho_c",
        "geojson":   BASE/"geojson"/"stbrides_contours.geojson",
        "depth_key": "stbrides_ukho",
        "cont_key":  "stbrides_ukho_c",
    },
]
```

Then run:

```bash
python generate_z16.py
```

This generates z16 depth + contour tiles into the local `tiles/.../16/` subfolders
and uploads them. Handoff doc gotcha #5: z16 is ~4× the pixel work of z15 and
can take 5–20 min per project. **Watch for memory pressure** — these are bigger
tile counts than z15. If a project's z16 generation fails, set its
`maxNative: 15` in `LeafletMap.tsx` (step 4.3) instead of `16`.

**Expected z16 counts:** roughly 4× the z15 count per area (so Blakeney ~880, Pabay ~1970, St Brides ~424, totalling ~3300 new z16 tiles). These are estimates — record the actuals from the script output for the docstring.

### 4.3 — Add tile-lookup config to `LeafletMap.tsx`  *(~5 min)*

Location: `src/components/map/LeafletMap.tsx`. Pick a spot near the existing
`tileLayerRef` (around line 405) or in the imports area.

```typescript
const UKHO_DEPTH_TILES: Record<string, { folder: string; maxNative: number }> = {
  bidefordbay:  { folder: 'bidefordbay_ukho',  maxNative: 16 },
  ramseysound:  { folder: 'ramseysound_ukho',  maxNative: 16 },
  blakeney:     { folder: 'blakeney_ukho',     maxNative: 16 },
  pabay:        { folder: 'pabay_ukho',        maxNative: 16 },
  stbrides:     { folder: 'stbrides_ukho',     maxNative: 16 },
};
const UKHO_CONTOUR_TILES: Record<string, { folder: string; maxNative: number }> = {
  bidefordbay:  { folder: 'bidefordbay_ukho_c',  maxNative: 16 },
  ramseysound:  { folder: 'ramseysound_ukho_c',  maxNative: 16 },
  blakeney:     { folder: 'blakeney_ukho_c',     maxNative: 16 },
  pabay:        { folder: 'pabay_ukho_c',        maxNative: 16 },
  stbrides:     { folder: 'stbrides_ukho_c',     maxNative: 16 },
};
```

If z16 didn't finish for any project, drop its `maxNative` to `15`. Leaflet
will then upscale z15 tiles past zoom 15 instead of 404-ing (handoff doc gotcha #7).

### 4.4 — Render the tile overlays  *(~30–60 min)*

The map already has a basemap layer (`tileLayerRef` at LeafletMap.tsx:405–432
swapping between Esri satellite and Esri Ocean). Add **two new sibling layers
per project** on top: a depth layer and a contour layer.

Pattern:

```typescript
// Inside the map-init effect, after the basemap layer is added:
const ukhoLayersRef = useRef<L.TileLayer[]>([]);

useEffect(() => {
  if (!mapRef.current || mapStyle !== 'bathymetry') {
    // remove any existing overlay tiles
    ukhoLayersRef.current.forEach(l => l.remove());
    ukhoLayersRef.current = [];
    return;
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const layers: L.TileLayer[] = [];
  for (const key of Object.keys(UKHO_DEPTH_TILES)) {
    const d = UKHO_DEPTH_TILES[key];
    const c = UKHO_CONTOUR_TILES[key];
    const depthLayer = L.tileLayer(
      `${supabaseUrl}/storage/v1/object/public/bathymetry-tiles/${d.folder}/{z}/{x}/{y}.png`,
      { minNativeZoom: 10, maxNativeZoom: d.maxNative, minZoom: 8, maxZoom: 20,
        opacity: 0.85, pane: 'overlayPane' }
    ).addTo(mapRef.current);
    const contourLayer = L.tileLayer(
      `${supabaseUrl}/storage/v1/object/public/bathymetry-tiles/${c.folder}/{z}/{x}/{y}.png`,
      { minNativeZoom: 10, maxNativeZoom: c.maxNative, minZoom: 8, maxZoom: 20,
        opacity: 0.95, pane: 'overlayPane' }
    ).addTo(mapRef.current);
    layers.push(depthLayer, contourLayer);
  }
  ukhoLayersRef.current = layers;
  return () => layers.forEach(l => l.remove());
}, [mapStyle]);
```

Notes:
- All 5 project sets load simultaneously (handoff doc §7 gotcha #6) — Leaflet
  only requests tiles in the current viewport so this is cheap; tiles outside
  the survey extent just 404 silently (we could add `errorTileUrl` to suppress
  console noise if needed).
- `minNativeZoom: 10` matches the pipeline's lowest zoom. Leaflet will
  upscale below z10 rather than request non-existent z9 tiles.
- Z-ordering: depth pane below contour pane. Default `overlayPane` z-index is
  400; can split into custom panes if you want fine control.
- Opacity defaults are guesses — tune in-browser.

### 4.5 — Toggle behaviour  *(~5 min)*

Per decision #1, the existing toggle at `src/app/map-drawing/page.tsx:7865`
is reused: `mapStyle === 'bathymetry'` gates both the Ocean basemap AND the
new UKHO overlay. The §4.4 effect already does this — no extra UI work.

If later you want sat + bathymetry simultaneously, split into a separate
`showBathymetry` boolean and a second toggle button. Backwards-compatible
to do.

### 4.6 — Smoke-test in the browser  *(~15 min)*

```bash
# from repo root, in a separate terminal
cd DataApp && npm run dev   # OR just `npm run dev` if the root is the app
# then open http://localhost:9002/map-drawing
```

Hard-reload (Ctrl+Shift+R per handoff doc) → toggle to Bathymetry mode →
pan to Blakeney (52.97 N, 0.97 E), Pabay (57.27 N, −5.92 W), St Brides Bay
(51.78 N, −5.20 W) → confirm per handoff doc §4.6:

- Blue depth shading shows where data exists, transparent elsewhere
- Contour lines (cyan→purple gradient) overlay the shading
- Depth labels (`-5m`, `-10m`, …) appear along contours
- Zoom in past 15 → labels stay sharp (z16 working)
- Zoom out past 10 → tiles disappear cleanly, no 404 spam in console
- No new console errors compared to baseline

### 4.7 — Commit & PR

```bash
git add scripts/bathymetry/ src/components/map/LeafletMap.tsx
# plus src/app/map-drawing/page.tsx if Option B was chosen
git commit -m "Add UKHO bathymetry tile pipeline and overlay rendering"
git push -u origin bathymetry-tiles
gh pr create --base master --title "Bathymetry tile pipeline + map overlays"
```

---

## 5. Decisions (locked in 2026-05-12)

| # | Decision | Choice | Notes |
|---|---|---|---|
| 1 | Toggle style for the bathymetry overlay | **A — reuse the existing `mapStyle` toggle** | Overlay activates whenever `mapStyle === 'bathymetry'`. Splitting into a separate "show bathymetry" boolean is deferred — can be added later without breaking anything. |
| 2 | Layer opacity | **Depth 0.85, contour 0.95** | Starting values. Tune in DevTools, commit whatever settles. |
| 3 | Re-upload `ramseysound_ukho/` to Supabase | **Skip** | Existing Supabase folder is bit-equivalent (count match on all 6 zooms + z16 already present). Frontend config points at the existing folders. Means Ramsey is **NOT** added to `generate_z16.py`'s `PROJECTS` list either — z16 is already up there. |
| 4 | Delete local Bideford artifacts and the `pipeline_ramsey.py` template | **Keep both** | Bideford artifacts (gitignored) preserve the ability to re-validate the pipeline against the published reference counts. `pipeline_ramsey.py` stays as a clean copy-me template. |
| 5 | Cleddau + Milford Haven path | **Hold** | The provided zips contain XYZ CSV point clouds, not BAGs. Try to source BAGs (UKHO portal, or Christian) before building a CSV→raster gridding stage. |
| 6 | Per-area vs global UKHO layer rendering | **Global** | All 5 areas' tile layers attach simultaneously when in bathymetry mode. Leaflet's viewport-aware fetching makes this free; out-of-survey tiles 404 silently (suppress with `errorTileUrl` if console noise becomes an issue). |

---

## 6. Known issues already handled in the library

Patches baked into `bathymetry_lib.py` worth being aware of when reading/debugging:

1. **Malformed CRS metadata in old BAGs** (St Brides + Ramsey BAGs from the 2012 HI1365 survey). PROJ rejects the embedded WKT with a JSON parse error. **Fix:** `PipelineConfig.src_crs_override = "EPSG:32630"` triggers a code path that reads band 1 into a numpy array first so GDAL's warper can't re-read the bad CRS internally. Used by `pipeline_stbrides.py` and `pipeline_ramseysound.py`.

2. **Empty-shell `.tif` from a failed prior run** would silently feed zero data into stage 2 because of the "geotiff exists — skipping reprojection" guard. **Fix:** the guard now also checks `stat().st_size >= 1_000_000`; anything smaller is treated as a failed write and regenerated.

3. **Unusual nodata values** (e.g. `1000000.0` in the Bideford BAG) handled via `np.isclose(arr, nodata, atol=1.0)` throughout — not strict equality, so float drift can't bite.

4. **Upload idempotency** via POST → PUT-on-409 with `x-upsert: true` header. Re-running an upload is safe.

---

## 7. Source-data caveats (one-time gotchas, won't bite tomorrow but document for future)

| Source zip name | Actual contents | Project key |
|---|---|---|
| `Bideford Bay Bathym.zip` | 2007 Barnstaple Bay Part 1 (correct) | `bidefordbay` |
| `Pabay Bathym.zip` | 2019 Linne Crowlin & Loc Carron (correct; "Pabay" is shorthand for the area) | `pabay` |
| `Cleddau Bathym.zip` | River Cleddau — CSV point cloud only, **no BAG** | deferred |
| `Milford Haven Bathym.zip` | 2009 Milford Haven — CSV point cloud only, **no BAG** | deferred |
| `Ramsey Bathym.zip` | BAG internally named "St Brides Bay Blk 5" — but tile-count match against the existing Supabase `ramseysound_ukho/` proves the data is Ramsey Sound. UKHO survey naming is just confusing here. | `ramseysound` |
| `St Brides Bathym.zip` | 2012 St Brides Bay Block 4a (correct) | `stbrides` |
| `Blakeny Bathym.zip` (in part-2 of the Google Drive export) | 2014 Blakeney Overfalls (correct; "Blakeny" is a typo in the source name) | `blakeney` |

Locations:
- Main zip: `C:\Users\anjal\Downloads\11 - Bathymetry data-20260512T010944Z-3-001.zip`
- Part-2 zip (Blakeney): `C:\Users\anjal\Downloads\11 - Bathymetry data-20260512T010944Z-3-002.zip`

---

## 8. Frontend integration: reference URLs and paths

- Page: `src/app/map-drawing/page.tsx`
  - `mapStyle` state: line 974
  - Toggle button: line 7865
- Map component: `src/components/map/LeafletMap.tsx`
  - Existing basemap tile layer: lines 405–432
  - `mapStyle` prop: line 89
- Supabase tile URL pattern (public bucket):
  `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/bathymetry-tiles/<folder>/{z}/{x}/{y}.png`

There is **no** `DataApp/` source tree to edit — the `DataApp/` folder at the
repo root is an untracked copy. The git-tracked app lives directly under
`src/` at the repo root.

---

## 9. Useful snippets

### 9.1 — Upload the contour GeoJSONs

```bash
node -e "
require('dotenv').config({ path: 'C:/Users/anjal/Ocean Data Platform/.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  for (const key of ['blakeney','pabay','stbrides']) {
    const local = 'C:/Users/anjal/Ocean Data Platform/scripts/bathymetry/geojson/' + key + '_contours.geojson';
    const remote = 'geojson/' + key + '_contours.geojson';
    const data = fs.readFileSync(local);
    const r = await sb.storage.from('bathymetry-tiles').upload(remote, data, {
      contentType: 'application/json', upsert: true,
    });
    console.log(key, r.error ? r.error.message : 'OK');
  }
})();
"
```

### 9.2 — Verify what's on Supabase

```bash
node -e "
require('dotenv').config({ path: 'C:/Users/anjal/Ocean Data Platform/.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await sb.storage.from('bathymetry-tiles').list('', { limit: 100 });
  data.forEach(d => console.log(' -', d.name));
})();
"
```

### 9.3 — Per-zoom tile-count audit for any folder

```bash
node -e "
require('dotenv').config({ path: 'C:/Users/anjal/Ocean Data Platform/.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const folder = process.argv[1];   // e.g. 'blakeney_ukho'
(async () => {
  const out = {};
  for (const z of ['10','11','12','13','14','15','16']) {
    const { data: xs } = await sb.storage.from('bathymetry-tiles').list(folder + '/' + z, { limit: 1000 });
    if (!xs) { out[z] = '-'; continue; }
    let t = 0;
    for (const x of xs) {
      const { data: ys } = await sb.storage.from('bathymetry-tiles').list(folder + '/' + z + '/' + x.name, { limit: 1000 });
      if (ys) t += ys.filter(y => y.id).length;
    }
    out[z] = t;
  }
  console.log(folder, JSON.stringify(out));
})();
" blakeney_ukho
```

---

## 10. Quick resume checklist

If you've returned with no other context:

- [ ] `git checkout bathymetry-tiles && git status` — confirm branch, no uncommitted edits (everything pipeline-side is gitignored; the `*.py` and `*.md` files plus `.gitignore` should be present)
- [ ] Verify Python: `python -c "import rasterio, skimage, dotenv; print(rasterio.__version__)"` — should show 1.5.0+
- [ ] Verify BAGs in place: `ls scripts/bathymetry/raw/{blakeney,pabay,stbrides,ramseysound,bidefordbay}/*.bag` — five files expected
- [ ] Verify tiles in place: `ls scripts/bathymetry/tiles/` — ten folders expected (`<area>_ukho` and `<area>_ukho_c` × 5)
- [ ] Pick option A or B from §5 decision 1
- [ ] Execute §4.1 → §4.2 → §4.3 → §4.4 → §4.5 → §4.6 → §4.7

End-to-end fresh execution time estimate: **~2 hours**, of which ~1 hour is unattended z16 compute and ~1 hour is frontend work + testing.
