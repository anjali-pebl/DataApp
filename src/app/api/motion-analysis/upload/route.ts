import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createUploadedVideo } from '@/lib/supabase/motion-analysis-service';
import { writeFile } from 'fs/promises';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Prescreening function (same as in prescreen/route.ts)
async function runPrescreenScript(videoPath: string, samples: number = 10): Promise<any> {
  return new Promise((resolve) => {
    const scriptPath = path.join(process.cwd(), 'cv_scripts', 'video_prescreen.py');
    const fullVideoPath = path.join(process.cwd(), videoPath);

    const pythonProcess = spawn('python', [
      scriptPath,
      fullVideoPath,
      '--samples', samples.toString()
    ]);

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        resolve({
          success: false,
          error: stderr || `Process exited with code ${code}`
        });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        resolve({
          success: false,
          error: `Failed to parse output: ${e}`
        });
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      pythonProcess.kill();
      resolve({
        success: false,
        error: 'Prescreening timed out after 30 seconds'
      });
    }, 30000);
  });
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    console.log('Upload request received');
    console.log('Auth check:', {
      hasUser: !!user,
      userId: user?.id,
      authError: authError?.message
    });

    if (authError || !user) {
      console.error('Authentication failed:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse multipart form data
    const formData = await request.formData();
    const files = formData.getAll('videos') as File[];
    const enablePrescreen = formData.get('enablePrescreen') !== 'false'; // Default true

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const uploadedVideos = [];
    const errors = [];

    for (const file of files) {
      try {
        // Save file to public/videos/
        const filename = file.name;
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        const filePath = path.join(process.cwd(), 'public', 'videos', filename);
        await writeFile(filePath, buffer);

        console.log(`Saved video: ${filename} (${buffer.length} bytes)`);

        // Extract video metadata using ffprobe (optional)
        const metadata = await extractVideoMetadata(filePath);
        console.log(`Metadata extracted for ${filename}:`, metadata);

        // Create database record
        const { video, error } = await createUploadedVideo(supabase, {
          filename,
          original_filename: filename,
          filepath: `public/videos/${filename}`,
          file_size_bytes: buffer.length,
          width: metadata.width || null,
          height: metadata.height || null,
          fps: metadata.fps || null,
          duration_seconds: metadata.duration || null,
          total_frames: metadata.total_frames || null,
        });

        if (error) {
          console.error(`Failed to create DB record for ${filename}:`, error);
          console.error('Full error details:', JSON.stringify(error, null, 2));
          errors.push({ filename, error: error.message || error.code || String(error) });
        } else {
          console.log(`Created DB record for ${filename}:`, video?.id);
          uploadedVideos.push(video);

          // Trigger prescreening if enabled (runs synchronously to ensure data is ready)
          if (enablePrescreen && video?.id) {
            console.log(`[Prescreen] Starting for ${filename} (${video.id})`);
            const prescreenResult = await runPrescreenScript(`public/videos/${filename}`, 10);

            if (prescreenResult.success) {
              console.log(`[Prescreen] Success for ${filename}:`, {
                brightness: prescreenResult.brightness?.score,
                focus: prescreenResult.focus?.score,
                quality: prescreenResult.quality?.score
              });

              // Update database with prescreen results
              const { error: updateError } = await supabase
                .from('uploaded_videos')
                .update({
                  prescreen_brightness: prescreenResult.brightness?.score,
                  prescreen_focus: prescreenResult.focus?.score,
                  prescreen_quality: prescreenResult.quality?.score,
                  prescreen_completed: true,
                  prescreen_samples: prescreenResult.sampling?.num_samples || 10,
                  prescreen_error: null
                })
                .eq('id', video.id);

              if (updateError) {
                console.error(`[Prescreen] Failed to update DB for ${filename}:`, updateError);
              } else {
                console.log(`[Prescreen] DB updated for ${filename}`);
              }
            } else {
              console.error(`[Prescreen] Failed for ${filename}:`, prescreenResult.error);

              // Update database with error
              await supabase
                .from('uploaded_videos')
                .update({
                  prescreen_completed: false,
                  prescreen_error: prescreenResult.error
                })
                .eq('id', video.id);
            }
          }
        }
      } catch (err: any) {
        console.error(`Error processing file ${file.name}:`, err);
        console.error('Full error stack:', err.stack);
        errors.push({ filename: file.name, error: err.message || String(err) });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      uploaded: uploadedVideos.length,
      videos: uploadedVideos,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to upload videos' },
      { status: 500 }
    );
  }
}

/**
 * Extract video metadata using ffprobe with OpenCV fallback
 */
async function extractVideoMetadata(filePath: string): Promise<VideoMetadata> {
  // Try ffprobe first (most accurate and fastest)
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { timeout: 30000 }
    );

    const data = JSON.parse(stdout);
    const videoStream = data.streams.find((s: any) => s.codec_type === 'video');

    if (!videoStream) {
      throw new Error('No video stream found');
    }

    const width = videoStream.width;
    const height = videoStream.height;

    // Parse frame rate (e.g., "24000/1001" → 23.976)
    let fps = 24; // default
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      fps = den ? num / den : num;
    }

    const duration = parseFloat(data.format.duration || '0');
    const total_frames = Math.round(duration * fps);
    const bitrate = parseInt(data.format.bit_rate || '0', 10);

    console.log(`[Metadata] ffprobe: ${width}x${height} @ ${fps.toFixed(2)}fps, ${duration.toFixed(1)}s, ${total_frames} frames`);

    return {
      width,
      height,
      fps: Math.round(fps * 100) / 100, // Round to 2 decimals
      duration: Math.round(duration * 100) / 100,
      total_frames,
      bitrate,
      extraction_method: 'ffprobe',
    };
  } catch (ffprobeError) {
    console.warn('[Metadata] ffprobe failed, trying OpenCV fallback:', ffprobeError);
  }

  // Fallback: Use Python/OpenCV for metadata extraction
  try {
    const pythonScript = `
import cv2
import json
import sys

cap = cv2.VideoCapture(sys.argv[1])
if cap.isOpened():
    result = {
        'width': int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        'fps': cap.get(cv2.CAP_PROP_FPS),
        'total_frames': int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
    }
    result['duration'] = result['total_frames'] / result['fps'] if result['fps'] > 0 else 0
    print(json.dumps(result))
    cap.release()
else:
    print('{"error": "Could not open video"}')
`;

    const { stdout } = await execAsync(
      `python -c "${pythonScript.replace(/\n/g, ';').replace(/"/g, '\\"')}" "${filePath}"`,
      { timeout: 30000 }
    );

    const result = JSON.parse(stdout.trim());
    if (result.error) throw new Error(result.error);

    console.log(`[Metadata] OpenCV: ${result.width}x${result.height} @ ${result.fps.toFixed(2)}fps, ${result.duration.toFixed(1)}s`);

    return {
      ...result,
      fps: Math.round(result.fps * 100) / 100,
      duration: Math.round(result.duration * 100) / 100,
      extraction_method: 'opencv',
    };
  } catch (opencvError) {
    console.error('[Metadata] Both extraction methods failed:', opencvError);
    return {
      width: null,
      height: null,
      fps: null,
      duration: null,
      total_frames: null,
      extraction_method: 'failed',
    };
  }
}

interface VideoMetadata {
  width: number | null;
  height: number | null;
  fps: number | null;
  duration: number | null;
  total_frames: number | null;
  bitrate?: number;
  extraction_method: 'ffprobe' | 'opencv' | 'failed';
}
