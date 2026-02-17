import { NextRequest, NextResponse } from 'next/server';
import { checkSystemRequirements } from '@/lib/system-setup-service';

export async function GET(request: NextRequest) {
  try {
    const setupStatus = await checkSystemRequirements();
    return NextResponse.json(setupStatus);
  } catch (error: any) {
    console.error('Error checking system setup:', error);
    return NextResponse.json(
      { error: 'Failed to check system requirements', details: error.message },
      { status: 500 }
    );
  }
}
