/**
 * Local Processing Dependency Checker - Server Side
 * Server-only functions that use Node.js APIs (child_process)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { ProcessingDependency, ProcessingCheckResult } from './local-processing-checker-types';

const execAsync = promisify(exec);

// Define all required dependencies for local processing
const PROCESSING_DEPENDENCIES: Omit<ProcessingDependency, 'status'>[] = [
  {
    name: 'Python 3.8+',
    description: 'Python runtime for video processing scripts',
    type: 'system-binary',
    checkCommand: 'python --version',
    required: true,
    autoFixable: false,
  },
  {
    name: 'OpenCV (cv2)',
    description: 'Computer vision library for video processing',
    type: 'python-package',
    checkCommand: 'python -c "import cv2; print(cv2.__version__)"',
    installCommand: 'pip install opencv-python',
    required: true,
    autoFixable: true,
  },
  {
    name: 'NumPy',
    description: 'Numerical computing library',
    type: 'python-package',
    checkCommand: 'python -c "import numpy; print(numpy.__version__)"',
    installCommand: 'pip install numpy',
    required: true,
    autoFixable: true,
  },
  {
    name: 'Ultralytics (YOLO)',
    description: 'YOLO object detection library',
    type: 'python-package',
    checkCommand: 'python -c "import ultralytics; print(ultralytics.__version__)"',
    installCommand: 'pip install ultralytics',
    required: true,
    autoFixable: true,
  },
  {
    name: 'PyTorch',
    description: 'Deep learning framework for YOLO',
    type: 'python-package',
    checkCommand: 'python -c "import torch; print(torch.__version__)"',
    installCommand: 'pip install torch torchvision',
    required: true,
    autoFixable: true,
  },
  {
    name: 'SciPy',
    description: 'Scientific computing library for motion analysis',
    type: 'python-package',
    checkCommand: 'python -c "import scipy; print(scipy.__version__)"',
    installCommand: 'pip install scipy',
    required: true,
    autoFixable: true,
  },
  {
    name: 'FFmpeg',
    description: 'Video codec handling (recommended)',
    type: 'system-binary',
    checkCommand: 'ffmpeg -version',
    required: false,
    autoFixable: false,
  },
];

/**
 * Check all dependencies required for local processing
 */
export async function checkProcessingDependencies(): Promise<ProcessingCheckResult> {
  const dependencies: ProcessingDependency[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  for (const dep of PROCESSING_DEPENDENCIES) {
    const dependency: ProcessingDependency = {
      ...dep,
      status: 'checking',
    };

    if (dep.checkCommand) {
      try {
        const { stdout, stderr } = await execAsync(dep.checkCommand, {
          timeout: 10000,
        });

        const output = stdout.trim();
        dependency.status = 'ok';

        // Extract version from output
        const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
        if (versionMatch) {
          dependency.version = versionMatch[1];
        }
      } catch (err: any) {
        dependency.status = 'error';
        dependency.error = `Not found or not in PATH`;

        if (dep.required) {
          errors.push(`Missing required dependency: ${dep.name}`);

          if (dep.autoFixable && dep.installCommand) {
            suggestions.push(`Install ${dep.name}: ${dep.installCommand}`);
          } else {
            suggestions.push(`Please install ${dep.name} manually`);
          }
        } else {
          warnings.push(`Optional dependency missing: ${dep.name}`);
          dependency.status = 'warning';
        }
      }
    }

    dependencies.push(dependency);
  }

  const canProcess = errors.length === 0;

  return {
    canProcess,
    dependencies,
    errors,
    warnings,
    suggestions,
  };
}

/**
 * Auto-install missing Python packages
 */
export async function autoInstallPackages(
  dependencies: ProcessingDependency[]
): Promise<{ success: boolean; installed: string[]; failed: string[] }> {
  const installed: string[] = [];
  const failed: string[] = [];

  // Filter to only auto-fixable dependencies that have errors
  const toInstall = dependencies.filter(
    (dep) => dep.status === 'error' && dep.autoFixable && dep.installCommand
  );

  for (const dep of toInstall) {
    if (!dep.installCommand) continue;

    try {
      console.log(`Installing ${dep.name}...`);
      await execAsync(dep.installCommand, { timeout: 120000 }); // 2 minute timeout
      installed.push(dep.name);
      console.log(`✓ Installed ${dep.name}`);
    } catch (err: any) {
      failed.push(dep.name);
      console.error(`✗ Failed to install ${dep.name}:`, err.message);
    }
  }

  return {
    success: failed.length === 0,
    installed,
    failed,
  };
}

/**
 * Quick check if processing is possible (ultra-lightweight, <100ms)
 * This is a fast pre-check before showing the preflight dialog
 */
export async function canProcessLocally(): Promise<boolean> {
  try {
    // Just check if Python and OpenCV are available
    await execAsync('python -c "import cv2"', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
