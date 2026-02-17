import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export interface VideoValidationResult {
  videoFilename: string;
  originalFilename: string;
  checks: {
    originalVideo: ValidationCheck;
    motionVideo: ValidationCheck;
    yolov8Video: ValidationCheck;
    motionJson: ValidationCheck;
    yolov8Json: ValidationCheck;
  };
  allPassed: boolean;
  canProceed: boolean;  // Can open modal even with some failures
  summary: string;
}

export interface ValidationCheck {
  name: string;
  status: 'passed' | 'failed' | 'warning';
  exists: boolean;
  path: string;
  message: string;
  canRegenerate: boolean;
  regenerateAction?: 'reprocess_motion' | 'run_yolov8' | 'download';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { videoFilename } = body;

    if (!videoFilename) {
      return NextResponse.json(
        { error: 'videoFilename is required' },
        { status: 400 }
      );
    }

    // Derive filenames
    const originalFilename = videoFilename.replace('_background_subtracted.mp4', '.mp4');
    const baseName = originalFilename.replace('.mp4', '');
    const motionFilename = `${baseName}_background_subtracted.mp4`;
    const yolov8Filename = `${baseName}_yolov8.mp4`;
    const yolov8JsonFilename = `${baseName}_yolov8.json`;

    // Define paths
    const videosDir = path.join(process.cwd(), 'public', 'videos');
    const resultsDir = path.join(process.cwd(), 'public', 'motion-analysis-results');
    const resultsSubDir = path.join(resultsDir, baseName); // New: subdirectory structure

    const originalPath = path.join(videosDir, originalFilename);
    const yolov8Path = path.join(videosDir, yolov8Filename);
    const yolov8JsonPath = path.join(resultsDir, yolov8JsonFilename);

    // Motion files can be in multiple locations - check both old and new structure
    // Old structure: videos/{name}_background_subtracted.mp4
    // New structure: motion-analysis-results/{baseName}/{name}_background_subtracted.mp4
    const motionPathOld = path.join(videosDir, motionFilename);
    const motionPathNew = path.join(resultsSubDir, motionFilename);
    const motionPath = fs.existsSync(motionPathNew) ? motionPathNew : motionPathOld;

    // Motion JSON can have multiple naming patterns and locations
    // Old pattern: {name}_analysis.json or {name}_background_subtracted_motion_analysis.json
    // New pattern in subdirectory: {name}_motion_analysis.json
    const motionJsonPaths = [
      path.join(resultsSubDir, `${baseName}_motion_analysis.json`),
      path.join(resultsSubDir, `${baseName}_background_subtracted_motion_analysis.json`),
      path.join(resultsDir, `${baseName}_analysis.json`),
      path.join(resultsDir, `${baseName}_background_subtracted_motion_analysis.json`),
    ];
    const motionJsonPath = motionJsonPaths.find(p => fs.existsSync(p)) || motionJsonPaths[0];

    // Check each file
    const checks: VideoValidationResult['checks'] = {
      originalVideo: checkFile(originalPath, 'Original Video', originalFilename, false),
      motionVideo: checkFile(motionPath, 'Motion Analysis Video', motionFilename, true, 'reprocess_motion'),
      yolov8Video: checkFile(yolov8Path, 'YOLOv8 Detection Video', yolov8Filename, true, 'run_yolov8'),
      motionJson: checkFile(motionJsonPath, 'Motion Analysis Data', path.basename(motionJsonPath), true, 'reprocess_motion'),
      yolov8Json: checkFile(yolov8JsonPath, 'YOLOv8 Detection Data', yolov8JsonFilename, true, 'run_yolov8'),
    };

    // Validate JSON contents if they exist
    if (checks.motionJson.exists) {
      const jsonValid = validateJsonFile(motionJsonPath);
      if (!jsonValid) {
        checks.motionJson.status = 'warning';
        checks.motionJson.message = 'JSON file exists but may be corrupted';
      }
    }

    if (checks.yolov8Json.exists) {
      const jsonValid = validateJsonFile(yolov8JsonPath);
      if (!jsonValid) {
        checks.yolov8Json.status = 'warning';
        checks.yolov8Json.message = 'JSON file exists but may be corrupted';
      }
    }

    // Determine overall status
    const allPassed = Object.values(checks).every(c => c.status === 'passed');

    // Can proceed if at least original video and motion video exist
    const canProceed = checks.originalVideo.exists && checks.motionVideo.exists;

    // Build summary
    const failedCount = Object.values(checks).filter(c => c.status === 'failed').length;
    const warningCount = Object.values(checks).filter(c => c.status === 'warning').length;

    let summary = '';
    if (allPassed) {
      summary = 'All files ready';
    } else if (canProceed) {
      summary = `Ready with ${failedCount} missing files`;
    } else {
      summary = 'Cannot open - required files missing';
    }

    const result: VideoValidationResult = {
      videoFilename,
      originalFilename,
      checks,
      allPassed,
      canProceed,
      summary,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Video validation error:', error);
    return NextResponse.json(
      { error: 'Failed to validate video assets' },
      { status: 500 }
    );
  }
}

function checkFile(
  filePath: string,
  displayName: string,
  filename: string,
  canRegenerate: boolean,
  regenerateAction?: 'reprocess_motion' | 'run_yolov8' | 'download'
): ValidationCheck {
  const exists = fs.existsSync(filePath);

  return {
    name: displayName,
    status: exists ? 'passed' : 'failed',
    exists,
    path: filename,
    message: exists ? 'File found' : 'File not found',
    canRegenerate,
    regenerateAction: canRegenerate ? regenerateAction : undefined,
  };
}

function validateJsonFile(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}
