#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
User-Friendly Logging Utilities
================================

Provides clean, easy-to-follow logging for video processing scripts.
Supports multiple verbosity levels and progress tracking.
"""

import sys
import io
import os
from datetime import datetime
from typing import Optional

# Fix Windows encoding issues - set environment variable for UTF-8
if sys.platform == 'win32':
    # Set console code page to UTF-8 before any print operations
    os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
    # Reconfigure stdout/stderr if needed (but preserve existing streams)
    if hasattr(sys.stdout, 'reconfigure'):
        try:
            sys.stdout.reconfigure(encoding='utf-8', errors='replace')
            sys.stderr.reconfigure(encoding='utf-8', errors='replace')
        except (AttributeError, ValueError):
            pass  # If reconfigure fails, continue with default encoding

# Verbosity levels
VERBOSITY_MINIMAL = 0   # Only show progress and results
VERBOSITY_NORMAL = 1    # Show progress, results, and key info (default)
VERBOSITY_DETAILED = 2  # Show all technical details

# Global verbosity setting
_verbosity = VERBOSITY_NORMAL

def set_verbosity(level: int):
    """Set global verbosity level"""
    global _verbosity
    _verbosity = level

def get_verbosity() -> int:
    """Get current verbosity level"""
    return _verbosity

# Status symbols (with ASCII fallback for Windows)
if sys.platform == 'win32' and not os.environ.get('PYTHONIOENCODING', '').lower().startswith('utf'):
    STATUS_SUCCESS = "[OK]"
    STATUS_ERROR = "[X]"
    STATUS_WARNING = "[!]"
    STATUS_INFO = "*"
else:
    STATUS_SUCCESS = "✓"
    STATUS_ERROR = "✗"
    STATUS_WARNING = "⚠"
    STATUS_INFO = "•"

# Box drawing characters (with ASCII fallback)
def _test_unicode_support():
    """Test if stdout supports Unicode box-drawing characters"""
    # On Windows, be conservative - only use Unicode if explicitly enabled
    if sys.platform == 'win32':
        # Check if UTF-8 mode is enabled
        if os.environ.get('PYTHONIOENCODING', '').lower().startswith('utf'):
            return True
        # Otherwise use ASCII to be safe
        return False

    # On Unix-like systems, test encoding support
    try:
        test_chars = "┌─┐│└┘╔═╗║╚╝█░✓✗⚠•"
        # Try to encode test characters with stdout encoding
        test_chars.encode(sys.stdout.encoding or 'utf-8')
        return True
    except (UnicodeEncodeError, AttributeError, LookupError):
        return False

# Use Unicode if supported, otherwise ASCII fallback
if _test_unicode_support():
    BOX_TL = "┌"
    BOX_TR = "┐"
    BOX_BL = "└"
    BOX_BR = "┘"
    BOX_H = "─"
    BOX_V = "│"
    BOX_DOUBLE_TL = "╔"
    BOX_DOUBLE_TR = "╗"
    BOX_DOUBLE_BL = "╚"
    BOX_DOUBLE_BR = "╝"
    BOX_DOUBLE_H = "═"
    BOX_DOUBLE_V = "║"
    PROGRESS_FILLED = "█"
    PROGRESS_EMPTY = "░"
else:
    # ASCII fallback for terminals without Unicode support
    BOX_TL = "+"
    BOX_TR = "+"
    BOX_BL = "+"
    BOX_BR = "+"
    BOX_H = "-"
    BOX_V = "|"
    BOX_DOUBLE_TL = "+"
    BOX_DOUBLE_TR = "+"
    BOX_DOUBLE_BL = "+"
    BOX_DOUBLE_BR = "+"
    BOX_DOUBLE_H = "="
    BOX_DOUBLE_V = "|"
    PROGRESS_FILLED = "#"
    PROGRESS_EMPTY = "-"


def print_header(title: str, width: int = 65, double: bool = False):
    """
    Print a clean section header.

    Args:
        title: Header text
        width: Total width of the box
        double: Use double-line box for emphasis
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        return

    if double:
        tl, tr, bl, br, h, v = BOX_DOUBLE_TL, BOX_DOUBLE_TR, BOX_DOUBLE_BL, BOX_DOUBLE_BR, BOX_DOUBLE_H, BOX_DOUBLE_V
    else:
        tl, tr, bl, br, h, v = BOX_TL, BOX_TR, BOX_BL, BOX_BR, BOX_H, BOX_V

    print(f"{tl}{h * (width - 2)}{tr}")
    print(f"{v} {title:<{width - 3}}{v}")
    print(f"{bl}{h * (width - 2)}{br}")


