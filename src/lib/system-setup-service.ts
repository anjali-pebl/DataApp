/**
 * System Setup Service
 * Handles initial system configuration and directory setup for new users
 */

import { promises as fs } from 'fs';
import path from 'path';

export interface SystemRequirement {
  name: string;
  description: string;
  type: 'directory' | 'file' | 'dependency' | 'config';
  path?: string;
  required: boolean;
  status: 'pending' | 'checking' | 'ok' | 'error';
  error?: string;
  autoFixable: boolean;
}

export interface SystemSetupStatus {
  isSetupComplete: boolean;
  requirements: SystemRequirement[];
  errors: string[];
  warnings: string[];
}

// Define all system requirements
const SYSTEM_REQUIREMENTS: Omit<SystemRequirement, 'status'>[] = [
  {
    name: 'Videos Directory',
    description: 'Directory for storing uploaded video files',
    type: 'directory',
    path: 'public/videos',
    required: true,
    autoFixable: true,
  },
  {
    name: 'Motion Analysis Results Directory',
    description: 'Directory for storing motion analysis output files',
    type: 'directory',
    path: 'public/motion-analysis-results',
    required: true,
    autoFixable: true,
  },
  {
    name: 'Temp Directory',
    description: 'Temporary directory for file processing',
    type: 'directory',
    path: 'public/temp',
    required: true,
    autoFixable: true,
  },
  {
    name: 'Python Environment',
    description: 'Python installation for video processing scripts',
    type: 'dependency',
    required: true,
    autoFixable: false,
  },
  {
    name: 'FFmpeg',
    description: 'FFmpeg for video metadata extraction',
    type: 'dependency',
    required: false, // Optional - has fallback to OpenCV
    autoFixable: false,
  },
  {
    name: 'CV Scripts Directory',
    description: 'Computer vision processing scripts',
    type: 'directory',
    path: 'cv_scripts',
    required: true,
    autoFixable: false,
  },
  {
    name: 'YOLO Model (Trained)',
    description: 'Trained YOLOv8 model for underwater organism detection',
    type: 'file',
    path: 'Labeled_Datasets/05_Models/Y12_11kL_12k(brackish)_E100_Augmented_best.pt',
    required: false, // Optional - can use pre-trained YOLO models
    autoFixable: false,
  },
  {
    name: 'Python Dependencies',
    description: 'Required Python packages (OpenCV, YOLO, NumPy, etc.)',
    type: 'dependency',
    required: true,
    autoFixable: false,
  },
];

/**
 * Check all system requirements
 */
export async function checkSystemRequirements(): Promise<SystemSetupStatus> {
  const requirements: SystemRequirement[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const req of SYSTEM_REQUIREMENTS) {
    const requirement: SystemRequirement = {
      ...req,
      status: 'checking',
    };

    try {
      if (req.type === 'directory' && req.path) {
        const fullPath = path.join(process.cwd(), req.path);
        try {
          await fs.access(fullPath);
          requirement.status = 'ok';
        } catch {
          requirement.status = 'error';
          requirement.error = `Directory does not exist: ${req.path}`;

          if (req.required) {
            errors.push(`Missing required directory: ${req.name}`);
          } else {
            warnings.push(`Missing optional directory: ${req.name}`);
          }
        }
      } else if (req.type === 'file' && req.path) {
        const fullPath = path.join(process.cwd(), req.path);
        try {
          await fs.access(fullPath);
          requirement.status = 'ok';
        } catch {
          requirement.status = 'error';
          requirement.error = `File does not exist: ${req.path}`;

          if (req.required) {
            errors.push(`Missing required file: ${req.name}`);
          } else {
            warnings.push(`Missing optional file: ${req.name}`);
          }
        }
      } else if (req.type === 'dependency') {
        // Check dependencies via which/where command
        const checkResult = await checkDependency(req.name);
        if (checkResult.exists) {
          requirement.status = 'ok';
        } else {
          requirement.status = 'error';
          requirement.error = checkResult.error;

          if (req.required) {
            errors.push(`Missing required dependency: ${req.name}`);
          } else {
            warnings.push(`Missing optional dependency: ${req.name}`);
          }
        }
      }
    } catch (err: any) {
      requirement.status = 'error';
      requirement.error = err.message;
      errors.push(`Error checking ${req.name}: ${err.message}`);
    }

    requirements.push(requirement);
  }

  const isSetupComplete = errors.length === 0;

  return {
    isSetupComplete,
    requirements,
    errors,
    warnings,
  };
}

