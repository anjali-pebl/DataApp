"""Reference end-to-end pipeline for one project — copy this and edit the paths for each new area.

Validation target (from BATHYMETRY_PIPELINE_HANDOFF.md §9):
    Ramsey Sound depth tiles per zoom: z10=1, z11=1, z12=4, z13=12, z14=40, z15=130, z16=428
    (z16 is generated separately by generate_z16.py)
"""
from pathlib import Path

from bathymetry_lib import (
    DEFAULT_CONTOUR_DEPTHS,
    DEFAULT_CONTOUR_STYLE,
    DEFAULT_DEPTH_RAMP,
    PipelineConfig,
    SupabaseConfig,
    run_pipeline,
)

BASE = Path(__file__).resolve().parent

# ----- Project-specific paths (edit these per area) -----
PROJECT_KEY = "ramseysound"
BAG_PATH    = BASE / "raw"      / PROJECT_KEY / "ramsey.bag"   # set to actual .bag filename
TIF_OUT     = BASE / "geotiffs" / f"{PROJECT_KEY}_ukho.tif"
TILES_DIR   = BASE / "tiles"    / f"{PROJECT_KEY}_ukho"
CONT_DIR    = BASE / "tiles"    / f"{PROJECT_KEY}_ukho_c"
GEOJSON     = BASE / "geojson"  / f"{PROJECT_KEY}_contours.geojson"

# ----- Tunables -----
MIN_ZOOM = 10
MAX_ZOOM = 15
CONTOUR_DEPTHS     = DEFAULT_CONTOUR_DEPTHS         # [-5, -10, ... -40]
DEPTH_RAMP         = DEFAULT_DEPTH_RAMP
CONTOUR_TILE_STYLE = DEFAULT_CONTOUR_STYLE
CONTOUR_SCALE      = 4    # downsample factor for find_contours — bump to 6 or 8 for very large areas
CONTOUR_MIN_POINTS = 10
CONTOUR_THIN       = 3    # keep every Nth coord
LABEL_SPACING_PX   = 60
LABEL_FONT_SIZE    = 11

UPLOAD = True


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
        contour_depths=tuple(CONTOUR_DEPTHS),
        contour_scale=CONTOUR_SCALE,
        contour_min_points=CONTOUR_MIN_POINTS,
        contour_thin=CONTOUR_THIN,
        depth_ramp=tuple(DEPTH_RAMP),
        contour_style=dict(CONTOUR_TILE_STYLE),
        label_spacing_px=LABEL_SPACING_PX,
        label_font_size=LABEL_FONT_SIZE,
        upload=UPLOAD,
    )
    # The .env.local at the repo root holds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
    sb = SupabaseConfig.from_env(dotenv_path=BASE.parents[1] / ".env.local") if UPLOAD else None
    summary = run_pipeline(cfg, supabase_cfg=sb)
    print("\nSummary:", summary)


if __name__ == "__main__":
    main()
