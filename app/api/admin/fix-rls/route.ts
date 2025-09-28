import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  // Only allow in development mode
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Only available in development' }, { status: 403 });
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST!;
    const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST!;

    // Create clients
    const adminClient = createClient(supabaseUrl, serviceKey);
    const anonClient = createClient(supabaseUrl, anonKey);

    const results: any = {
      step1_checkPolicies: null,
      step2_dropPolicy: null,
      step3_createPolicy: null,
      step4_testWithAnon: null,
      step5_finalCheck: null
    };

    // Step 1: Check current policies
    console.log('🔍 Step 1: Checking current policies...');
    const { data: policies, error: policiesError } = await adminClient
      .from('pg_policies')
      .select('policyname, cmd, qual, with_check')
      .eq('tablename', 'votes');
    
    results.step1_checkPolicies = { policies, policiesError };
    console.log('Current policies:', policies);

    // Step 2: Drop existing UPDATE policy
    console.log('🗑️ Step 2: Dropping existing UPDATE policy...');
    const dropSql = `DROP POLICY IF EXISTS "Allow public update on votes" ON votes;`;
    const { data: dropData, error: dropError } = await adminClient.rpc('exec_sql', { sql: dropSql });
    results.step2_dropPolicy = { dropData, dropError };

    // Step 3: Create new UPDATE policy with correct syntax
    console.log('✨ Step 3: Creating new UPDATE policy...');
    const createSql = `
      CREATE POLICY "Allow public update on votes" ON votes 
      FOR UPDATE 
      TO public 
      USING (true)
      WITH CHECK (true);
    `;
    const { data: createData, error: createError } = await adminClient.rpc('exec_sql', { sql: createSql });
    results.step3_createPolicy = { createData, createError };

    // Step 4: Test with anonymous client
    console.log('🧪 Step 4: Testing UPDATE with anonymous client...');
    
    // First, find a vote to test with
    const { data: testVotes } = await anonClient.from('votes').select('id').limit(1);
    const testVoteId = testVotes?.[0]?.id;
    
    if (testVoteId) {
      const { data: testData, error: testError } = await anonClient
        .from('votes')
        .update({ yes_no_choice: 'yes' })
        .eq('id', testVoteId)
        .select();
      
      results.step4_testWithAnon = { testVoteId, testData, testError, success: !!testData?.length };
    } else {
      results.step4_testWithAnon = { error: 'No votes found to test with' };
    }

    // Step 5: Final policy check
    console.log('✅ Step 5: Final policy verification...');
    const { data: finalPolicies } = await adminClient
      .from('pg_policies')
      .select('policyname, cmd')
      .eq('tablename', 'votes')
      .eq('cmd', 'UPDATE');
    
    results.step5_finalCheck = { finalPolicies };

    const success = results.step4_testWithAnon?.success === true;

    return NextResponse.json({
      success,
      message: success ? 'RLS UPDATE policy fixed successfully!' : 'RLS fix failed',
      details: results
    });

  } catch (error) {
    console.error('Admin RLS fix failed:', error);
    return NextResponse.json({ 
      error: 'Failed to fix RLS',
      details: String(error)
    }, { status: 500 });
  }
}