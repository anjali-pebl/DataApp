import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { createClient } from '@/lib/supabase/server';

interface PrescreenResult {
  success: boolean;
  error?: string;
  brightness?: {
    score: number;
    classification: string;
    raw_avg: number;
  };
  focus?: {
    score: number;
    classification: string;
    variance_avg: number;
  };
  quality?: {
    score: number;
    classification: string;
  };
  sampling?: {
    num_samples: number;
  };
}

async function runPrescreenScript(videoPath: string, samples: number = 10): Promise<PrescreenResult> {
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

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { videoId, videoPath, samples = 10 } = body;

    if (!videoPath) {
      return NextResponse.json({ error: 'videoPath is required' }, { status: 400 });
    }

    console.log(`[Prescreen] Starting for video ${videoId}: ${videoPath}`);

    // Run prescreening
    const result = await runPrescreenScript(videoPath, samples);

    console.log(`[Prescreen] Result for ${videoId}:`, result.success ? 'Success' : 'Failed', result.error || '');

    // Update database if videoId provided
    if (videoId && result.success) {
      const { error: updateError } = await supabase
        .from('uploaded_videos')
        .update({
          prescreen_brightness: result.brightness?.score,
          prescreen_focus: result.focus?.score,
          prescreen_quality: result.quality?.score,
          prescreen_completed: true,
          prescreen_samples: result.sampling?.num_samples || samples,
          prescreen_error: null
        })
        .eq('id', videoId)
        .eq('user_id', user.id);

      if (updateError) {
        console.error('[Prescreen] Database update error:', updateError);
      }
    } else if (videoId && !result.success) {
      const { error: updateError } = await supabase
        .from('uploaded_videos')
        .update({
          prescreen_completed: false,
          prescreen_error: result.error
        })
        .eq('id', videoId)
        .eq('user_id', user.id);

      if (updateError) {
        console.error('[Prescreen] Database error update failed:', updateError);
      }
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[Prescreen] Error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
