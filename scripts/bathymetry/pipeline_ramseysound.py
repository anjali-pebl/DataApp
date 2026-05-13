"""Ramsey Sound pipeline (HI1365, 2012, 2 m SB).

The BAG inside the "Ramsey Bathym.zip" source archive is internally named
"St Brides Bay Blk 5" by UKHO, but the data is in fact the Ramsey Sound
survey — confirmed by bit-for-bit match against the existing Supabase
ramseysound_ukho/ tile counts (1, 1, 4, 12, 40, 130 at z10..z15).
"""
from pathlib import Path

from bathymetry_lib import (
    DEFAULT_CONTOUR_DEPTHS, DEFAULT_CONTOUR_STYLE, DEFAULT_DEPTH_RAMP,
    PipelineConfig, SupabaseConfig, run_pipeline,
)

BASE = Path(__file__).resolve().parent

PROJECT_KEY = "ramseysound"
BAG_PATH    = BASE / "raw"      / PROJECT_KEY / "2012 HI1365 St Brides Bay Blk 5 2m SB-b86811a0-4ed2-40e0-b0e6-651c8f1533aa.bag"
TIF_OUT     = BASE / "geotiffs" / f"{PROJECT_KEY}_ukho.tif"
TILES_DIR   = BASE / "tiles"    / f"{PROJECT_KEY}_ukho"
CONT_DIR    = BASE / "tiles"    / f"{PROJECT_KEY}_ukho_c"
GEOJSON     = BASE / "geojson"  / f"{PROJECT_KEY}_contours.geojson"

UPLOAD = True   # regenerating with fixed label code (2026-05-12)


def main() -> None:
    cfg = PipelineConfig(
        bag_path=BAG_PATH, tif_out=TIF_OUT, tiles_dir=TILES_DIR,
        contour_dir=CONT_DIR, geojson_path=GEOJSON, project_key=PROJECT_KEY,
        min_zoom=10, max_zoom=15,
        contour_depths=tuple(DEFAULT_CONTOUR_DEPTHS),
        depth_ramp=tuple(DEFAULT_DEPTH_RAMP),
        contour_style=dict(DEFAULT_CONTOUR_STYLE),
        upload=UPLOAD,
        src_crs_override="EPSG:32630",   # BAG ships malformed CRS WKT; data is UTM 30N
    )
    sb = SupabaseConfig.from_env(dotenv_path=BASE.parents[1] / ".env.local") if UPLOAD else None
    print(run_pipeline(cfg, supabase_cfg=sb))


if __name__ == "__main__":
    main()
