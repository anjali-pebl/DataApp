import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const { filename, type } = await request.json();

    if (!filename) {
      return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
    }

    if (!type || !['motion', 'yolov8', 'both'].includes(type)) {
      return NextResponse.json({ error: 'Type must be motion, yolov8, or both' }, { status: 400 });
    }

    console.log(`[Motion Analysis Reprocess] Starting ${type} reprocessing for: ${filename}`);

    const projectRoot = process.cwd();
    const inputPath = path.join(projectRoot, 'public', 'videos', filename);
    const outputDir = path.join(projectRoot, 'public', 'videos');
    const resultsDir = path.join(projectRoot, 'public', 'motion-analysis-results');

    const results: any = {
      filename,
      type,
      steps: []
    };

    try {
      if (type === 'motion' || type === 'both') {
        console.log('[Motion Analysis Reprocess] Running background subtraction...');

        const bgCmd = `python cv_scripts/background_subtraction.py --input "${inputPath}" --output "${outputDir}" --subsample 1`;

        const bgResult = await execAsync(bgCmd, {
          cwd: projectRoot,
          timeout: 600000, // 10 minutes
        });

        results.steps.push({
          name: 'background_subtraction',
          success: true,
          stdout: bgResult.stdout,
          stderr: bgResult.stderr,
        });

        console.log('[Motion Analysis Reprocess] Background subtraction complete');

        // Now run motion analysis on the generated background-subtracted video
        const bgSubtractedFile = filename.replace('.mp4', '_background_subtracted.mp4');
        const bgSubtractedPath = path.join(outputDir, bgSubtractedFile);

        console.log('[Motion Analysis Reprocess] Running motion analysis...');

        const motionCmd = `python cv_scripts/motion_analysis.py --input "${bgSubtractedPath}" --output "${resultsDir}" --no-viz`;

        const motionResult = await execAsync(motionCmd, {
          cwd: projectRoot,
          timeout: 600000, // 10 minutes
        });

        results.steps.push({
          name: 'motion_analysis',
          success: true,
          stdout: motionResult.stdout,
          stderr: motionResult.stderr,
        });

        console.log('[Motion Analysis Reprocess] Motion analysis complete');
      }

      if (type === 'yolov8' || type === 'both') {
        console.log('[Motion Analysis Reprocess] Running YOLOv8 detection...');

        // Pass the specific filename to only process that video
        const yoloCmd = `python process_videos_yolov8.py --input "${filename}"`;

        const yoloResult = await execAsync(yoloCmd, {
          cwd: projectRoot,
          timeout: 1800000, // 30 minutes for YOLO
          env: { ...process.env, PYTHONUNBUFFERED: '1' }, // Force unbuffered output
        });

        results.steps.push({
          name: 'yolov8_detection',
          success: true,
          stdout: yoloResult.stdout,
          stderr: yoloResult.stderr,
        });

        console.log('[Motion Analysis Reprocess] YOLOv8 detection complete');
      }

      return NextResponse.json({
        success: true,
        message: `Successfully reprocessed ${filename} (${type})`,
        results,
      });

    } catch (error: any) {
      console.error('[Motion Analysis Reprocess] Processing error:', error);

      return NextResponse.json({
        success: false,
        error: error.message,
        stderr: error.stderr,
        stdout: error.stdout,
        results,
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error('[Motion Analysis Reprocess] Request error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
