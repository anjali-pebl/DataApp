"""Re-bake contour+label tiles for all 5 areas, then upload _ukho_c/.

Skips: BAG -> WGS84 reproject, depth tile generation, contour GeoJSON gen,
       _ukho/ upload — all unchanged from prior runs.
Only does: bake_contour_tiles (cheap) + upload _ukho_c (idempotent).

Use this when only the label/contour-rendering code in bathymetry_lib.py
has changed and the depth pipeline is still up-to-date.
"""
from pathlib import Path

from bathymetry_lib import (
    DEFAULT_CONTOUR_STYLE,
    SupabaseConfig,
    bake_contour_tiles,
    upload_tiles,
)

BASE = Path(__file__).resolve().parent

PROJECTS = ["bidefordbay", "ramseysound", "blakeney", "pabay", "stbrides"]

# z10-z15 use 60px spacing; z16 uses 80px (labels are bigger relative to feature scale at full zoom)
LABEL_SPACING_LO = 60
LABEL_FONT_LO = 11
LABEL_SPACING_HI = 80
LABEL_FONT_HI = 12

UPLOAD = True


def main() -> None:
    sb = SupabaseConfig.from_env(dotenv_path=BASE.parents[1] / ".env.local") if UPLOAD else None

    for key in PROJECTS:
        print(f"\n=== {key} ===")
        src = BASE / "tiles" / f"{key}_ukho"
        dst = BASE / "tiles" / f"{key}_ukho_c"
        gj = BASE / "geojson" / f"{key}_contours.geojson"

        if not src.exists():
            print(f"  SKIP: local depth tiles missing at {src}")
            continue
        if not gj.exists():
            print(f"  SKIP: contour geojson missing at {gj}")
            continue

        # z10-z15
        bake_contour_tiles(
            src_tiles_dir=src,
            dst_tiles_dir=dst,
            geojson_path=gj,
            zooms=range(10, 16),
            contour_style=DEFAULT_CONTOUR_STYLE,
            label_spacing_px=LABEL_SPACING_LO,
            label_font_size=LABEL_FONT_LO,
        )
        # z16
        if (src / "16").is_dir():
            bake_contour_tiles(
                src_tiles_dir=src,
                dst_tiles_dir=dst,
                geojson_path=gj,
                zooms=[16],
                contour_style=DEFAULT_CONTOUR_STYLE,
                label_spacing_px=LABEL_SPACING_HI,
                label_font_size=LABEL_FONT_HI,
            )
        else:
            print(f"  note: no z16 local tiles for {key}; skipping z16 bake")

        if UPLOAD and sb is not None:
            ok, fail = upload_tiles(dst, f"{key}_ukho_c", sb)
            print(f"  uploaded {key}_ukho_c/: ok={ok} fail={fail}")


if __name__ == "__main__":
    main()
