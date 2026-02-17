import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

/**
 * GET /api/motion-analysis/process/log?runId=xxx
 * Get the log file contents for a processing run
 *
 * Query params:
 *   runId: string - The processing run ID
 *   tail: number - Optional, return only the last N lines (default: all)
 *
 * Response:
 *   { success: boolean, logs: string, lines: number }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');
    const tailParam = searchParams.get('tail');
    const tail = tailParam ? parseInt(tailParam, 10) : null;

    if (!runId) {
      return NextResponse.json(
        { success: false, error: 'runId is required' },
        { status: 400 }
      );
    }

    const projectRoot = process.cwd();
    const logFile = path.join(projectRoot, `processing-${runId}.log`);

    if (!fs.existsSync(logFile)) {
      return NextResponse.json({
        success: true,
        logs: 'Log file not yet created. Waiting for process to start...',
        lines: 0,
        exists: false,
      });
    }

    let logs = fs.readFileSync(logFile, 'utf-8');
    let lineCount = logs.split('\n').length;

    // If tail is specified, return only the last N lines
    if (tail && tail > 0) {
      const lines = logs.split('\n');
      logs = lines.slice(-tail).join('\n');
    }

    return NextResponse.json({
      success: true,
      logs,
      lines: lineCount,
      exists: true,
    });
  } catch (error: any) {
    console.error('Error reading log file:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/motion-analysis/process/log
 * Log a message from the processing script
 *
 * Request body:
 *   {
 *     runId: string,
 *     message: string,
 *     level: 'info' | 'warning' | 'error' | 'success'
 *   }
 *
 * Response:
 *   { success: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { runId, message, level = 'info' } = body;

    // Log to console only - the log file is already written by stdout capture in start/route.ts
    // This avoids duplicate log entries
    const timestamp = new Date().toISOString();
    const levelPrefix = level.toUpperCase().padEnd(7);
    console.log(`[${timestamp}] [${levelPrefix}] [Run: ${runId}] ${message}`);

    // NOTE: We intentionally DON'T write to the log file here because:
    // 1. Python prints to stdout (captured by start/route.ts childProcess.stdout?.on('data'))
    // 2. That stdout is already written to the log file
    // 3. Writing here would create duplicate entries

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error logging message:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
