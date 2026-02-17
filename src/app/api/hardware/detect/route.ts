import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clientInfo } = body;

    // Client sends: { gpu, cpuCores, memory, platform, userAgent }
    // Server will run additional checks using child_process

    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    let gpuInfo = null;

    try {
      // Detect GPU on Windows using wmic
      if (process.platform === 'win32') {
        const { stdout } = await execAsync('wmic path win32_VideoController get name,AdapterRAM,DriverVersion');
        gpuInfo = stdout.trim();
      }
      // Detect GPU on Linux using lspci
      else if (process.platform === 'linux') {
        const { stdout } = await execAsync('lspci | grep -i vga');
        gpuInfo = stdout.trim();
      }
      // Detect GPU on macOS using system_profiler
      else if (process.platform === 'darwin') {
        const { stdout } = await execAsync('system_profiler SPDisplaysDataType');
        gpuInfo = stdout.trim();
      }
    } catch (error) {
      console.warn('Could not detect GPU:', error);
    }

    const hardwareInfo = {
      gpu: gpuInfo || clientInfo?.gpu || 'Unknown',
      cpuCores: clientInfo?.cpuCores || require('os').cpus().length,
      memory: clientInfo?.memory || Math.round(require('os').totalmem() / (1024 ** 3)), // GB
      platform: process.platform,
      userAgent: clientInfo?.userAgent || request.headers.get('user-agent'),
      detectedAt: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      hardware: hardwareInfo,
    });
  } catch (error: any) {
    console.error('Hardware detection error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
