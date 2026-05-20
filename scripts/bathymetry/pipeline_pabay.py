"""Pabay / Inner Sound pipeline (HI1567, 2019, Linne Crowlin and Loch Carron, 2 m SDTP)."""
from pathlib import Path

from bathymetry_lib import (
    BLUES_DEPTH_RAMP, DEFAULT_CONTOUR_DEPTHS,
    PipelineConfig, SupabaseConfig, build_contour_style_from_ramp, run_pipeline,
)

BASE = Path(__file__).resolve().parent

PROJECT_KEY = "pabay"
BAG_PATH    = BASE / "raw"      / PROJECT_KEY / "2019 HI1567 Linne Crowlin and Loc Carron 2m SDTP-4e780042-6ba3-458a-b49f-a10d325ba73c.bag"
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
        depth_ramp=tuple(BLUES_DEPTH_RAMP),
        contour_style=build_contour_style_from_ramp(BLUES_DEPTH_RAMP),
        label_spacing_px=90,
        label_font_size=10,
        label_zoom_floor=13,
        label_min_distance_px=0,
        upload=UPLOAD,
    )
    sb = SupabaseConfig.from_env(dotenv_path=BASE.parents[1] / ".env.local") if UPLOAD else None
    print(run_pipeline(cfg, supabase_cfg=sb))


if __name__ == "__main__":
    main()
