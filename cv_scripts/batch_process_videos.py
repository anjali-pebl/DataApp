#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Batch Processing Script for Underwater Video Analysis
=====================================================

This script automates the pipeline of:
1. Background subtraction on raw videos
2. Motion analysis on background-subtracted videos
3. Compilation of results into a comparison report

Usage:
    python cv_scripts/batch_process_videos.py --input <video_dir> --output <output_dir>
    python cv_scripts/batch_process_videos.py --input "Labeled_Datasets/04_Algapelago_Test_Nov2024/ML test sample From Alga Nov24/input raw" --duration 30 --subsample 6
"""

import os
import sys
import json

# Set UTF-8 encoding for Windows console to handle emoji/unicode characters
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
import glob
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
import numpy as np
import time
import requests

# Import logging utilities
from logging_utils import (
    set_verbosity, get_verbosity,
    VERBOSITY_MINIMAL, VERBOSITY_NORMAL, VERBOSITY_DETAILED,
    print_batch_header, print_batch_summary,
    print_video_header, print_output_location,
    print_minimal_progress,
    STATUS_SUCCESS, STATUS_ERROR, STATUS_WARNING
)

# Import heartbeat for crash resilience
from heartbeat import Heartbeat

def notify_api_complete(api_url, run_id, video_id, motion_analysis_path, success=True, error=None):
    """Notify the API that a video has completed processing."""
    try:
        response = requests.post(
            f"{api_url}/api/motion-analysis/process/complete",
            json={
                "runId": run_id,
                "videoId": video_id,
                "motionAnalysisPath": motion_analysis_path,
                "success": success,
                "error": error
            },
            timeout=10
        )
        if response.status_code == 200:
            return True
        else:
            print(f"  [WARNING] API update failed: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"  [WARNING] API update exception: {e}")
        return False

def find_videos(input_dir, pattern="*.mp4"):
    """Find all video files in the input directory."""
    video_paths = glob.glob(os.path.join(input_dir, pattern))
    video_paths.sort()
    return video_paths

def run_background_subtraction(video_path, output_dir, duration=30, subsample=6):
    """Run background subtraction script on a single video."""
    cmd = [
        "python", "cv_scripts/background_subtraction.py",
        "--input", video_path,
        "--output", output_dir,
        "--duration", str(duration),
        "--subsample", str(subsample)
    ]

    try:
        # Suppress output for cleaner logs
        # Use UTF-8 encoding with error handling to avoid UnicodeDecodeError on Windows
        result = subprocess.run(cmd, check=True, capture_output=True, text=True,
                              encoding='utf-8', errors='replace')
        return True
    except subprocess.CalledProcessError as e:
        print(f"  ERROR: Background subtraction script failed")
        print(f"  Command: {' '.join(cmd)}")
        if e.stderr:
            print(f"  Error details:\n{e.stderr}")
        return False

def run_motion_analysis(bg_subtracted_video, output_dir):
    """Run motion analysis script on a background-subtracted video."""
    print(f"\n{'='*80}")
    print(f"Processing Motion Analysis: {os.path.basename(bg_subtracted_video)}")
    print(f"{'='*80}")

    cmd = [
        "python", "cv_scripts/motion_analysis.py",
        "--input", bg_subtracted_video,
        "--output", output_dir,
        "--no-viz"  # Skip visualization to avoid errors
    ]

    try:
        # Use UTF-8 encoding with error handling to avoid UnicodeDecodeError on Windows
        result = subprocess.run(cmd, check=True, capture_output=True, text=True,
                              encoding='utf-8', errors='replace')
        print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"ERROR: Motion analysis failed for {bg_subtracted_video}")
        print(e.stderr)
        return False

def run_benthic_activity_v4(bg_subtracted_video, output_dir, params=None, video_id=None, run_id=None):
    """Run Benthic Activity Detection V4 on a background-subtracted video."""
    cmd = [
        "python", "cv_scripts/benthic_activity_detection_v4.py",
        "--input", bg_subtracted_video,
        "--output", output_dir,
    ]

    # Add optional parameter overrides
    if params:
        if 'dark_threshold' in params:
            cmd.extend(["--dark-threshold", str(params['dark_threshold'])])
        if 'bright_threshold' in params:
            cmd.extend(["--bright-threshold", str(params['bright_threshold'])])
        if 'min_area' in params:
            cmd.extend(["--min-area", str(params['min_area'])])
        if 'max_area' in params:
            cmd.extend(["--max-area", str(params['max_area'])])
        if 'coupling_distance' in params:
            cmd.extend(["--coupling-distance", str(params['coupling_distance'])])
        if 'max_distance' in params:
            cmd.extend(["--max-distance", str(params['max_distance'])])
        if 'max_skip_frames' in params:
            cmd.extend(["--max-skip-frames", str(params['max_skip_frames'])])
        if 'rest_zone_radius' in params:
            cmd.extend(["--rest-zone-radius", str(params['rest_zone_radius'])])
        if 'min_track_length' in params:
            cmd.extend(["--min-track-length", str(params['min_track_length'])])
        if 'min_displacement' in params:
            cmd.extend(["--min-displacement", str(params['min_displacement'])])
        if 'max_speed' in params:
            cmd.extend(["--max-speed", str(params['max_speed'])])
        if 'min_speed' in params:
            cmd.extend(["--min-speed", str(params['min_speed'])])

    try:
        # Suppress output for cleaner logs
        # Use UTF-8 encoding with error handling to avoid UnicodeDecodeError on Windows
        result = subprocess.run(cmd, check=True, capture_output=True, text=True,
                              encoding='utf-8', errors='replace')
        return True
    except subprocess.CalledProcessError as e:
        return False

def run_yolo_detection(video_path, output_dir, model_name='yolov8m'):
    """Run YOLOv8 detection on a video."""
    base_name = os.path.splitext(os.path.basename(video_path))[0]

    # Determine model path based on model name
    model_path_map = {
        'yolov8n': 'yolov8n.pt',
        'yolov8m': 'Labeled_Datasets/05_Models/Y12_11kL_12k(brackish)_E100_Augmented_best.pt',
        'yolov8l': 'yolov8l.pt'
    }
    model_path = model_path_map.get(model_name, model_path_map['yolov8m'])

    # Use the standalone YOLOv8 processing script
    # It will save outputs in public/videos/ and public/motion-analysis-results/
    cmd = [
        "python", "process_videos_yolov8.py",
        "--input", os.path.basename(video_path),
        "--model", model_path
    ]

    try:
        # Suppress output for cleaner logs
        # Use UTF-8 encoding with error handling to avoid UnicodeDecodeError on Windows
        result = subprocess.run(cmd, check=True, capture_output=True, text=True,
                              encoding='utf-8', errors='replace')

        # The script outputs to public/motion-analysis-results/{base_name}/{base_name}_yolov8.json
        output_json = os.path.join(output_dir, f"{base_name}_yolov8.json")

        # Check if output files were created
        if os.path.exists(output_json):
            # Count detections from JSON
            try:
                with open(output_json, 'r') as f:
                    data = json.load(f)
                    total_detections = sum(len(frame_data.get('detections', []))
                                          for frame_data in data.get('detections', []))
                    return True, total_detections
            except:
                pass

        return True, 0
    except subprocess.CalledProcessError as e:
        return False, 0

def load_motion_analysis_results(results_dir):
    """Load all motion analysis JSON files from results directory."""
    results = []

    # Find all motion_analysis JSON files (both in root and subdirectories)
    json_files = []
    json_files.extend(glob.glob(os.path.join(results_dir, "*_motion_analysis.json")))
    json_files.extend(glob.glob(os.path.join(results_dir, "*", "*_motion_analysis.json")))
    json_files.sort()

    for json_file in json_files:
        try:
            with open(json_file, 'r') as f:
                data = json.load(f)
                results.append({
                    'file': os.path.basename(json_file),
                    'video': data['video_info']['filename'],
                    'data': data
                })
        except Exception as e:
            print(f"Warning: Could not load {json_file}: {e}")

    return results

def extract_time_from_filename(filename):
    """Extract time from filename like SUBCAM_ALG_2020-01-26_09-00-40.mp4"""
    try:
        # Extract time portion (09-00-40)
        parts = filename.split('_')
        time_str = parts[-1].replace('.mp4', '').replace('_background_subtracted', '')
        hour = time_str.split('-')[0]
        return f"{hour}:00"
    except:
        return "Unknown"

def generate_comparison_report(results, output_file):
    """Generate a markdown comparison report from all motion analysis results."""

    with open(output_file, 'w') as f:
        f.write("# Batch Motion Analysis Comparison - Algapelago Videos\n\n")
        f.write(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"**Total Videos Analyzed:** {len(results)}\n\n")

        f.write("---\n\n")
        f.write("## Quick Summary Table\n\n")
        f.write("| Video | Time | Duration | Activity Score | Organisms | Avg Density | Peak Density |\n")
        f.write("|-------|------|----------|----------------|-----------|-------------|---------------|\n")

        # Sort by activity score descending
        sorted_results = sorted(results, key=lambda x: x['data']['activity_score']['overall_score'], reverse=True)

        for result in sorted_results:
            data = result['data']
            video_name = os.path.basename(data['video_info']['filename']).replace('_background_subtracted.mp4', '')
            time = extract_time_from_filename(data['video_info']['filename'])
            duration = f"{data['video_info']['duration_seconds']:.1f}s"
            activity = f"{data['activity_score']['overall_score']:.1f}/100"
            organisms = data['organisms']['total_detections']
            avg_density = f"{data['density']['avg_density']:.2f}%"
            peak_density = f"{data['density']['max_density']:.2f}%"

            # Highlight interesting values
            if organisms > 0:
                organisms = f"**{organisms}**"
            if data['density']['avg_density'] > 0.1:
                avg_density = f"**{avg_density}**"
            if data['density']['max_density'] > 10.0:
                peak_density = f"**{peak_density}**"

            f.write(f"| {video_name} | {time} | {duration} | {activity} | {organisms} | {avg_density} | {peak_density} |\n")

        f.write("\n---\n\n")
        f.write("## Key Findings\n\n")

        # Calculate statistics
        all_scores = [r['data']['activity_score']['overall_score'] for r in results]
        all_organisms = [r['data']['organisms']['total_detections'] for r in results]
        all_densities = [r['data']['density']['avg_density'] for r in results]
        all_peak_densities = [r['data']['density']['max_density'] for r in results]

        f.write(f"- **Average Activity Score:** {np.mean(all_scores):.1f}/100 (range: {min(all_scores):.1f} - {max(all_scores):.1f})\n")
        f.write(f"- **Total Organisms Detected:** {sum(all_organisms)} across all videos\n")
        f.write(f"- **Videos with Detections:** {sum(1 for x in all_organisms if x > 0)}/{len(results)}\n")
        f.write(f"- **Average Motion Density:** {np.mean(all_densities):.3f}% (peak: {max(all_densities):.3f}%)\n")
        f.write(f"- **Highest Peak Density:** {max(all_peak_densities):.2f}%\n")

        # Find best video
        best_idx = np.argmax(all_scores)
        best_video = os.path.basename(sorted_results[best_idx]['data']['video_info']['filename'])
        f.write(f"\n**Most Active Video:** {best_video} (score: {all_scores[best_idx]:.1f})\n")

        # Find video with most organisms
        most_organisms_idx = np.argmax(all_organisms)
        if all_organisms[most_organisms_idx] > 0:
            org_video = os.path.basename(results[most_organisms_idx]['data']['video_info']['filename'])
            f.write(f"**Most Organisms:** {org_video} ({all_organisms[most_organisms_idx]} detections)\n")

        f.write("\n---\n\n")
        f.write("## Detailed Results\n\n")

        for i, result in enumerate(sorted_results, 1):
            data = result['data']
            video_name = os.path.basename(data['video_info']['filename'])

            f.write(f"### {i}. {video_name}\n\n")
            f.write(f"**Time:** {extract_time_from_filename(video_name)}\n")
            f.write(f"**Duration:** {data['video_info']['duration_seconds']:.1f}s ({data['video_info']['total_frames']} frames @ {data['video_info']['fps']:.2f} fps)\n\n")

            f.write("**Activity Metrics:**\n")
            f.write(f"- Overall Score: **{data['activity_score']['overall_score']:.1f}/100**\n")
            f.write(f"- Motion Energy: {data['motion']['avg_energy']:.0f} avg (max: {data['motion']['max_energy']:.0f})\n")
            f.write(f"- Motion Density: {data['density']['avg_density']:.3f}% avg (peak: {data['density']['max_density']:.2f}%)\n")
            f.write(f"- Organisms Detected: {data['organisms']['total_detections']}\n")

            if data['organisms']['total_detections'] > 0:
                size_dist = data['organisms']['size_distribution']
                f.write(f"  - Small: {size_dist['small']}, Medium: {size_dist['medium']}, Large: {size_dist['large']}\n")
                f.write(f"  - Mean size: {size_dist['mean_size']:.1f} pixels\n")

            f.write(f"\n**Component Scores:**\n")
            comp_scores = data['activity_score']['component_scores']
            f.write(f"- Energy: {comp_scores['energy']:.1f}/100\n")
            f.write(f"- Density: {comp_scores['density']:.1f}/100\n")
            f.write(f"- Count: {comp_scores['count']:.1f}/100\n")
            f.write(f"- Size: {comp_scores['size']:.1f}/100\n")

            f.write(f"\n**Processing:** {data['processing_time_seconds']:.1f}s\n\n")
            f.write("---\n\n")

        f.write("## Metrics Explanation\n\n")
        f.write("### Activity Score (0-100)\n")
        f.write("Combined metric weighted as: Energy (30%), Density (20%), Count (30%), Size (20%).\n")
        f.write("Higher scores indicate more movement and organism activity.\n\n")

        f.write("### Motion Energy\n")
        f.write("Sum of absolute pixel deviations from neutral gray (128).\n")
        f.write("Higher values = more intense or widespread movement.\n\n")

        f.write("### Motion Density (%)\n")
        f.write("Percentage of pixels actively moving above threshold.\n")
        f.write("Shows what portion of the frame contains movement.\n\n")

        f.write("### Organism Count\n")
        f.write("Number of distinct moving blobs detected using connected components analysis.\n")
        f.write("Current parameters: min_size=50px, max_size=50000px, threshold=20.\n\n")

        f.write("---\n\n")
        f.write("## Use Cases\n\n")
        f.write("1. **Time-of-day comparison** - Identify optimal sampling times\n")
        f.write("2. **Video prioritization** - Process high-activity videos with YOLO first\n")
        f.write("3. **Seasonal patterns** - Track activity changes over time\n")
        f.write("4. **Site comparison** - Compare different farm locations\n")
        f.write("5. **Quality control** - Flag videos with unusual activity patterns\n\n")

        f.write("---\n\n")
        f.write("## Next Steps\n\n")
        f.write("- [ ] Tune detection parameters for better organism detection\n")
        f.write("- [ ] Process longer clips (60-120s) for better baseline\n")
        f.write("- [ ] Integrate with Data Processing UI\n")
        f.write("- [ ] Combine with YOLO detection pipeline\n")
        f.write("- [ ] Add temporal analysis (activity over time within video)\n")
        f.write("- [ ] Export results to CSV for further analysis\n")

def main():
    parser = argparse.ArgumentParser(description='Batch process underwater videos for motion analysis')
    parser.add_argument('--input', type=str, help='Directory containing input videos')
    parser.add_argument('--output', type=str, default='results', help='Output directory for results')
    parser.add_argument('--duration', type=int, default=30, help='Duration in seconds to process from each video')
    parser.add_argument('--subsample', type=int, default=6, help='Process every Nth frame')
    parser.add_argument('--skip-bg', action='store_true', help='Skip background subtraction (use existing bg-subtracted videos)')
    parser.add_argument('--skip-motion', action='store_true', help='Skip motion analysis')
    parser.add_argument('--report-only', action='store_true', help='Only generate comparison report from existing results')

    # Verbosity control
    verbosity_group = parser.add_mutually_exclusive_group()
    verbosity_group.add_argument('--quiet', '-q', action='store_true', help='Minimal output (results only)')
    verbosity_group.add_argument('--verbose', '-v', action='store_true', help='Detailed output (all technical details)')

    # API-based processing arguments
    parser.add_argument('--run-id', type=str, help='Processing run ID for API-based processing')
    parser.add_argument('--run-type', type=str, choices=['local', 'modal-t4', 'modal-a10g'], help='Run type for API processing')
    parser.add_argument('--videos', type=str, help='JSON string of video info for API processing')
    parser.add_argument('--api-url', type=str, help='API URL for status updates')
    parser.add_argument('--settings', type=str, help='JSON string of processing settings')

    args = parser.parse_args()

    # Set verbosity level
    if args.quiet:
        set_verbosity(VERBOSITY_MINIMAL)
    elif args.verbose:
        set_verbosity(VERBOSITY_DETAILED)
    else:
        set_verbosity(VERBOSITY_NORMAL)

    # API-based processing mode
    if args.run_id and args.videos and args.settings:
        import json

        videos_info = json.loads(args.videos)
        settings = json.loads(args.settings)

        output_dir = os.path.join('public', 'motion-analysis-results')
        os.makedirs(output_dir, exist_ok=True)

        # Print simple start message
        print(f"\n{'='*70}")
        print(f"STARTING VIDEO PROCESSING")
        print(f"{'='*70}")
        print(f"Videos to process: {len(videos_info)}")
        print(f"Run ID: {args.run_id[:8]}...")
        print(f"{'='*70}\n")

        # Start heartbeat for crash resilience
        heartbeat = None
        if args.api_url and args.run_id:
            heartbeat = Heartbeat(args.api_url, args.run_id, interval_seconds=10)
            heartbeat.start()

        # Track statistics
        batch_start_time = time.time()
        successful_videos = 0
        total_organisms = 0

        try:
            for i, video in enumerate(videos_info, 1):
                try:
                    video_filepath = video['filepath']
                    video_filename = video['filename']
                    video_id = video.get('video_id', None)
                    base_name = os.path.splitext(video_filename)[0]

                    # Create subdirectory for this video's results
                    video_output_dir = os.path.join(output_dir, base_name)
                    os.makedirs(video_output_dir, exist_ok=True)

                    # Print simple video header
                    print(f"\n[Video {i}/{len(videos_info)}] {video_filename}")
                    print("-" * 70)

                    video_start_time = time.time()
                    video_organisms = 0
                    video_success = False
                    video_error = None
                except Exception as video_exception:
                    # Handle unexpected errors in video setup
                    import traceback
                    error_msg = f"Unexpected error in video setup: {str(video_exception)}"
                    print(f"\n[ERROR] {error_msg}")
                    traceback.print_exc()

                    # Try to notify API if we have video_id
                    try:
                        if args.api_url and 'video_id' in video:
                            notify_api_complete(args.api_url, args.run_id, video['video_id'], None, success=False, error=error_msg)
                    except:
                        pass
                    continue

                # Phase 1: Background Subtraction
                if os.path.exists(video_filepath):
                    print("  Step 1: Removing background...", end=" ", flush=True)
                    bg_success = run_background_subtraction(
                        video_filepath,
                        video_output_dir,
                        duration=settings.get('duration', 30),
                        subsample=settings.get('subsample', 6)
                    )

                    if not bg_success:
                        print("FAILED")
                        print(f"  Error: Could not remove background from video")
                        video_error = "Background subtraction failed"
                        # Notify API of failure
                        if args.api_url and video_id:
                            notify_api_complete(args.api_url, args.run_id, video_id, None, success=False, error=video_error)
                        continue

                    print("Done")

                    bg_video = os.path.join(video_output_dir, f"{base_name}_background_subtracted.mp4")

                    # Phase 2: Benthic Activity V4 or Motion Analysis
                    if settings.get('enableBenthicActivityV4', True):
                        print("  Step 2: Detecting organisms...", end=" ", flush=True)
                        bav4_params = settings.get('benthicActivityParams', None)
                        bav4_success = run_benthic_activity_v4(
                            bg_video,
                            video_output_dir,
                            params=bav4_params,
                            video_id=video_id,
                            run_id=args.run_id
                        )
                        if not bav4_success:
                            print("FAILED")
                        else:
                            # Try to read the results to get organism count
                            results_file = os.path.join(video_output_dir, f"{base_name}_background_subtracted_benthic_activity_v4.json")
                            if os.path.exists(results_file):
                                try:
                                    with open(results_file, 'r') as f:
                                        results = json.load(f)
                                        video_organisms = len(results.get('tracks', []))
                                        total_organisms += video_organisms
                                        print(f"Done (found {video_organisms} organisms)")
                                except:
                                    print("Done")
                            else:
                                print("Done")

                    elif settings.get('enableMotionAnalysis', False):
                        print("  Step 2: Analyzing motion...", end=" ", flush=True)
                        motion_success = run_motion_analysis(bg_video, video_output_dir)
                        if not motion_success:
                            print("FAILED")
                        else:
                            print("Done")

                    # Phase 3: YOLOv8 Detection (if enabled)
                    video_yolo_detections = 0
                    if settings.get('enableYolo', True):
                        print("  Step 3: Running AI detection...", end=" ", flush=True)
                        yolo_model = settings.get('yoloModel', 'yolov8m')
                        yolo_success, yolo_detections = run_yolo_detection(
                            video_filepath,
                            video_output_dir,
                            model_name=yolo_model
                        )
                        if yolo_success:
                            video_yolo_detections = yolo_detections
                            print(f"Done (found {yolo_detections} detections)")
                        else:
                            print("FAILED")

                    successful_videos += 1
                    video_success = True

                    # Determine motion analysis path for database
                    # Use the BAv4 results file as the primary motion analysis
                    motion_analysis_path = None
                    if os.path.exists(os.path.join(video_output_dir, f"{base_name}_background_subtracted_benthic_activity_v4.json")):
                        motion_analysis_path = f"motion-analysis-results/{base_name}/{base_name}_background_subtracted_benthic_activity_v4.json"

                    # Notify API of success
                    if args.api_url and video_id:
                        notify_api_complete(args.api_url, args.run_id, video_id, motion_analysis_path, success=True)

                    # Print completion summary
                    video_time = time.time() - video_start_time
                    mins = int(video_time // 60)
                    secs = int(video_time % 60)
                    time_str = f"{mins}m {secs}s" if mins > 0 else f"{secs}s"

                    print(f"\n  ✓ Video complete in {time_str}")
                    if video_organisms > 0 or video_yolo_detections > 0:
                        summary_parts = []
                        if video_organisms > 0:
                            summary_parts.append(f"{video_organisms} organisms tracked")
                        if video_yolo_detections > 0:
                            summary_parts.append(f"{video_yolo_detections} AI detections")
                        print(f"  Results: {', '.join(summary_parts)}")

                else:
                    print(f"\n  ✗ Error: Video file not found")
                    # Notify API of failure
                    if args.api_url and video_id:
                        notify_api_complete(args.api_url, args.run_id, video_id, None, success=False, error="Video file not found")

            # Print final summary
            batch_time = time.time() - batch_start_time
            mins = int(batch_time // 60)
            secs = int(batch_time % 60)
            time_str = f"{mins}m {secs}s" if mins > 0 else f"{secs}s"

            print(f"\n{'='*70}")
            print(f"ALL VIDEOS COMPLETE")
            print(f"{'='*70}")
            print(f"Total time: {time_str}")
            print(f"Videos processed: {successful_videos}/{len(videos_info)}")
            print(f"Organisms found: {total_organisms}")
            print(f"Results saved to: {os.path.abspath(output_dir)}")
            print(f"{'='*70}\n")

            # Save processing logs to database for successful completion
            if args.api_url and args.run_id:
                try:
                    print("[SUCCESS] Saving processing logs to database...")
                    response = requests.post(
                        f"{args.api_url}/api/motion-analysis/process/save-logs",
                        json={"runId": args.run_id},
                        timeout=30
                    )
                    if response.status_code == 200:
                        print("[SUCCESS] ✓ Processing logs saved to database")
                    else:
                        print(f"[WARNING] ✗ Failed to save logs: {response.status_code}")
                except Exception as save_error:
                    print(f"[WARNING] ✗ Could not save logs: {str(save_error)}")

        except Exception as batch_exception:
            # Handle catastrophic batch processing failure
            import traceback
            print(f"\n{'='*70}")
            print(f"[ERROR] BATCH PROCESSING FAILED")
            print(f"{'='*70}")
            print(f"Error: {str(batch_exception)}")
            print(f"\nTraceback:")
            traceback.print_exc()
            print(f"{'='*70}\n")

            # Mark the run as failed in the database
            if args.api_url and args.run_id:
                try:
                    print("[ERROR] Saving error logs to database...")
                    response = requests.post(
                        f"{args.api_url}/api/motion-analysis/process/save-logs",
                        json={"runId": args.run_id},
                        timeout=30
                    )
                    if response.status_code == 200:
                        print("[ERROR] ✓ Error logs saved to database")
                    else:
                        print(f"[ERROR] ✗ Failed to save logs: {response.status_code}")
                except Exception as save_error:
                    print(f"[ERROR] ✗ Could not save error logs: {str(save_error)}")

            return 1

        finally:
            # Stop heartbeat (ensures it stops even if processing crashes)
            if heartbeat:
                heartbeat.stop()

        return 0

    # Create output directory
    os.makedirs(args.output, exist_ok=True)

    if not args.report_only:
        # Find all videos
        print(f"\n{'='*80}")
        print(f"BATCH PROCESSING PIPELINE")
        print(f"{'='*80}")
        print(f"Input directory: {args.input}")
        print(f"Output directory: {args.output}")
        print(f"Duration: {args.duration}s, Subsample: every {args.subsample} frames")
        print(f"{'='*80}\n")

        video_files = find_videos(args.input)
        print(f"Found {len(video_files)} videos to process\n")

        if len(video_files) == 0:
            print("ERROR: No videos found in input directory")
            return 1

        # Process each video
        bg_subtracted_videos = []

        if not args.skip_bg:
            print(f"\n{'#'*80}")
            print(f"PHASE 1: BACKGROUND SUBTRACTION ({len(video_files)} videos)")
            print(f"{'#'*80}\n")

            for i, video_path in enumerate(video_files, 1):
                print(f"\n[{i}/{len(video_files)}] {os.path.basename(video_path)}")
                success = run_background_subtraction(video_path, args.output, args.duration, args.subsample)

                if success:
                    # Find the generated background-subtracted video
                    base_name = os.path.splitext(os.path.basename(video_path))[0]
                    bg_video = os.path.join(args.output, f"{base_name}_background_subtracted.mp4")
                    if os.path.exists(bg_video):
                        bg_subtracted_videos.append(bg_video)
        else:
            # Find existing background-subtracted videos
            bg_subtracted_videos = glob.glob(os.path.join(args.output, "*_background_subtracted.mp4"))
            bg_subtracted_videos.sort()
            print(f"Found {len(bg_subtracted_videos)} existing background-subtracted videos")

        if not args.skip_motion and len(bg_subtracted_videos) > 0:
            print(f"\n{'#'*80}")
            print(f"PHASE 2: MOTION ANALYSIS ({len(bg_subtracted_videos)} videos)")
            print(f"{'#'*80}\n")

            for i, bg_video in enumerate(bg_subtracted_videos, 1):
                print(f"\n[{i}/{len(bg_subtracted_videos)}] {os.path.basename(bg_video)}")
                run_motion_analysis(bg_video, args.output)

    # Generate comparison report
    print(f"\n{'#'*80}")
    print(f"PHASE 3: GENERATING COMPARISON REPORT")
    print(f"{'#'*80}\n")

    results = load_motion_analysis_results(args.output)

    if len(results) == 0:
        print("ERROR: No motion analysis results found")
        return 1

    print(f"Loaded {len(results)} motion analysis results")

    report_file = os.path.join(args.output, "BATCH_MOTION_ANALYSIS_COMPARISON.md")
    generate_comparison_report(results, report_file)

    print(f"\n{'='*80}")
    print(f"BATCH PROCESSING COMPLETE!")
    print(f"{'='*80}")
    print(f"Results directory: {args.output}")
    print(f"Comparison report: {report_file}")
    print(f"{'='*80}\n")

    return 0

if __name__ == "__main__":
    sys.exit(main())
