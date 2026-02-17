"""
Video Prescreening Script
Analyzes video brightness and focus quality by sampling frames.
"""

import cv2
import numpy as np
import json
import sys
import argparse
from pathlib import Path

def sample_frame_indices(total_frames: int, num_samples: int = 10) -> list:
    """Get evenly distributed frame indices."""
    if total_frames <= num_samples:
        return list(range(total_frames))

    step = total_frames / num_samples
    return [int(i * step) for i in range(num_samples)]

def calculate_brightness(frame: np.ndarray) -> tuple:
    """Calculate normalized brightness (0-1) with aggressive scaling for underwater footage."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    raw = float(np.mean(gray))

    # Aggressive remapping for underwater range
    # Map typical underwater range (70-180) to full 0-1 scale
    # 0 = "dark" (not pitch black), 100 = "bright" (not extremely bright)

    # Define underwater-specific anchor points
    DARK_POINT = 70.0      # Raw value that maps to 0 (dark but visible)
    BRIGHT_POINT = 180.0   # Raw value that maps to 1.0 (bright but reasonable)

    # Linear mapping with saturation at extremes
    if raw <= DARK_POINT:
        normalized = (raw / DARK_POINT) * 0.15  # Below dark point: 0-15%
    elif raw >= BRIGHT_POINT:
        normalized = 0.85 + ((raw - BRIGHT_POINT) / (255 - BRIGHT_POINT)) * 0.15  # Above bright point: 85-100%
    else:
        # Main range: linear map with slight S-curve for better distribution
        linear = (raw - DARK_POINT) / (BRIGHT_POINT - DARK_POINT)
        # Apply gentle power curve (0.9) to slightly boost mid-range contrast
        normalized = 0.15 + (linear ** 0.9) * 0.70

    # Clamp to 0-1
    normalized = max(0.0, min(1.0, normalized))

    return normalized, raw

def calculate_focus(frame: np.ndarray) -> tuple:
    """
    Sophisticated focus/sharpness measurement using multiple metrics.
    Measures how much detail a human could actually resolve in the image.
    Returns composite score (0-1) and raw variance for reference.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # === Metric 1: Edge Sharpness (Laplacian Variance) ===
    # Measures high-frequency content and edge definition
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    laplacian_var = float(laplacian.var())
    edge_score = laplacian_var / (laplacian_var + 50.0)

    # === Metric 2: Gradient Magnitude (Sobel) ===
    # Measures directional edge strength - captures visible contours
    sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    gradient_magnitude = np.sqrt(sobelx**2 + sobely**2)
    gradient_mean = float(np.mean(gradient_magnitude))
    gradient_score = gradient_mean / (gradient_mean + 20.0)

    # === Metric 3: Local Contrast (Standard Deviation) ===
    # Measures texture detail and local variation - what humans perceive as "clarity"
    # Use 16x16 blocks to analyze local regions
    h, w = gray.shape
    block_size = 16
    contrast_scores = []

    for y in range(0, h - block_size, block_size):
        for x in range(0, w - block_size, block_size):
            block = gray[y:y+block_size, x:x+block_size]
            block_std = np.std(block)
            contrast_scores.append(block_std)

    if len(contrast_scores) > 0:
        avg_contrast = float(np.mean(contrast_scores))
        contrast_score = avg_contrast / (avg_contrast + 15.0)
    else:
        contrast_score = 0.0

    # === Metric 4: High-Frequency Content (Texture Detail) ===
    # Measures fine detail that humans can resolve
    # Use a high-pass filter (subtract blurred from original)
    blurred = cv2.GaussianBlur(gray, (5, 5), 1.0)
    high_freq = cv2.subtract(gray, blurred)
    high_freq_energy = float(np.mean(np.abs(high_freq)))
    texture_score = high_freq_energy / (high_freq_energy + 8.0)

    # === Composite Score with Weighted Average ===
    # Weight metrics by importance to human perception
    EDGE_WEIGHT = 0.25      # Sharp edges matter but not everything
    GRADIENT_WEIGHT = 0.30  # Visible contours are very important
    CONTRAST_WEIGHT = 0.30  # Local detail is critical for perception
    TEXTURE_WEIGHT = 0.15   # Fine texture adds perceived sharpness

    composite = (
        edge_score * EDGE_WEIGHT +
        gradient_score * GRADIENT_WEIGHT +
        contrast_score * CONTRAST_WEIGHT +
        texture_score * TEXTURE_WEIGHT
    )

    # Apply power curve to spread scores more (0.7 gives good distribution)
    composite = composite ** 0.7

    # Map to reasonable underwater range (15-95%)
    # Even soft underwater footage should score 20-40%
    normalized = 0.15 + (composite * 0.80)

    # Clamp to valid range
    normalized = max(0.15, min(0.95, normalized))

    # Return composite score and original variance for reference
    return normalized, laplacian_var

