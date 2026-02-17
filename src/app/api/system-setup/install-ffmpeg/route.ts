import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const platform = process.platform;
    let installCommand: string;
    let installMethod: string;

    // Determine platform-specific installation command
    switch (platform) {
      case 'win32':
        installCommand = 'winget install --id Gyan.FFmpeg -e --silent --accept-source-agreements';
        installMethod = 'winget';
        break;
      case 'darwin':
        installCommand = 'brew install ffmpeg';
        installMethod = 'Homebrew';
        break;
      case 'linux':
        // Try to detect package manager
        try {
          await execAsync('which apt-get');
          installCommand = 'sudo apt-get install -y ffmpeg';
          installMethod = 'apt';
        } catch {
          try {
            await execAsync('which yum');
            installCommand = 'sudo yum install -y ffmpeg';
            installMethod = 'yum';
          } catch {
            return NextResponse.json(
              {
                success: false,
                error: 'Unsupported Linux package manager. Please install FFmpeg manually.',
              },
              { status: 400 }
            );
          }
        }
        break;
      default:
        return NextResponse.json(
          {
            success: false,
            error: `Unsupported platform: ${platform}`,
          },
          { status: 400 }
        );
    }

    console.log(`Installing FFmpeg using ${installMethod}: ${installCommand}`);

    // Run installation command with extended timeout (5 minutes)
    const { stdout, stderr } = await execAsync(installCommand, {
      timeout: 300000,
    });

    console.log('FFmpeg installation output:', stdout);
    if (stderr) {
      console.log('FFmpeg installation stderr:', stderr);
    }

    // Verify installation
    try {
      const { stdout: versionOutput } = await execAsync('ffmpeg -version');
      const versionMatch = versionOutput.match(/ffmpeg version (\S+)/);
      const version = versionMatch ? versionMatch[1] : 'unknown';

      return NextResponse.json({
        success: true,
        message: `FFmpeg ${version} installed successfully using ${installMethod}`,
        version,
        method: installMethod,
      });
    } catch (verifyError) {
      return NextResponse.json({
        success: false,
        error: 'FFmpeg installation completed but verification failed. You may need to restart your terminal or add FFmpeg to PATH manually.',
        details: 'Installation appeared to succeed, but ffmpeg command is not yet available.',
      });
    }
  } catch (error: any) {
    console.error('Error installing FFmpeg:', error);

    // Provide helpful error messages
    let errorMessage = 'Failed to install FFmpeg';
    let suggestions: string[] = [];

    if (error.message.includes('winget')) {
      errorMessage = 'winget not found or not configured';
      suggestions = [
        'Make sure you are running Windows 10 (1809+) or Windows 11',
        'Update App Installer from Microsoft Store',
        'Alternative: Download FFmpeg from https://ffmpeg.org/download.html',
      ];
    } else if (error.message.includes('brew')) {
      errorMessage = 'Homebrew not found';
      suggestions = [
        'Install Homebrew first: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
        'Alternative: Download FFmpeg from https://ffmpeg.org/download.html',
      ];
    } else if (error.message.includes('sudo') || error.message.includes('permission')) {
      errorMessage = 'Insufficient permissions';
      suggestions = [
        'Run the application with sudo privileges, or',
        'Install FFmpeg manually: sudo apt-get install ffmpeg',
      ];
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        details: error.message,
        suggestions,
      },
      { status: 500 }
    );
  }
}
