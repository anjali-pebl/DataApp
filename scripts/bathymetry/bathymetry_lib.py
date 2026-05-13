"""
Bathymetry tile pipeline — shared library.

Spec: BATHYMETRY_PIPELINE_HANDOFF.md (in the source zip of bathymetry data).

Stages:
  1. bag_to_wgs84_geotiff()     — BAG (UTM) -> WGS84 GeoTIFF (single-band depth)
  2. generate_depth_tiles()     — WGS84 GeoTIFF -> 256x256 depth-shaded PNG tiles in Web Mercator
  3. generate_contour_geojson() — WGS84 GeoTIFF -> isobath contour LineString GeoJSON
  4. bake_contour_tiles()       — depth tiles + contour GeoJSON -> tiles with contours+labels baked in
  5. upload_tiles()             — upload a tiles dir to a Supabase Storage bucket folder
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
import rasterio
import requests
from PIL import Image, ImageDraw, ImageFont
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, calculate_default_transform, reproject
from skimage import measure


# ---------------------------------------------------------------------------
# Web Mercator + tile math
# ---------------------------------------------------------------------------

MERCATOR_HALF = 20037508.342789244  # half-circumference in EPSG:3857 metres


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def tile_bounds_mercator(x: int, y: int, z: int) -> tuple[float, float, float, float]:
    """Return (xmin, ymin, xmax, ymax) in EPSG:3857 metres."""
    n = 2 ** z
    size = 2.0 * MERCATOR_HALF / n
    xmin = -MERCATOR_HALF + x * size
    xmax = xmin + size
    ymax = MERCATOR_HALF - y * size
    ymin = ymax - size
    return xmin, ymin, xmax, ymax


def mercator_to_pixel(mx: float, my: float, tile_x: int, tile_y: int, z: int, tile_px: int = 256) -> tuple[float, float]:
    xmin, ymin, xmax, ymax = tile_bounds_mercator(tile_x, tile_y, z)
    px = (mx - xmin) / (xmax - xmin) * tile_px
    # mercator y grows upward; image y grows downward
    py = (ymax - my) / (ymax - ymin) * tile_px
    return px, py


def lonlat_to_mercator(lon: float, lat: float) -> tuple[float, float]:
    mx = lon * MERCATOR_HALF / 180.0
    lat_clamped = max(min(lat, 85.05112878), -85.05112878)
    my = math.log(math.tan(math.radians(90.0 + lat_clamped) / 2.0)) * MERCATOR_HALF / math.pi
    return mx, my


# ---------------------------------------------------------------------------
# Step 1: BAG -> WGS84 GeoTIFF
# ---------------------------------------------------------------------------

def bag_to_wgs84_geotiff(
    bag_path: Path,
    out_tif: Path,
    resampling: Resampling = Resampling.bilinear,
    src_crs_override: str | None = None,
) -> None:
    """Reproject the elevation band of a BAG file to a single-band WGS84 GeoTIFF.

    BAG files typically store depth in band 1 in metres (negative = below sea level)
    in a UTM projection. We bring that into EPSG:4326 (WGS84) for downstream tile work.

    Some older BAGs ship malformed CRS metadata (informal name strings, no EPSG codes,
    spheroid spelled "WG84" etc.) that PROJ refuses to parse. Pass src_crs_override
    (e.g. "EPSG:32630") to bypass the embedded CRS in that case.
    """
    bag_path = Path(bag_path)
    out_tif = Path(out_tif)
    out_tif.parent.mkdir(parents=True, exist_ok=True)

    with rasterio.open(bag_path) as src:
        src_nodata = src.nodata if src.nodata is not None else -9999.0
        src_crs = src_crs_override if src_crs_override else src.crs
        src_transform = src.transform
        src_width = src.width
        src_height = src.height
        src_bounds = src.bounds
        # When a CRS override is in force we must hand the warper a numpy array
        # rather than a rasterio.band — GDAL's warper otherwise re-reads the
        # dataset's malformed CRS metadata internally and the override is ignored.
        source_arr = src.read(1) if src_crs_override else None

    transform, width, height = calculate_default_transform(
        src_crs, "EPSG:4326", src_width, src_height, *src_bounds
    )
    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": 1,
        "dtype": "float32",
        "crs": "EPSG:4326",
        "transform": transform,
        "nodata": src_nodata,
        "compress": "deflate",
        "tiled": True,
    }
    with rasterio.open(out_tif, "w", **profile) as dst:
        if source_arr is not None:
            dst_arr = np.full((height, width), src_nodata, dtype="float32")
            reproject(
                source=source_arr,
                destination=dst_arr,
                src_transform=src_transform,
                src_crs=src_crs,
                src_nodata=src_nodata,
                dst_transform=transform,
                dst_crs="EPSG:4326",
                dst_nodata=src_nodata,
                resampling=resampling,
            )
            dst.write(dst_arr, 1)
        else:
            with rasterio.open(bag_path) as src:
                reproject(
                    source=rasterio.band(src, 1),
                    destination=rasterio.band(dst, 1),
                    src_transform=src_transform,
                    src_crs=src_crs,
                    src_nodata=src_nodata,
                    dst_transform=transform,
                    dst_crs="EPSG:4326",
                    dst_nodata=src_nodata,
                    resampling=resampling,
                )


# ---------------------------------------------------------------------------
# Step 2: WGS84 GeoTIFF -> depth-shaded PNG tiles (Web Mercator)
# ---------------------------------------------------------------------------

# Default depth ramp — light cyan-blue at shallow, dark navy at deep.
# Stops: (depth_in_metres_negative, (R, G, B))
DEFAULT_DEPTH_RAMP: list[tuple[float, tuple[int, int, int]]] = [
    (0.0,   (110, 180, 235)),  # shallowest — light cyan-blue
    (-5.0,  (60,  130, 210)),
    (-15.0, (35,   85, 175)),
    (-30.0, (20,   45, 130)),
    (-50.0, (8,    20,  75)),  # deepest — dark navy
]


def _interp_ramp(value: float, ramp: Sequence[tuple[float, tuple[int, int, int]]]) -> tuple[int, int, int]:
    """Interpolate an RGB colour from a depth value (negative metres) against a ramp.

    Ramp stops are expected sorted shallow (highest, i.e. closest to 0) to deep (lowest).
    """
    if value >= ramp[0][0]:
        return ramp[0][1]
    if value <= ramp[-1][0]:
        return ramp[-1][1]
    for i in range(len(ramp) - 1):
        d0, c0 = ramp[i]
        d1, c1 = ramp[i + 1]
        if d1 <= value <= d0:
            t = (value - d0) / (d1 - d0) if d1 != d0 else 0.0
            return (
                int(c0[0] + (c1[0] - c0[0]) * t),
                int(c0[1] + (c1[1] - c0[1]) * t),
                int(c0[2] + (c1[2] - c0[2]) * t),
            )
    return ramp[-1][1]


def _depth_array_to_rgba(arr: np.ndarray, nodata: float, ramp: Sequence[tuple[float, tuple[int, int, int]]]) -> np.ndarray:
    """Vectorised application of the depth ramp. Returns HxWx4 uint8 array."""
    h, w = arr.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    valid = ~(np.isclose(arr, nodata, atol=1.0) | np.isnan(arr))

    # Build a sorted-by-depth-ascending list (deep -> shallow) for np.interp
    sorted_ramp = sorted(ramp, key=lambda s: s[0])
    xs = np.array([s[0] for s in sorted_ramp], dtype=np.float64)
    rs = np.array([s[1][0] for s in sorted_ramp], dtype=np.float64)
    gs = np.array([s[1][1] for s in sorted_ramp], dtype=np.float64)
    bs = np.array([s[1][2] for s in sorted_ramp], dtype=np.float64)

    v = arr[valid].astype(np.float64)
    rgba[valid, 0] = np.clip(np.interp(v, xs, rs), 0, 255).astype(np.uint8)
    rgba[valid, 1] = np.clip(np.interp(v, xs, gs), 0, 255).astype(np.uint8)
    rgba[valid, 2] = np.clip(np.interp(v, xs, bs), 0, 255).astype(np.uint8)
    rgba[valid, 3] = 255
    return rgba


def _reproject_tile(src, tile_x: int, tile_y: int, z: int, tile_px: int = 256, resampling: Resampling = Resampling.bilinear) -> np.ndarray | None:
    """Reproject a single tile-sized window from an open WGS84 source into Web Mercator at 256x256.

    Returns None if the tile lies wholly outside the source bounds.
    """
    mxmin, mymin, mxmax, mymax = tile_bounds_mercator(tile_x, tile_y, z)
    dst_transform = from_bounds(mxmin, mymin, mxmax, mymax, tile_px, tile_px)
    src_nodata = src.nodata if src.nodata is not None else -9999.0
    dst = np.full((tile_px, tile_px), src_nodata, dtype="float32")
    reproject(
        source=rasterio.band(src, 1),
        destination=dst,
        src_transform=src.transform,
        src_crs=src.crs,
        src_nodata=src_nodata,
        dst_transform=dst_transform,
        dst_crs="EPSG:3857",
        dst_nodata=src_nodata,
        resampling=resampling,
    )
    return dst


def _data_tile_range(src, z: int) -> tuple[int, int, int, int]:
    """Tile-coord bounding box (xmin, ymin, xmax, ymax) covering the source extent at zoom z."""
    b = src.bounds  # in WGS84
    x_lo, y_hi = lonlat_to_tile(b.left,  b.bottom, z)
    x_hi, y_lo = lonlat_to_tile(b.right, b.top,    z)
    return x_lo, y_lo, x_hi, y_hi


def generate_depth_tiles(
    tif_path: Path,
    out_dir: Path,
    min_zoom: int,
    max_zoom: int,
    depth_ramp: Sequence[tuple[float, tuple[int, int, int]]] = DEFAULT_DEPTH_RAMP,
    label: str = "depth",
) -> dict[int, int]:
    """Slice a WGS84 GeoTIFF into 256x256 PNG tiles at each zoom level.

    Empty tiles (entirely nodata after reprojection) are skipped, matching how
    the reference Supabase folder is sparse. Returns a {zoom: count} dict.
    """
    tif_path = Path(tif_path)
    out_dir = Path(out_dir)
    counts: dict[int, int] = {}

    with rasterio.open(tif_path) as src:
        nodata = src.nodata if src.nodata is not None else -9999.0
        for z in range(min_zoom, max_zoom + 1):
            x_lo, y_lo, x_hi, y_hi = _data_tile_range(src, z)
            kept = 0
            for tx in range(x_lo, x_hi + 1):
                for ty in range(y_lo, y_hi + 1):
                    arr = _reproject_tile(src, tx, ty, z)
                    if arr is None:
                        continue
                    valid = ~(np.isclose(arr, nodata, atol=1.0) | np.isnan(arr))
                    if not valid.any():
                        continue
                    rgba = _depth_array_to_rgba(arr, nodata, depth_ramp)
                    p = out_dir / str(z) / str(tx) / f"{ty}.png"
                    p.parent.mkdir(parents=True, exist_ok=True)
                    Image.fromarray(rgba, "RGBA").save(p, optimize=True)
                    kept += 1
            counts[z] = kept
            print(f"  [{label}] z{z}: {kept} tiles")
    return counts


# ---------------------------------------------------------------------------
# Step 3: contour GeoJSON
# ---------------------------------------------------------------------------

DEFAULT_CONTOUR_DEPTHS = [-5, -10, -15, -20, -25, -30, -35, -40]


def generate_contour_geojson(
    tif_path: Path,
    out_geojson: Path,
    depths: Iterable[float] = DEFAULT_CONTOUR_DEPTHS,
    scale: int = 4,
    min_points: int = 10,
    thin: int = 3,
    name: str = "bathymetry_contours",
) -> int:
    """Trace isobath contours with skimage.find_contours and save as a GeoJSON FeatureCollection.

    scale       — downsample factor before contour tracing (faster, less jagged)
    min_points  — drop contour fragments shorter than this (after downsample)
    thin        — keep every Nth coordinate after tracing
    """
    tif_path = Path(tif_path)
    out_geojson = Path(out_geojson)
    out_geojson.parent.mkdir(parents=True, exist_ok=True)

    with rasterio.open(tif_path) as src:
        arr = src.read(1).astype("float32")
        nodata = src.nodata if src.nodata is not None else -9999.0
        transform = src.transform

    arr_small = arr[::scale, ::scale]
    # find_contours doesn't handle NaN cleanly — replace nodata with NaN so contours don't cross land
    arr_small = np.where(np.isclose(arr_small, nodata, atol=1.0), np.nan, arr_small)

    features: list[dict] = []
    for depth in depths:
        contours = measure.find_contours(arr_small, level=float(depth))
        for c in contours:
            if len(c) < min_points:
                continue
            thinned = c[::thin]
            coords: list[list[float]] = []
            for row, col in thinned:
                px = col * scale
                py = row * scale
                lon, lat = transform * (px, py)
                coords.append([float(lon), float(lat)])
            if len(coords) >= 2:
                features.append({
                    "type": "Feature",
                    "properties": {"depth": float(depth)},
                    "geometry": {"type": "LineString", "coordinates": coords},
                })

    fc = {"type": "FeatureCollection", "name": name, "features": features}
    with open(out_geojson, "w", encoding="utf-8") as fp:
        json.dump(fc, fp)
    print(f"  contours: {len(features)} line features across {len(list(depths))} depths -> {out_geojson.name}")
    return len(features)


# ---------------------------------------------------------------------------
# Step 4: bake contours + labels into tiles
# ---------------------------------------------------------------------------

# Default contour style: cyan -> blue -> purple gradient by depth. Width grows with depth.
DEFAULT_CONTOUR_STYLE: dict[float, tuple[tuple[int, int, int, int], int]] = {
    -5.0:  ((110, 220, 255, 230), 1),
    -10.0: ((90,  180, 255, 230), 1),
    -15.0: ((90,  140, 240, 230), 1),
    -20.0: ((110, 110, 230, 240), 1),
    -25.0: ((140,  90, 220, 240), 2),
    -30.0: ((175,  75, 210, 240), 2),
    -35.0: ((180,  60, 170, 240), 2),
    -40.0: ((150,  40, 120, 240), 2),
}


def _load_label_font(size: int = 11) -> ImageFont.ImageFont:
    for path in (
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ):
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def _intersect_tile(coords_merc: list[tuple[float, float]], tx: int, ty: int, z: int) -> bool:
    """Quick bbox overlap test between a polyline (in mercator metres) and a tile."""
    xmin, ymin, xmax, ymax = tile_bounds_mercator(tx, ty, z)
    xs = [c[0] for c in coords_merc]
    ys = [c[1] for c in coords_merc]
    return not (max(xs) < xmin or min(xs) > xmax or max(ys) < ymin or min(ys) > ymax)


def _mercator_to_global_pixel(mx: float, my: float, z: int, tile_px: int = 256) -> tuple[float, float]:
    """Convert Web Mercator metres to global slippy-tile pixel coordinates at zoom z.

    Global pixel space has (0,0) at the top-left corner of tile (0,0) and grows
    right/down. A point at global pixel (gpx, gpy) lies in tile (floor(gpx/256), floor(gpy/256)).
    """
    world_px = tile_px * (1 << z)
    gpx = (mx + MERCATOR_HALF) / (2.0 * MERCATOR_HALF) * world_px
    gpy = (MERCATOR_HALF - my) / (2.0 * MERCATOR_HALF) * world_px
    return gpx, gpy


def _compute_global_labels(
    features_merc: Sequence[tuple[float, list[tuple[float, float]]]],
    zoom: int,
    label_spacing_px: float,
    font: ImageFont.ImageFont,
    metric_draw: ImageDraw.ImageDraw,
) -> list[tuple[float, float, str, int, int]]:
    """Compute global label positions for every contour feature at this zoom.

    Returns (gpx, gpy, text, text_width, text_height) per label.

    Spacing rule: PER-POLYLINE. Each contour fragment independently gets labels
    every `label_spacing_px` (global pixels) along its length. The first point
    of every polyline always gets a label, so short fragments still get one.

    No coordination across polylines or depths — adjacent contour fragments of
    the same depth produce parallel labels (visually they say the same thing
    but at slightly offset positions, which is informative not cluttered).
    Different depths can occupy the same pixel area; their labels say
    different things so the user can still read them.

    History: an earlier per-depth-global version coordinated label x-positions
    across all polylines of the same depth. For surveys with many short
    fragments (Pabay: 1461 features at z15), this starved most polylines down
    to a single label, and many tiles ended up showing unlabelled contours.
    Per-polyline matches the visual density users expect.

    Cross-tile rendering: handled at draw time. Each tile draws every label
    whose bbox intersects it, so labels at tile boundaries appear fully in
    both neighbouring tiles.
    """
    text_dims: dict[float, tuple[str, int, int]] = {}  # depth -> (text, tw, th) cached
    labels: list[tuple[float, float, str, int, int]] = []

    for depth, coords_m in features_merc:
        if depth not in text_dims:
            t = f"{int(round(depth))}m"
            bbox = metric_draw.textbbox((0, 0), t, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            text_dims[depth] = (t, tw, th)
        text, tw, th = text_dims[depth]

        last_gpx = None
        for mx, my in coords_m:
            gpx, gpy = _mercator_to_global_pixel(mx, my, zoom)
            if last_gpx is not None and abs(gpx - last_gpx) < label_spacing_px:
                continue
            labels.append((gpx, gpy, text, tw, th))
            last_gpx = gpx
    return labels


def bake_contour_tiles(
    src_tiles_dir: Path,
    dst_tiles_dir: Path,
    geojson_path: Path,
    zooms: Iterable[int],
    contour_style: dict[float, tuple[tuple[int, int, int, int], int]] = DEFAULT_CONTOUR_STYLE,
    label_spacing_px: int = 60,
    label_font_size: int = 11,
) -> dict[int, int]:
    """For every existing depth tile, draw contour lines + depth labels on top and save to dst_tiles_dir.

    label_spacing_px: minimum x-pixel distance, in GLOBAL slippy-tile pixel space,
    between consecutive labels of the same depth. Each tile renders every label whose
    bounding box intersects it — labels at tile boundaries appear fully across both
    neighbouring tiles instead of being clipped to one side.
    """
    src_tiles_dir = Path(src_tiles_dir)
    dst_tiles_dir = Path(dst_tiles_dir)

    with open(geojson_path, "r", encoding="utf-8") as fp:
        fc = json.load(fp)

    features_merc: list[tuple[float, list[tuple[float, float]]]] = []
    for feat in fc["features"]:
        depth = float(feat["properties"]["depth"])
        coords_ll = feat["geometry"]["coordinates"]
        coords_m = [lonlat_to_mercator(lon, lat) for lon, lat in coords_ll]
        if len(coords_m) >= 2:
            features_merc.append((depth, coords_m))

    font = _load_label_font(label_font_size)
    # Tiny throwaway canvas for text metrics; ImageDraw needs a target image to measure on
    _metric_img = Image.new("RGBA", (1, 1))
    metric_draw = ImageDraw.Draw(_metric_img)

    counts: dict[int, int] = {}
    TILE_PX = 256
    OUTLINE_PAD = 1  # the 8-direction outline expands the visible bbox by 1px on each side

    for z in zooms:
        z_dir = src_tiles_dir / str(z)
        if not z_dir.is_dir():
            counts[z] = 0
            continue

        # Phase 1: compute label positions globally for this zoom
        global_labels = _compute_global_labels(features_merc, z, label_spacing_px, font, metric_draw)
        # Phase 2: iterate tiles. For each tile, draw all polylines that bbox-overlap it
        # and all labels whose bbox intersects it.
        kept = 0
        for x_dir in z_dir.iterdir():
            if not x_dir.is_dir():
                continue
            tx = int(x_dir.name)
            tile_gpx_lo = tx * TILE_PX
            tile_gpx_hi = tile_gpx_lo + TILE_PX
            for tile_png in x_dir.glob("*.png"):
                ty = int(tile_png.stem)
                tile_gpy_lo = ty * TILE_PX
                tile_gpy_hi = tile_gpy_lo + TILE_PX

                im = Image.open(tile_png).convert("RGBA")
                draw = ImageDraw.Draw(im, "RGBA")

                xmin, ymin, xmax, ymax = tile_bounds_mercator(tx, ty, z)
                pad_m = (xmax - xmin) * 0.02

                # Draw contour polylines (same as before — per-tile clipped naturally by the canvas)
                for depth, coords_m in features_merc:
                    cx = [c[0] for c in coords_m]
                    cy = [c[1] for c in coords_m]
                    if max(cx) < xmin - pad_m or min(cx) > xmax + pad_m:
                        continue
                    if max(cy) < ymin - pad_m or min(cy) > ymax + pad_m:
                        continue
                    style = contour_style.get(depth)
                    if style is None:
                        style = min(contour_style.items(), key=lambda kv: abs(kv[0] - depth))[1]
                    color, width = style
                    pix = [mercator_to_pixel(mx, my, tx, ty, z) for mx, my in coords_m]
                    draw.line(pix, fill=color, width=width)

                # Draw every label whose bbox overlaps this tile
                for gpx, gpy, text, tw, th in global_labels:
                    lbx_lo = gpx - tw / 2 - OUTLINE_PAD
                    lbx_hi = gpx + tw / 2 + OUTLINE_PAD
                    lby_lo = gpy - th / 2 - OUTLINE_PAD
                    lby_hi = gpy + th / 2 + OUTLINE_PAD
                    if lbx_hi < tile_gpx_lo or lbx_lo > tile_gpx_hi:
                        continue
                    if lby_hi < tile_gpy_lo or lby_lo > tile_gpy_hi:
                        continue
                    # Tile-local pixel anchor (top-left of text)
                    ax = gpx - tile_gpx_lo - tw / 2
                    ay = gpy - tile_gpy_lo - th / 2
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            if dx == 0 and dy == 0:
                                continue
                            draw.text((ax + dx, ay + dy), text, font=font, fill=(0, 0, 0, 230))
                    draw.text((ax, ay), text, font=font, fill=(255, 255, 255, 255))

                out_path = dst_tiles_dir / str(z) / str(tx) / f"{ty}.png"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                im.save(out_path, optimize=True)
                kept += 1

        counts[z] = kept
        print(f"  [contour] z{z}: {kept} tiles  ({len(global_labels)} global labels)")
    return counts


# ---------------------------------------------------------------------------
# Step 5: upload to Supabase Storage
# ---------------------------------------------------------------------------

@dataclass
class SupabaseConfig:
    url: str
    service_role_key: str
    bucket: str = "bathymetry-tiles"

    @classmethod
    def from_env(cls, dotenv_path: Path | None = None, bucket: str = "bathymetry-tiles") -> "SupabaseConfig":
        if dotenv_path is not None:
            try:
                from dotenv import load_dotenv  # type: ignore
                load_dotenv(dotenv_path=str(dotenv_path))
            except ImportError:
                pass
        url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from env")
        return cls(url=url, service_role_key=key, bucket=bucket)


def upload_tiles(
    tiles_dir: Path,
    folder_key: str,
    cfg: SupabaseConfig,
    content_type: str = "image/png",
    timeout: float = 30.0,
    max_retries: int = 3,
) -> tuple[int, int]:
    """Upload every PNG under tiles_dir to <bucket>/<folder_key>/<rel_path>.

    POSTs first; on 409 retries with PUT (idempotent overwrite).
    Each HTTP call uses an explicit (connect, read) timeout — without this a
    silently-dropped Supabase connection hangs the whole script indefinitely
    (real-world incident: pipeline_blakeney.py hung 4+ hours mid-upload before
    detection). On timeout or transient 5xx we retry up to max_retries times
    with exponential backoff. Returns (ok_count, fail_count).
    """
    import time

    tiles_dir = Path(tiles_dir)
    base = f"{cfg.url}/storage/v1/object/{cfg.bucket}"
    session = requests.Session()
    session.headers.update({
        "Authorization": f"Bearer {cfg.service_role_key}",
        "apikey": cfg.service_role_key,
    })

    def _send(method: str, target: str, data: bytes, headers: dict):
        last_err = None
        for attempt in range(max_retries):
            try:
                r = session.request(method, target, data=data, headers=headers, timeout=(10.0, timeout))
                return r, None
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                last_err = e
                time.sleep(min(2 ** attempt, 8))
        return None, last_err

    ok = 0
    fail = 0
    for png in tiles_dir.rglob("*.png"):
        rel = png.relative_to(tiles_dir).as_posix()
        target = f"{base}/{folder_key}/{rel}"
        with open(png, "rb") as fp:
            data = fp.read()
        headers = {"Content-Type": content_type, "x-upsert": "true"}

        r, err = _send("POST", target, data, headers)
        if r is not None and r.status_code == 409:
            r, err = _send("PUT", target, data, headers)

        if r is None:
            fail += 1
            print(f"  upload failed [exhausted retries] {rel}: {err}")
        elif r.ok:
            ok += 1
        else:
            fail += 1
            print(f"  upload failed [{r.status_code}] {rel}: {r.text[:120]}")
    print(f"  uploaded to {folder_key}/: ok={ok} fail={fail}")
    return ok, fail


# ---------------------------------------------------------------------------
# End-to-end driver
# ---------------------------------------------------------------------------

@dataclass
class PipelineConfig:
    bag_path: Path
    tif_out: Path
    tiles_dir: Path          # plain depth tiles
    contour_dir: Path        # contour+label tiles
    geojson_path: Path
    project_key: str         # e.g. "milfordhaven" — Supabase folder is <project_key>_ukho / <project_key>_ukho_c
    min_zoom: int = 10
    max_zoom: int = 15
    contour_depths: Sequence[float] = tuple(DEFAULT_CONTOUR_DEPTHS)
    contour_scale: int = 4
    contour_min_points: int = 10
    contour_thin: int = 3
    depth_ramp: Sequence[tuple[float, tuple[int, int, int]]] = tuple(DEFAULT_DEPTH_RAMP)
    contour_style: dict[float, tuple[tuple[int, int, int, int], int]] = None  # type: ignore[assignment]
    label_spacing_px: int = 60
    label_font_size: int = 11
    upload: bool = True
    src_crs_override: str | None = None   # e.g. "EPSG:32630" for BAGs with malformed CRS metadata


def run_pipeline(cfg: PipelineConfig, supabase_cfg: SupabaseConfig | None = None) -> dict:
    """Run all 5 stages end-to-end for one project. Returns a result summary dict."""
    if cfg.contour_style is None:
        cfg.contour_style = dict(DEFAULT_CONTOUR_STYLE)
    summary: dict = {"project": cfg.project_key}

    print(f"\n=== {cfg.project_key} ===")

    print(f"[1/5] BAG -> WGS84 GeoTIFF: {cfg.bag_path.name} -> {cfg.tif_out.name}")
    # Skip reprojection only if the GeoTIFF looks complete. A failed prior run can leave
    # behind a header-only shell that would silently feed zero data into stage 2.
    MIN_USABLE_TIF_BYTES = 1_000_000
    if cfg.tif_out.exists() and cfg.tif_out.stat().st_size >= MIN_USABLE_TIF_BYTES:
        print("  (geotiff exists — skipping reprojection)")
    else:
        if cfg.tif_out.exists():
            print(f"  (existing geotiff is suspiciously small at {cfg.tif_out.stat().st_size}B — regenerating)")
            cfg.tif_out.unlink()
        bag_to_wgs84_geotiff(cfg.bag_path, cfg.tif_out, src_crs_override=cfg.src_crs_override)
    summary["geotiff"] = str(cfg.tif_out)

    print(f"[2/5] Depth tiles z{cfg.min_zoom}-z{cfg.max_zoom} -> {cfg.tiles_dir}")
    depth_counts = generate_depth_tiles(
        cfg.tif_out, cfg.tiles_dir, cfg.min_zoom, cfg.max_zoom,
        depth_ramp=cfg.depth_ramp, label="depth",
    )
    summary["depth_tile_counts"] = depth_counts

    print(f"[3/5] Contour GeoJSON -> {cfg.geojson_path.name}")
    feature_count = generate_contour_geojson(
        cfg.tif_out, cfg.geojson_path,
        depths=cfg.contour_depths, scale=cfg.contour_scale,
        min_points=cfg.contour_min_points, thin=cfg.contour_thin,
        name=f"{cfg.project_key}_bathymetry_contours",
    )
    summary["contour_features"] = feature_count

    print(f"[4/5] Bake contours + labels -> {cfg.contour_dir}")
    contour_counts = bake_contour_tiles(
        cfg.tiles_dir, cfg.contour_dir, cfg.geojson_path,
        zooms=range(cfg.min_zoom, cfg.max_zoom + 1),
        contour_style=cfg.contour_style,
        label_spacing_px=cfg.label_spacing_px,
        label_font_size=cfg.label_font_size,
    )
    summary["contour_tile_counts"] = contour_counts

    if cfg.upload:
        if supabase_cfg is None:
            supabase_cfg = SupabaseConfig.from_env()
        print(f"[5/5] Uploading to bucket={supabase_cfg.bucket}")
        ok_d, fail_d = upload_tiles(cfg.tiles_dir,   f"{cfg.project_key}_ukho",   supabase_cfg)
        ok_c, fail_c = upload_tiles(cfg.contour_dir, f"{cfg.project_key}_ukho_c", supabase_cfg)
        summary["uploaded_depth"]   = {"ok": ok_d, "fail": fail_d}
        summary["uploaded_contour"] = {"ok": ok_c, "fail": fail_c}
    else:
        print("[5/5] upload=False — skipping Supabase upload")

    return summary