def print_box_line(text: str, width: int = 65, double: bool = False):
    """
    Print a line inside a box.

    Args:
        text: Text to print
        width: Total width of the box
        double: Use double-line box
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        return

    v = BOX_DOUBLE_V if double else BOX_V
    print(f"{v} {text:<{width - 3}}{v}")


def print_box_top(width: int = 65, double: bool = False):
    """Print top of a box"""
    if get_verbosity() == VERBOSITY_MINIMAL:
        return

    if double:
        print(f"{BOX_DOUBLE_TL}{BOX_DOUBLE_H * (width - 2)}{BOX_DOUBLE_TR}")
    else:
        print(f"{BOX_TL}{BOX_H * (width - 2)}{BOX_TR}")


def print_box_bottom(width: int = 65, double: bool = False):
    """Print bottom of a box"""
    if get_verbosity() == VERBOSITY_MINIMAL:
        return

    if double:
        print(f"{BOX_DOUBLE_BL}{BOX_DOUBLE_H * (width - 2)}{BOX_DOUBLE_BR}")
    else:
        print(f"{BOX_BL}{BOX_H * (width - 2)}{BOX_BR}")


def print_progress_bar(current: int, total: int, width: int = 50):
    """
    Print a text-based progress bar.

    Args:
        current: Current progress
        total: Total items
        width: Width of the progress bar in characters
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        return

    if total == 0:
        return

    filled = int(width * current / total)
    bar = PROGRESS_FILLED * filled + PROGRESS_EMPTY * (width - filled)
    percent = int(100 * current / total)
    v = BOX_V
    print(f"{v} {bar} {percent:>3}%")


def print_step_start(step_num: int, total_steps: int, description: str, width: int = 65):
    """
    Print the start of a processing step.

    Args:
        step_num: Current step number
        total_steps: Total number of steps
        description: Description of the step
        width: Width of the box
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        print(f"  Step {step_num}/{total_steps}: {description}...", end=" ", flush=True)
    else:
        print_box_top(width)
        print_box_line(f"Step {step_num}/{total_steps}: {description}", width)


def print_step_complete(time_seconds: float, width: int = 65):
    """
    Print step completion.

    Args:
        time_seconds: Time taken for the step
        width: Width of the box
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        print(f"{STATUS_SUCCESS} ({time_seconds:.0f}s)")
    else:
        print_box_line(f"{STATUS_SUCCESS} Complete ({time_seconds:.0f}s)", width)
        print_box_bottom(width)
        print()


def print_step_error(error_msg: str, width: int = 65):
    """
    Print step error.

    Args:
        error_msg: Error message
        width: Width of the box
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        print(f"{STATUS_ERROR} Failed")
        print(f"  Error: {error_msg}")
    else:
        print_box_line(f"{STATUS_ERROR} Failed: {error_msg}", width)
        print_box_bottom(width)
        print()


def print_result_success(message: str, details: Optional[list] = None, width: int = 65):
    """
    Print a success result.

    Args:
        message: Main success message
        details: Optional list of detail lines
        width: Width of the box
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        print(f"  {STATUS_SUCCESS} {message}")
    else:
        print_box_line(f"{STATUS_SUCCESS} {message}", width)
        if details:
            for detail in details:
                print_box_line(f"{STATUS_SUCCESS} {detail}", width)


def print_result_info(message: str, width: int = 65):
    """
    Print an info result.

    Args:
        message: Info message
        width: Width of the box
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        return

    print_box_line(f"{STATUS_INFO} {message}", width)


def print_result_warning(message: str, width: int = 65):
    """
    Print a warning result.

    Args:
        message: Warning message
        width: Width of the box
    """
    if get_verbosity() <= VERBOSITY_NORMAL:
        return  # Only show warnings in detailed mode

    print_box_line(f"{STATUS_WARNING} {message}", width)


def print_result_error(message: str, width: int = 65):
    """
    Print an error result.

    Args:
        message: Error message
        width: Width of the box
    """
    print_box_line(f"{STATUS_ERROR} {message}", width)


def print_video_header(video_num: int, total_videos: int, filename: str, width: int = 65):
    """
    Print video processing header.

    Args:
        video_num: Current video number
        total_videos: Total number of videos
        filename: Video filename
        width: Width of the box
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        print(f"[{video_num}/{total_videos}] {filename}", end=" ")
    else:
        print()
        print(f"[Video {video_num}/{total_videos}] {filename}")


