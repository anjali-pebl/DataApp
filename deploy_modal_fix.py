#!/usr/bin/env python
"""
Deploy Modal processing code with encoding fix
Usage: python deploy_modal_fix.py
"""
import os
import sys
import subprocess

# Set UTF-8 encoding for stdout/stderr
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.detach())
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.detach())

# Set environment variables
os.environ['PYTHONIOENCODING'] = 'utf-8'
os.environ['PYTHONUTF8'] = '1'

print("Deploying updated Modal processing code...")
print("This will enable Modal to return video bytes (faster processing)")
print("")

try:
    result = subprocess.run(
        ['modal', 'deploy', 'cv_scripts/modal_processing.py'],
        capture_output=False,
        text=True,
        encoding='utf-8',
        errors='replace'  # Replace problematic characters
    )

    if result.returncode == 0:
        print("\nDeployment successful!")
        print("Next video processing will use optimized Modal pipeline")
    else:
        print(f"\nDeployment failed with code {result.returncode}")
        print("Fallback local generation will continue to work")

except Exception as e:
    print(f"\nError during deployment: {e}")
    print("Fallback local generation will continue to work")
