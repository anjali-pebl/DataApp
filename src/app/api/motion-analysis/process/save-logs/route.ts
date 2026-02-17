import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as fs from 'fs';
import * as path from 'path';

/**
 * POST /api/motion-analysis/process/save-logs
 * Save processing logs to the database for a failed run
 *
 * Request body:
 *   {
 *     runId: string,
 *     logs?: string  // Optional - if not provided, will read from log file
 *   }
 *
 * Response:
 *   {
 *     success: boolean,
 *     message: string
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { runId, logs: providedLogs } = body;

    if (!runId) {
      return NextResponse.json(
        { success: false, error: 'Missing runId' },
        { status: 400 }
      );
    }

    console.log(`[SAVE-LOGS] Saving logs for run: ${runId}`);

    // Get the processing run to verify it exists and get its status
    const { data: run, error: runError } = await supabase
      .from('processing_runs')
      .select('id, status, user_id')
      .eq('id', runId)
      .single();

    if (runError || !run) {
      console.error('[SAVE-LOGS] Run not found:', runError);
      return NextResponse.json(
        { success: false, error: 'Processing run not found' },
        { status: 404 }
      );
    }

    console.log(`[SAVE-LOGS] Run status: ${run.status}`);

    // Read logs from file if not provided
    let logContent = providedLogs;
    if (!logContent) {
      try {
        const projectRoot = process.cwd();
        const logFile = path.join(projectRoot, `processing-${runId}.log`);

        if (fs.existsSync(logFile)) {
          logContent = fs.readFileSync(logFile, 'utf-8');
          console.log(`[SAVE-LOGS] Read ${logContent.length} bytes from log file`);
        } else {
          console.warn(`[SAVE-LOGS] Log file not found: ${logFile}`);
          return NextResponse.json(
            { success: false, error: 'Log file not found' },
            { status: 404 }
          );
        }
      } catch (fileError: any) {
        console.error('[SAVE-LOGS] Error reading log file:', fileError);
        return NextResponse.json(
          { success: false, error: `Failed to read log file: ${fileError.message}` },
          { status: 500 }
        );
      }
    }

    if (!logContent) {
      return NextResponse.json(
        { success: false, error: 'No logs available' },
        { status: 400 }
      );
    }

    // Parse logs into structured format
    const logLines = logContent.split('\n').filter(line => line.trim());

    // Separate errors from general logs
    const errorLines = logLines.filter(line =>
      line.includes('[ERROR]') ||
      line.includes('[STDERR]') ||
      line.includes('Traceback') ||
      line.includes('Exception') ||
      /error/i.test(line)
    );

    // Create structured log entries (full logs)
    const logsArray = logLines.map(line => {
      // Try to extract timestamp from line
      const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[^\]]*)\]/);
      const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();

      return {
        timestamp,
        message: line,
      };
    });

    // Create structured error entries
    const errorsArray = errorLines.map(line => {
      const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[^\]]*)\]/);
      const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();

      return {
        timestamp,
        message: line,
        severity: line.includes('[ERROR]') ? 'error' : line.includes('[WARNING]') ? 'warning' : 'error',
      };
    });

    console.log(`[SAVE-LOGS] Parsed ${logsArray.length} log entries and ${errorsArray.length} errors`);

    // Update the processing run with logs and errors
    const updateData: any = {
      logs: logsArray,
      errors: errorsArray,
      updated_at: new Date().toISOString(),
    };

    // If the run is not marked as failed yet, mark it now
    if (run.status === 'running') {
      updateData.status = 'failed';
      updateData.completed_at = new Date().toISOString();
      console.log('[SAVE-LOGS] Marking run as failed');
    }

    const { error: updateError } = await supabase
      .from('processing_runs')
      .update(updateData)
      .eq('id', runId);

    if (updateError) {
      console.error('[SAVE-LOGS] Error updating run:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to save logs to database' },
        { status: 500 }
      );
    }

    console.log(`[SAVE-LOGS] ✓ Successfully saved ${logsArray.length} log entries and ${errorsArray.length} errors`);

    return NextResponse.json({
      success: true,
      message: 'Logs saved successfully',
      stats: {
        totalLines: logsArray.length,
        errorLines: errorsArray.length,
        logSizeBytes: logContent.length,
      },
    });
  } catch (error: any) {
    console.error('[SAVE-LOGS] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to save logs' },
      { status: 500 }
    );
  }
}
