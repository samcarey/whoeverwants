#!/usr/bin/env node

/**
 * Test RLS policy issue with real vote ID from log
 */

const { createClient } = require('@supabase/supabase-js');

async function testRLSIssue() {
  console.log('🔍 Testing RLS UPDATE issue with real vote ID...');

  // Setup clients
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;

  const anonClient = createClient(url, anonKey);
  const serviceClient = createClient(url, serviceKey);

  const voteId = '9a717ccc-a160-48b4-a39d-6d9edb4b5655';
  const pollId = 'a08f4c7b-8e15-4021-855f-dc1f36788a07';

  console.log(`Testing with voteId: ${voteId}`);
  console.log(`Testing with pollId: ${pollId}`);

  // Test 1: UPDATE with anon key
  console.log('\n📝 TEST 1: UPDATE with anon key (frontend simulation)');
  const { data: anonUpdateData, error: anonUpdateError } = await anonClient
    .from('votes')
    .update({
      nominations: null,
      is_abstain: true,
      updated_at: new Date().toISOString()
    })
    .eq('id', voteId)
    .select();

  console.log('Anon UPDATE result:');
  console.log('  Error:', anonUpdateError);
  console.log('  Data length:', anonUpdateData?.length || 0);
  console.log('  Data:', JSON.stringify(anonUpdateData, null, 2));

  // Test 2: SELECT with anon key after UPDATE
  console.log('\n🔍 TEST 2: SELECT with anon key after UPDATE');
  const { data: anonSelectData, error: anonSelectError } = await anonClient
    .from('votes')
    .select('*')
    .eq('id', voteId)
    .single();

  console.log('Anon SELECT result:');
  console.log('  Error:', anonSelectError);
  console.log('  Data:', JSON.stringify(anonSelectData, null, 2));

  // Test 3: UPDATE with service key
  console.log('\n🔧 TEST 3: UPDATE with service key (should work)');
  const { data: serviceUpdateData, error: serviceUpdateError } = await serviceClient
    .from('votes')
    .update({
      nominations: ['ServiceKeyTest'],
      is_abstain: false,
      updated_at: new Date().toISOString()
    })
    .eq('id', voteId)
    .select();

  console.log('Service UPDATE result:');
  console.log('  Error:', serviceUpdateError);
  console.log('  Data length:', serviceUpdateData?.length || 0);
  console.log('  Data:', JSON.stringify(serviceUpdateData, null, 2));

  // Test 4: SELECT with service key
  console.log('\n🔍 TEST 4: SELECT with service key');
  const { data: serviceSelectData, error: serviceSelectError } = await serviceClient
    .from('votes')
    .select('*')
    .eq('id', voteId)
    .single();

  console.log('Service SELECT result:');
  console.log('  Error:', serviceSelectError);
  console.log('  Data:', JSON.stringify(serviceSelectData, null, 2));

  console.log('\n📊 ANALYSIS:');
  if (anonUpdateError) {
    console.log('❌ Anon UPDATE failed - this is the problem');
  } else if (!anonUpdateData || anonUpdateData.length === 0) {
    console.log('❌ Anon UPDATE succeeded but returned no data - RLS SELECT policy issue');
  } else {
    console.log('✅ Anon UPDATE worked correctly');
  }

  if (serviceUpdateData && serviceUpdateData.length > 0) {
    console.log('✅ Service key UPDATE works correctly (as expected)');
  }
}

testRLSIssue().catch(console.error);