def calculate_quality_score(brightness: float, focus: float) -> float:
    """Combined quality score with weights and enhanced scaling."""
    # Focus weight reduced by 0.2x (0.6 * 0.2 = 0.12)
    # Brightness weight increased to compensate (0.88)
    BRIGHTNESS_WEIGHT = 0.88
    FOCUS_WEIGHT = 0.12

    # Penalize extreme brightness
    brightness_adj = brightness
    if brightness > 0.85:
        brightness_adj = max(0, 1.0 - (brightness - 0.85) * 3)
    elif brightness < 0.15:
        brightness_adj = brightness * 2

    quality = (brightness_adj * BRIGHTNESS_WEIGHT) + (focus * FOCUS_WEIGHT)

    # Apply moderate boost to spread scores better (reduced from 0.6 to 0.75)
    # Since we already enhanced individual metrics, use gentler boost here
    quality_boosted = quality ** 0.75

    return min(max(quality_boosted, 0), 1)

def prescreen_video(video_path: str, num_samples: int = 10) -> dict:
    """
    Prescreen a video for brightness and focus quality.

    Returns:
        dict with brightness, focus, quality scores and metadata
    """
    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        return {
            "success": False,
            "error": f"Could not open video: {video_path}"
        }

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if total_frames == 0:
        return {
            "success": False,
            "error": "Video has no frames"
        }

    # Get sample frame indices
    sample_indices = sample_frame_indices(total_frames, num_samples)

    brightness_scores = []
    focus_scores = []
    brightness_raw_values = []
    focus_raw_values = []

    for frame_idx in sample_indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()

        if not ret:
            continue

        # Calculate metrics
        bright_norm, bright_raw = calculate_brightness(frame)
        focus_norm, focus_raw = calculate_focus(frame)

        brightness_scores.append(bright_norm)
        focus_scores.append(focus_norm)
        brightness_raw_values.append(bright_raw)
        focus_raw_values.append(focus_raw)

    cap.release()

    if len(brightness_scores) == 0:
        return {
            "success": False,
            "error": "Could not read any frames"
        }

    # Average scores across samples
    avg_brightness = float(np.mean(brightness_scores))
    avg_focus = float(np.mean(focus_scores))
    quality_score = calculate_quality_score(avg_brightness, avg_focus)

    # Classify results (updated for enhanced scaling)
    def classify_brightness(b):
        if b < 0.20: return "very dark"
        elif b < 0.35: return "dark"
        elif b < 0.50: return "dim"
        elif b < 0.65: return "normal"
        elif b < 0.80: return "bright"
        else: return "very bright"

    def classify_focus(f):
        if f < 0.25: return "very soft"
        elif f < 0.40: return "soft"
        elif f < 0.55: return "acceptable"
        elif f < 0.70: return "good"
        elif f < 0.85: return "sharp"
        else: return "very sharp"

    def classify_quality(q):
        if q < 0.15: return "very poor"
        elif q < 0.30: return "poor"
        elif q < 0.45: return "low"
        elif q < 0.60: return "acceptable"
        elif q < 0.75: return "good"
        else: return "excellent"

    return {
        "success": True,
        "video_path": video_path,
        "video_info": {
            "total_frames": total_frames,
            "fps": fps,
            "width": width,
            "height": height,
            "duration_seconds": total_frames / fps if fps > 0 else 0
        },
        "sampling": {
            "num_samples": len(brightness_scores),
            "requested_samples": num_samples,
            "frame_indices": sample_indices[:len(brightness_scores)]
        },
        "brightness": {
            "score": round(avg_brightness, 3),
            "raw_avg": round(float(np.mean(brightness_raw_values)), 1),
            "raw_min": round(float(np.min(brightness_raw_values)), 1),
            "raw_max": round(float(np.max(brightness_raw_values)), 1),
            "classification": classify_brightness(avg_brightness),
            "per_sample": [round(s, 3) for s in brightness_scores]
        },
        "focus": {
            "score": round(avg_focus, 3),
            "variance_avg": round(float(np.mean(focus_raw_values)), 1),
            "variance_min": round(float(np.min(focus_raw_values)), 1),
            "variance_max": round(float(np.max(focus_raw_values)), 1),
            "classification": classify_focus(avg_focus),
            "per_sample": [round(s, 3) for s in focus_scores]
        },
        "quality": {
            "score": round(quality_score, 3),
            "classification": classify_quality(quality_score)
        }
    }

def main():
    parser = argparse.ArgumentParser(description='Prescreen video for quality metrics')
    parser.add_argument('video_path', help='Path to video file')
    parser.add_argument('--samples', type=int, default=10, help='Number of frames to sample (default: 10)')
    parser.add_argument('--output', help='Output JSON file path (optional)')

    args = parser.parse_args()

    result = prescreen_video(args.video_path, args.samples)

    if args.output:
        with open(args.output, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"Results written to: {args.output}")
    else:
        print(json.dumps(result, indent=2))

    # Exit with error code if failed
    sys.exit(0 if result.get("success") else 1)

if __name__ == "__main__":
    main()
