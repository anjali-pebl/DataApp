"""Generate and upload z16 (high-zoom) depth + contour tiles for each project in PROJECTS.

z16 is split out from the main pipeline because it 4×'s the pixel work of z15 and
re-runs contour baking at higher resolution — typically the slowest stage (5–20 min
per project, per the handoff doc).

Idempotent: re-running just overwrites the same files.

Validation targets (from BATHYMETRY_PIPELINE_HANDOFF.md §9):
    bidefordbay_ukho   z16 = 2362 tiles
    ramseysound_ukho   z16 =  428 tiles
"""
from pathlib import Path

from bathymetry_lib import (
    DEFAULT_CONTOUR_STYLE,
    DEFAULT_DEPTH_RAMP,
    SupabaseConfig,
    bake_contour_tiles,
    generate_depth_tiles,
    upload_tiles,
)

BASE = Path(__file__).resolve().parent

# ----- Projects -----
# Add an entry per project after its z10-z15 pipeline has run successfully.
PROJECTS: list[dict] = [
    # bidefordbay and ramseysound are deliberately excluded — their z16 tiles
    # are already on Supabase (3453 and 616 total per layer respectively) from
    # the original pipeline run. See IMPLEMENTATION_PLAN.md §5 decision #3.
    {
        "name":      "Blakeney Overfalls",
        "tif":       BASE / "geotiffs" / "blakeney_ukho.tif",
        "tiles_dir": BASE / "tiles"    / "blakeney_ukho",
        "cont_dir":  BASE / "tiles"    / "blakeney_ukho_c",
        "geojson":   BASE / "geojson"  / "blakeney_contours.geojson",
        "depth_key": "blakeney_ukho",
        "cont_key":  "blakeney_ukho_c",
    },
    {
        "name":      "Pabay / Inner Sound",
        "tif":       BASE / "geotiffs" / "pabay_ukho.tif",
        "tiles_dir": BASE / "tiles"    / "pabay_ukho",
        "cont_dir":  BASE / "tiles"    / "pabay_ukho_c",
        "geojson":   BASE / "geojson"  / "pabay_contours.geojson",
        "depth_key": "pabay_ukho",
        "cont_key":  "pabay_ukho_c",
    },
    {
        "name":      "St Brides Bay (Block 4a)",
        "tif":       BASE / "geotiffs" / "stbrides_ukho.tif",
        "tiles_dir": BASE / "tiles"    / "stbrides_ukho",
        "cont_dir":  BASE / "tiles"    / "stbrides_ukho_c",
        "geojson":   BASE / "geojson"  / "stbrides_contours.geojson",
        "depth_key": "stbrides_ukho",
        "cont_key":  "stbrides_ukho_c",
    },
]

# ----- z16 settings -----
Z16 = 16
LABEL_SPACING_PX_Z16 = 80   # slightly looser than z10-z15 (60) because labels are bigger at this scale
LABEL_FONT_SIZE_Z16  = 12
UPLOAD = True


def run_one(project: dict, sb: SupabaseConfig | None) -> None:
    print(f"\n=== {project['name']} — z16 ===")

    print(f"[1/3] Depth tiles z{Z16}")
    depth_counts = generate_depth_tiles(
        project["tif"], project["tiles_dir"],
        min_zoom=Z16, max_zoom=Z16,
        depth_ramp=DEFAULT_DEPTH_RAMP,
        label="depth-z16",
    )
    print(f"  z16 depth tiles: {depth_counts.get(Z16, 0)}")

    print(f"[2/3] Bake contours + labels at z{Z16}")
    contour_counts = bake_contour_tiles(
        project["tiles_dir"], project["cont_dir"], project["geojson"],
        zooms=[Z16],
        contour_style=DEFAULT_CONTOUR_STYLE,
        label_spacing_px=LABEL_SPACING_PX_Z16,
        label_font_size=LABEL_FONT_SIZE_Z16,
    )
    print(f"  z16 contour tiles: {contour_counts.get(Z16, 0)}")

    if UPLOAD and sb is not None:
        print(f"[3/3] Upload z16 -> bucket={sb.bucket}")
        # Only upload z16 subfolders to avoid re-pushing z10-z15 every run.
        depth_z16 = project["tiles_dir"] / str(Z16)
        cont_z16  = project["cont_dir"]  / str(Z16)
        if depth_z16.is_dir():
            ok, fail = upload_tiles(depth_z16, f"{project['depth_key']}/{Z16}", sb)
            print(f"  depth z16: ok={ok} fail={fail}")
        if cont_z16.is_dir():
            ok, fail = upload_tiles(cont_z16, f"{project['cont_key']}/{Z16}", sb)
            print(f"  contour z16: ok={ok} fail={fail}")
    else:
        print("[3/3] upload disabled — skipping")


def main() -> None:
    if not PROJECTS:
        print("No projects configured. Add entries to the PROJECTS list and re-run.")
        return
    sb = SupabaseConfig.from_env(dotenv_path=BASE.parents[1] / ".env.local") if UPLOAD else None
    for project in PROJECTS:
        run_one(project, sb)


if __name__ == "__main__":
    main()
