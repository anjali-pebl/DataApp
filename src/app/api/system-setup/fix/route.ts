import { NextRequest, NextResponse } from 'next/server';
import { checkSystemRequirements, autoFixRequirements } from '@/lib/system-setup-service';

export async function POST(request: NextRequest) {
  try {
    // Check current status
    const setupStatus = await checkSystemRequirements();

    // Auto-fix what we can
    const fixResult = await autoFixRequirements(setupStatus.requirements);

    return NextResponse.json({
      success: fixResult.success,
      fixed: fixResult.fixed,
      failed: fixResult.failed,
      message: `Fixed ${fixResult.fixed.length} issue(s)${
        fixResult.failed.length > 0 ? `, ${fixResult.failed.length} failed` : ''
      }`,
    });
  } catch (error: any) {
    console.error('Error auto-fixing requirements:', error);
    return NextResponse.json(
      { error: 'Failed to auto-fix requirements', details: error.message },
      { status: 500 }
    );
  }
}
