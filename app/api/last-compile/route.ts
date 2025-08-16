import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Import the timestamp module that gets regenerated on every compilation
    const { lastCompileTime, lastCompileISO } = await import('../../../lib/last-compile-time');
    
    return NextResponse.json({
      timestamp: lastCompileTime,
      iso: lastCompileISO,
      note: 'This timestamp updates when Next.js recompiles any part of the app'
    });
  } catch (e) {
    // Fallback if file doesn't exist yet
    return NextResponse.json({
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      note: 'Fallback timestamp - compilation tracking not ready yet'
    });
  }
}

export const dynamic = 'force-dynamic';