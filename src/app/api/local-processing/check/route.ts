import { NextRequest, NextResponse } from 'next/server';
import { checkProcessingDependencies } from '@/lib/local-processing-checker-server';

export async function GET(request: NextRequest) {
  try {
    console.log('[API] Checking processing dependencies...');
    const startTime = Date.now();

    const checkResult = await checkProcessingDependencies();

    console.log(`[API] Dependency check completed in ${Date.now() - startTime}ms`);

    // Cache the result for future checks (client-side will handle caching)
    // We just add metadata here to help the client cache
    const response = {
      ...checkResult,
      checkedAt: new Date().toISOString(),
      checkDuration: Date.now() - startTime,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Error checking processing dependencies:', error);
    return NextResponse.json(
      {
        error: 'Failed to check processing dependencies',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
