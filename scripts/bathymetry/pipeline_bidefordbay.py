"""Bideford Bay pipeline — used here for validation against the reference Supabase tile counts.

Validation target (from BATHYMETRY_PIPELINE_HANDOFF.md §9):
    z10=4, z11=10, z12=29, z13=80, z14=227, z15=741   (z16=2362 generated separately)
"""
from pathlib import Path

from bathymetry_lib import (
    BLUES_DEPTH_RAMP,
    DEFAULT_CONTOUR_DEPTHS,
    PipelineConfig,
    SupabaseConfig,
    build_contour_style_from_ramp,
    run_pipeline,
)

BASE = Path(__file__).resolve().parent

PROJECT_KEY = "bidefordbay"
BAG_PATH    = BASE / "raw"      / PROJECT_KEY / "2007 HI1158 Barnstaple Bay Part 1 2m SB-6ff5f813-1e1c-4444-b4c9-3cc647b1da5e.bag"
TIF_OUT     = BASE / "geotiffs" / f"{PROJECT_KEY}_ukho.tif"
TILES_DIR   = BASE / "tiles"    / f"{PROJECT_KEY}_ukho"
CONT_DIR    = BASE / "tiles"    / f"{PROJECT_KEY}_ukho_c"
GEOJSON     = BASE / "geojson"  / f"{PROJECT_KEY}_contours.geojson"

MIN_ZOOM = 10
MAX_ZOOM = 15
UPLOAD = True   # regenerating with fixed label code (2026-05-12)


def main() -> None:
    cfg = PipelineConfig(
        bag_path=BAG_PATH,
        tif_out=TIF_OUT,
        tiles_dir=TILES_DIR,
        contour_dir=CONT_DIR,
        geojson_path=GEOJSON,
        project_key=PROJECT_KEY,
        min_zoom=MIN_ZOOM,
        max_zoom=MAX_ZOOM,
        contour_depths=tuple(DEFAULT_CONTOUR_DEPTHS),
        depth_ramp=tuple(BLUES_DEPTH_RAMP),
        contour_style=build_contour_style_from_ramp(BLUES_DEPTH_RAMP),
        label_spacing_px=90,
        label_font_size=10,
        label_zoom_floor=13,
        label_min_distance_px=0,
        upload=UPLOAD,
    )
    sb = SupabaseConfig.from_env(dotenv_path=BASE.parents[1] / ".env.local") if UPLOAD else None
    summary = run_pipeline(cfg, supabase_cfg=sb)
    print("\nSummary:", summary)

    expected = {10: 4, 11: 10, 12: 29, 13: 80, 14: 227, 15: 741}
    actual = summary.get("depth_tile_counts", {})
    print("\nValidation vs handoff doc reference (z10-z15):")
    print(f"  {'zoom':>5}  {'expected':>9}  {'actual':>7}  match")
    all_match = True
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        e = expected[z]
        a = actual.get(z, 0)
        ok = (a == e)
        all_match = all_match and ok
        print(f"  {z:>5}  {e:>9}  {a:>7}  {'OK' if ok else 'MISMATCH'}")
    print("\nALL MATCH" if all_match else "\nSOME MISMATCH — pipeline is not bit-equivalent to the original")


if __name__ == "__main__":
    main()
