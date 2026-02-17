#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Heartbeat Module for Crash-Resilient Processing
================================================

This module provides a background heartbeat system that periodically
notifies the API server that the Python process is still alive.

If the process crashes or is killed, the server will detect the absence
of heartbeats and mark the processing run as 'paused' for later resume.

Usage:
    from heartbeat import Heartbeat

    heartbeat = Heartbeat(api_url, run_id, interval_seconds=10)
    heartbeat.start()

    try:
        # ... your processing code ...
    finally:
        heartbeat.stop()
"""

import requests
import threading
import time
from typing import Optional


class Heartbeat:
    """
    Background heartbeat sender that runs in a separate thread.

    Sends periodic HTTP POST requests to the API server to signal
    that the Python process is still alive and processing.

    Attributes:
        api_url: Base URL of the API server (e.g., 'http://localhost:9002')
        run_id: Processing run ID to send heartbeats for
        interval: Seconds between heartbeat sends (default: 10)
    """

    def __init__(self, api_url: str, run_id: str, interval_seconds: int = 10):
        """
        Initialize the heartbeat system.

        Args:
            api_url: Base URL of the API (e.g., 'http://localhost:9002')
            run_id: Processing run ID (UUID string)
            interval_seconds: How often to send heartbeats (default: 10s)
        """
        self.api_url = api_url.rstrip('/')  # Remove trailing slash
        self.run_id = run_id
        self.interval = interval_seconds
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.last_success_time: Optional[float] = None
        self.consecutive_failures = 0

    def start(self) -> None:
        """
        Start the heartbeat thread.

        Creates and starts a daemon thread that will send heartbeats
        in the background until stop() is called.
        """
        if self.running:
            print("[HEARTBEAT] ⚠️  Already running, ignoring start()")
            return

        self.running = True
        self.thread = threading.Thread(
            target=self._heartbeat_loop,
            daemon=True,  # Daemon thread will exit when main program exits
            name=f"Heartbeat-{self.run_id[:8]}"
        )
        self.thread.start()
        print(f"[HEARTBEAT] ✓ Started (interval: {self.interval}s, run: {self.run_id[:8]}...)")

    def stop(self) -> None:
        """
        Stop the heartbeat thread gracefully.

        Signals the thread to stop and waits for it to finish.
        """
        if not self.running:
            return

        self.running = False
        print("[HEARTBEAT] Stopping...")

        # Wait for thread to finish (max 5 seconds)
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=5.0)

        print("[HEARTBEAT] ✓ Stopped")

    def _heartbeat_loop(self) -> None:
        """
        Main loop that runs in the background thread.

        Sends heartbeat requests at regular intervals until stopped.
        """
        while self.running:
            try:
                self._send_heartbeat()
            except Exception as e:
                # Log error but don't crash - heartbeat is best-effort
                self._handle_failure(e)

            # Sleep for interval, but check self.running periodically
            # so we can exit quickly when stop() is called
            sleep_remaining = self.interval
            while sleep_remaining > 0 and self.running:
                sleep_time = min(1.0, sleep_remaining)  # Check every 1 second
                time.sleep(sleep_time)
                sleep_remaining -= sleep_time

    def _send_heartbeat(self) -> None:
        """
        Send a single heartbeat request to the API.

        Raises:
            Exception: If the request fails
        """
        endpoint = f"{self.api_url}/api/motion-analysis/process/heartbeat"

        try:
            response = requests.post(
                endpoint,
                json={"runId": self.run_id},
                timeout=5  # 5 second timeout
            )

            if response.status_code == 200:
                # Success - reset failure counter
                now = time.time()
                if self.consecutive_failures > 0:
                    print(f"[HEARTBEAT] ✓ Recovered after {self.consecutive_failures} failures")
                self.consecutive_failures = 0
                self.last_success_time = now
            else:
                # Non-200 response
                raise Exception(f"HTTP {response.status_code}: {response.text[:100]}")

        except requests.exceptions.Timeout:
            raise Exception("Request timed out after 5s")
        except requests.exceptions.ConnectionError:
            raise Exception("Connection refused - is the server running?")
        except requests.exceptions.RequestException as e:
            raise Exception(f"Request failed: {e}")

    def _handle_failure(self, error: Exception) -> None:
        """
        Handle heartbeat failure.

        Args:
            error: The exception that caused the failure
        """
        self.consecutive_failures += 1

        # Only log every 5 failures to avoid log spam
        if self.consecutive_failures == 1 or self.consecutive_failures % 5 == 0:
            print(f"[HEARTBEAT] ❌ Failed ({self.consecutive_failures}x): {error}")

        # If we've had many consecutive failures, warn user
        if self.consecutive_failures == 10:
            print("[HEARTBEAT] ⚠️  WARNING: 10 consecutive failures - server may be down!")
            print("[HEARTBEAT] ⚠️  Processing will continue, but crash recovery may not work.")

    def get_status(self) -> dict:
        """
        Get current heartbeat status.

        Returns:
            Dictionary with status information:
            - running: Whether heartbeat is active
            - last_success: Timestamp of last successful heartbeat
            - consecutive_failures: Number of recent failures
        """
        return {
            "running": self.running,
            "last_success": self.last_success_time,
            "consecutive_failures": self.consecutive_failures,
        }


# Convenience function for simple use cases
def start_heartbeat(api_url: str, run_id: str, interval_seconds: int = 10) -> Heartbeat:
    """
    Create and start a heartbeat in one step.

    Args:
        api_url: Base URL of the API
        run_id: Processing run ID
        interval_seconds: Heartbeat interval (default: 10s)

    Returns:
        Started Heartbeat instance (call .stop() when done)

    Example:
        heartbeat = start_heartbeat('http://localhost:9002', run_id)
        try:
            # ... process videos ...
        finally:
            heartbeat.stop()
    """
    heartbeat = Heartbeat(api_url, run_id, interval_seconds)
    heartbeat.start()
    return heartbeat


if __name__ == "__main__":
    # Simple test
    import sys

    if len(sys.argv) < 3:
        print("Usage: python heartbeat.py <api_url> <run_id> [interval]")
        print("Example: python heartbeat.py http://localhost:9002 abc123-def456 10")
        sys.exit(1)

    api_url = sys.argv[1]
    run_id = sys.argv[2]
    interval = int(sys.argv[3]) if len(sys.argv) > 3 else 10

    print(f"Testing heartbeat:")
    print(f"  API: {api_url}")
    print(f"  Run ID: {run_id}")
    print(f"  Interval: {interval}s")
    print(f"\nPress Ctrl+C to stop...\n")

    heartbeat = start_heartbeat(api_url, run_id, interval)

    try:
        # Keep main thread alive
        while True:
            time.sleep(1)
            status = heartbeat.get_status()
            if status["consecutive_failures"] > 0:
                print(f"Status: {status}")
    except KeyboardInterrupt:
        print("\n\nStopping...")
        heartbeat.stop()
        print("Done!")