def print_batch_header(total_videos: int, run_id: Optional[str] = None, width: int = 65):
    """
    Print batch processing header.

    Args:
        total_videos: Total number of videos to process
        run_id: Optional run ID
        width: Width of the box
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        print(f"Processing {total_videos} videos...")
    else:
        print_box_top(width)
        if run_id:
            print_box_line(f"Video Processing - Run {run_id[:8]}", width)
        else:
            print_box_line(f"Video Processing", width)
        print_box_line(f"Processing {total_videos} video(s)", width)
        print_box_bottom(width)
        print()


def print_batch_summary(
    total_videos: int,
    successful: int,
    total_time_seconds: float,
    total_organisms: int = 0,
    width: int = 65
):
    """
    Print batch processing summary.

    Args:
        total_videos: Total videos processed
        successful: Number of successful videos
        total_time_seconds: Total processing time
        total_organisms: Total organisms detected
        width: Width of the box
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        print(f"Complete: {successful}/{total_videos} videos, {total_organisms} organisms found")
        return

    print()
    print_box_top(width, double=True)
    print_box_line("PROCESSING COMPLETE", width, double=True)
    print_box_bottom(width, double=True)
    print()
    print("SUMMARY:")

    # Format time
    if total_time_seconds < 60:
        time_str = f"{total_time_seconds:.0f}s"
    else:
        mins = int(total_time_seconds / 60)
        secs = int(total_time_seconds % 60)
        time_str = f"{mins}m {secs}s"

    print(f"{STATUS_INFO} Videos processed: {successful}/{total_videos} {STATUS_SUCCESS}")
    print(f"{STATUS_INFO} Total time: {time_str}")
    print(f"{STATUS_INFO} Organisms found: {total_organisms}")

    if successful == total_videos:
        print(f"{STATUS_INFO} Success rate: 100%")
    else:
        rate = int(100 * successful / total_videos)
        print(f"{STATUS_INFO} Success rate: {rate}%")


def print_organisms_result(count: int, width: int = 65):
    """
    Print organism detection result.

    Args:
        count: Number of organisms detected
        width: Width of the box
    """
    if get_verbosity() == VERBOSITY_MINIMAL:
        return  # Will be included in summary

    print_box_line("", width)
    print_box_line("RESULTS:", width)
    if count == 0:
        print_box_line(f"{STATUS_ERROR} No organisms detected in this video", width)
    elif count == 1:
        print_box_line(f"{STATUS_SUCCESS} 1 organism detected!", width)
    else:
        print_box_line(f"{STATUS_SUCCESS} {count} organisms detected!", width)
    print_box_line("", width)


def print_technical_details(details: dict, width: int = 65):
    """
    Print technical details (only in detailed mode).

    Args:
        details: Dictionary of technical details
        width: Width of the box
    """
    if get_verbosity() < VERBOSITY_DETAILED:
        return

    print_box_line("", width)
    print_box_line("Technical Details:", width)
    for key, value in details.items():
        print_box_line(f"  {key}: {value}", width)


def format_time(seconds: float) -> str:
    """
    Format seconds into human-readable time.

    Args:
        seconds: Time in seconds

    Returns:
        Formatted time string
    """
    if seconds < 60:
        return f"{seconds:.0f}s"
    elif seconds < 3600:
        mins = int(seconds / 60)
        secs = int(seconds % 60)
        return f"{mins}m {secs}s"
    else:
        hours = int(seconds / 3600)
        mins = int((seconds % 3600) / 60)
        return f"{hours}h {mins}m"


def print_output_location(path: str):
    """
    Print output file location.

    Args:
        path: Output directory path
    """
    if get_verbosity() >= VERBOSITY_NORMAL:
        print()
        print("OUTPUT LOCATION:")
        print(f"{path}")
        print()


# Minimal mode convenience functions
def print_minimal_progress(current: int, total: int, filename: str, time_seconds: float, organisms: int):
    """
    Print minimal progress line.

    Args:
        current: Current item number
        total: Total items
        filename: Filename being processed
        time_seconds: Time taken
        organisms: Organisms detected
    """
    if get_verbosity() != VERBOSITY_MINIMAL:
        return

    print(f"[{current}/{total}] {filename} {STATUS_SUCCESS} ({time_seconds:.0f}s, {organisms} organisms)")


# Simple test when run as main module
if __name__ == "__main__":
    print("\nTesting logging_utils.py on Windows...")
    print(f"Platform: {sys.platform}")
    print(f"PYTHONIOENCODING: {os.environ.get('PYTHONIOENCODING', 'not set')}")
    print(f"stdout encoding: {sys.stdout.encoding}")
    print(f"Unicode support: {_test_unicode_support()}")
    print(f"\nStatus symbols: {STATUS_SUCCESS} {STATUS_ERROR} {STATUS_WARNING} {STATUS_INFO}")
    print(f"Box chars: {BOX_TL}{BOX_H * 10}{BOX_TR}")
    print(f"           {BOX_V}{' ' * 10}{BOX_V}")
    print(f"           {BOX_BL}{BOX_H * 10}{BOX_BR}")
    print("\nTesting batch header:")
    print_batch_header(2, "test-run-123")
    print("\nAll tests passed!")
