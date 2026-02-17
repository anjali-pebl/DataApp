import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

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

    // Ensure we have the original filename (not background_subtracted)
    const originalFilename = videoFilename.replace('_background_subtracted.mp4', '.mp4');

    console.log(`Starting YOLOv8 inference for: ${originalFilename}`);

    // Path to the Python script
    const scriptPath = path.join(process.cwd(), 'process_videos_yolov8.py');
    const videoPath = path.join(process.cwd(), 'public', 'videos', originalFilename);

    // Spawn the Python process
    const pythonProcess = spawn('python', [
      scriptPath,
      '--input', videoPath,
    ], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Store the process ID for tracking
    const processId = pythonProcess.pid;

    // Log output (don't wait for completion)
    pythonProcess.stdout.on('data', (data) => {
      console.log(`[YOLOv8] ${data.toString()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error(`[YOLOv8 Error] ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
      console.log(`[YOLOv8] Process exited with code ${code}`);
    });

    // Return immediately - processing continues in background
    return NextResponse.json({
      success: true,
      message: `YOLOv8 inference started for ${originalFilename}`,
      processId,
      estimatedTime: '2-5 minutes depending on video length',
      videoFilename: originalFilename,
    });
  } catch (error) {
    console.error('YOLOv8 inference error:', error);
    return NextResponse.json(
      { error: 'Failed to start YOLOv8 inference' },
      { status: 500 }
    );
  }
}

// GET endpoint to check status (optional - for future enhancement)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const videoFilename = searchParams.get('video');

  if (!videoFilename) {
    return NextResponse.json({ error: 'video parameter required' }, { status: 400 });
  }

  // Check if output files exist
  const fs = await import('fs');
  const originalFilename = videoFilename.replace('_background_subtracted.mp4', '.mp4');
  const yolov8VideoPath = path.join(
    process.cwd(),
    'public',
    'videos',
    originalFilename.replace('.mp4', '_yolov8.mp4')
  );
  const yolov8JsonPath = path.join(
    process.cwd(),
    'public',
    'motion-analysis-results',
    originalFilename.replace('.mp4', '_yolov8.json')
  );

  const videoExists = fs.existsSync(yolov8VideoPath);
  const jsonExists = fs.existsSync(yolov8JsonPath);

  return NextResponse.json({
    videoFilename: originalFilename,
    status: videoExists && jsonExists ? 'complete' : 'pending',
    outputs: {
      video: { path: yolov8VideoPath, exists: videoExists },
      json: { path: yolov8JsonPath, exists: jsonExists },
    },
  });
}
