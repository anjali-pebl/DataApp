import { NextRequest, NextResponse } from 'next/server';
import {
  checkProcessingDependencies,
  autoInstallPackages,
} from '@/lib/local-processing-checker-server';

export async function POST(request: NextRequest) {
  try {
    // First check what needs to be installed
    const checkResult = await checkProcessingDependencies();

    // Auto-install missing packages
    const installResult = await autoInstallPackages(checkResult.dependencies);

    return NextResponse.json({
      success: installResult.success,
      installed: installResult.installed,
      failed: installResult.failed,
      message: `Installed ${installResult.installed.length} package(s)${
        installResult.failed.length > 0
          ? `, ${installResult.failed.length} failed`
          : ''
      }`,
    });
  } catch (error: any) {
    console.error('Error auto-installing packages:', error);
    return NextResponse.json(
      {
        error: 'Failed to auto-install packages',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