/**
 * Automatically fix auto-fixable requirements
 */
export async function autoFixRequirements(
  requirements: SystemRequirement[]
): Promise<{ success: boolean; fixed: string[]; failed: string[] }> {
  const fixed: string[] = [];
  const failed: string[] = [];

  for (const req of requirements) {
    if (req.status === 'error' && req.autoFixable) {
      try {
        if (req.type === 'directory' && req.path) {
          const fullPath = path.join(process.cwd(), req.path);
          await fs.mkdir(fullPath, { recursive: true });
          fixed.push(req.name);
          console.log(`✓ Created directory: ${req.path}`);
        }
      } catch (err: any) {
        failed.push(req.name);
        console.error(`✗ Failed to fix ${req.name}:`, err.message);
      }
    }
  }

  return {
    success: failed.length === 0,
    fixed,
    failed,
  };
}

/**
 * Check if a dependency is installed
 */
async function checkDependency(
  name: string
): Promise<{ exists: boolean; error?: string }> {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'where' : 'which';

  const commandMap: Record<string, string> = {
    'Python Environment': 'python',
    'FFmpeg': 'ffmpeg',
    'OpenCV': 'python',
  };

  // Special handling for Python Dependencies - check if packages are importable
  if (name === 'Python Dependencies') {
    try {
      // Try importing key packages
      await execAsync('python -c "import cv2, ultralytics, numpy, requests"');
      return { exists: true };
    } catch {
      return {
        exists: false,
        error: 'Required Python packages not installed (cv2, ultralytics, numpy, requests)',
      };
    }
  }

  const checkCommand = commandMap[name] || name.toLowerCase();

  try {
    await execAsync(`${command} ${checkCommand}`);
    return { exists: true };
  } catch {
    return {
      exists: false,
      error: `${name} is not installed or not in PATH`,
    };
  }
}

/**
 * Get setup instructions for manual fixes
 */
export function getSetupInstructions(requirement: SystemRequirement): string {
  const instructions: Record<string, string> = {
    'Python Environment': `
Please install Python 3.8 or later:
1. Download from https://www.python.org/downloads/
2. Run the installer
3. Check "Add Python to PATH" during installation
4. Restart your terminal/computer after installation
5. Verify by running: python --version
    `,
    'FFmpeg': `
FFmpeg is optional but recommended for better video processing:
1. Windows: Download from https://ffmpeg.org/download.html
   - Or use: winget install ffmpeg
2. Mac: brew install ffmpeg
3. Linux: sudo apt install ffmpeg
4. Verify by running: ffmpeg -version
    `,
    'CV Scripts Directory': `
The cv_scripts directory contains Python processing scripts.
This should be part of the codebase. Please ensure:
1. You have cloned the complete repository
2. The cv_scripts folder exists in the project root
3. Contact your administrator if this directory is missing
    `,
    'YOLO Model (Trained)': `
The trained YOLO model is optional - you can use pre-trained models instead.
To use the custom underwater organism detection model:
1. Contact your administrator to obtain the trained model file
2. Place it in: Labeled_Datasets/05_Models/
3. Filename should be: Y12_11kL_12k(brackish)_E100_Augmented_best.pt

Alternatively, you can use a pre-trained YOLO model (yolov8n, yolov8m, yolov8l)
which will be automatically downloaded when first used.
    `,
    'Python Dependencies': `
Install required Python packages:
1. Navigate to the project directory in terminal
2. Run: pip install -r requirements.txt
   OR manually install: pip install opencv-python ultralytics numpy requests
3. Verify installations:
   - python -c "import cv2; print(cv2.__version__)"
   - python -c "import ultralytics; print(ultralytics.__version__)"
4. If you encounter errors, try:
   - pip install --upgrade pip
   - pip install --force-reinstall <package-name>
    `,
  };

  return instructions[requirement.name] || 'No specific instructions available.';
}
