"""St Brides Bay Block 4a pipeline (HI1365, 2012, 2 m SB)."""
from pathlib import Path

from bathymetry_lib import (
    DEFAULT_CONTOUR_DEPTHS, DEFAULT_CONTOUR_STYLE, DEFAULT_DEPTH_RAMP,
    PipelineConfig, SupabaseConfig, run_pipeline,
)

BASE = Path(__file__).resolve().parent

PROJECT_KEY = "stbrides"
BAG_PATH    = BASE / "raw"      / PROJECT_KEY / "2012 HI1365 St Brides Bay Blk 4a 2m SB-936948fd-cd3b-4c7a-bd0e-35b913207ee2.bag"
TIF_OUT     = BASE / "geotiffs" / f"{PROJECT_KEY}_ukho.tif"
TILES_DIR   = BASE / "tiles"    / f"{PROJECT_KEY}_ukho"
CONT_DIR    = BASE / "tiles"    / f"{PROJECT_KEY}_ukho_c"
GEOJSON     = BASE / "geojson"  / f"{PROJECT_KEY}_contours.geojson"

UPLOAD = True


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
