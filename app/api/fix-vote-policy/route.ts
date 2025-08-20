import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  // Only allow in development mode
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Only available in development' }, { status: 403 });
  }

  try {
    // Use the direct SQL approach like our migrations
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
    const projectRef = supabaseUrl?.split('//')[1]?.split('.')[0];
    
    if (!projectRef) {
      throw new Error('Could not extract project ref from URL');
    }

    // Execute SQL directly using Management API
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          -- Drop existing policy if it exists
          DROP POLICY IF EXISTS "Allow public update on votes" ON votes;
          
          -- Create new UPDATE policy
          CREATE POLICY "Allow public update on votes" ON votes 
          FOR UPDATE TO public 
          USING (true)
          WITH CHECK (true);
          
          -- Check that it was created
          SELECT policyname, cmd FROM pg_policies WHERE tablename = 'votes' AND cmd = 'UPDATE';
        `
      })
    });

    const result = await response.text();
    
    return NextResponse.json({
      success: response.ok,
      message: response.ok ? 'UPDATE policy recreated successfully' : 'Failed to create policy',
      httpStatus: response.status,
      result: result,
      projectRef
    });

  } catch (error) {
    console.error('Failed to fix vote policy:', error);
    return NextResponse.json({ 
      error: 'Failed to fix vote policy',
      details: String(error)
    }, { status: 500 });
  }
}