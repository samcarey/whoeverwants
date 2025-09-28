#!/usr/bin/env node

/**
 * Simple test using existing poll to verify deletion
 */

const { createClient } = require('@supabase/supabase-js');

async function simpleDeletionTest() {
  console.log('🔍 Simple Deletion Test...');
  console.log('=========================');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  
  const anonClient = createClient(supabaseUrl, anonKey);
  const serviceClient = createClient(supabaseUrl, serviceKey);

  try {
    // Use the poll we created earlier
    const pollId = '00748a10-394c-4b40-a4b1-8c9211e2c53a';
    
    console.log(`\n📊 Testing with poll: ${pollId}`);

    // Step 1: Submit a nomination
    console.log('\n🗳️ STEP 1: Submitting nomination...');
    
    const { data: insertData, error: insertError } = await anonClient
      .from('votes')
      .insert({
        poll_id: pollId,
        vote_type: 'nomination',
        nominations: ['SimpleTest'],
        is_abstain: false,
        voter_name: 'TestUser'
      })
      .select('id')
      .single();
      
    if (insertError) {
      console.error('Insert failed:', insertError);
      return false;
    }
    
    const voteId = insertData.id;
    console.log(`✅ Vote inserted: ${voteId}`);

    // Step 2: Verify nomination shows in results
    console.log('\n📊 STEP 2: Checking nomination appears in results...');
    
    const { data: beforeResults } = await serviceClient
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .eq('is_abstain', false)
      .not('nominations', 'is', null);
      
    console.log(`   Non-abstain votes: ${beforeResults.length}`);
    const hasSimpleTest = beforeResults.some(vote => 
      vote.nominations && vote.nominations.includes('SimpleTest')
    );
    console.log(`   SimpleTest found: ${hasSimpleTest}`);

    if (!hasSimpleTest) {
      console.log('❌ Nomination not found in results');
      return false;
    }

    // Step 3: Delete nomination (simulate edit)
    console.log('\n✏️ STEP 3: Deleting nomination (edit to abstain)...');
    
    const { data: updateData, error: updateError } = await anonClient
      .from('votes')
      .update({
        nominations: null,
        is_abstain: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', voteId)
      .select();
      
    console.log(`   Update error: ${updateError ? updateError.message : 'none'}`);
    console.log(`   Update returned data: ${updateData ? updateData.length : 0} records`);

    // Step 4: Verify nomination is deleted from results
    console.log('\n🔍 STEP 4: Checking nomination is deleted from results...');
    
    const { data: afterResults } = await serviceClient
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .eq('is_abstain', false)
      .not('nominations', 'is', null);
      
    console.log(`   Non-abstain votes after: ${afterResults.length}`);
    const stillHasSimpleTest = afterResults.some(vote => 
      vote.nominations && vote.nominations.includes('SimpleTest')
    );
    console.log(`   SimpleTest still found: ${stillHasSimpleTest}`);

    // Step 5: Verify vote is actually abstain
    console.log('\n🔍 STEP 5: Verifying vote is abstain...');
    
    const { data: voteCheck } = await serviceClient
      .from('votes')
      .select('*')
      .eq('id', voteId)
      .single();
      
    console.log(`   Vote is_abstain: ${voteCheck.is_abstain}`);
    console.log(`   Vote nominations: ${JSON.stringify(voteCheck.nominations)}`);
    console.log(`   Vote updated: ${voteCheck.created_at !== voteCheck.updated_at}`);

    // Analysis
    console.log('\n📊 ANALYSIS:');
    
    if (updateError) {
      console.log('❌ UPDATE failed - this is the core problem');
      return false;
    } else if (updateData && updateData.length === 0) {
      console.log('⚠️ UPDATE succeeded but returned no data (RLS issue)');
      console.log('   This triggers our frontend fix');
    } else {
      console.log('✅ UPDATE succeeded and returned data');
    }
    
    if (voteCheck.is_abstain && !stillHasSimpleTest) {
      console.log('🎉 SUCCESS: Database deletion works correctly');
      console.log('   ✅ Vote is marked as abstain');
      console.log('   ✅ Nomination no longer appears in results');
      return true;
    } else {
      console.log('❌ FAILURE: Database deletion not working correctly');
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    return false;
  }
}

simpleDeletionTest()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 SIMPLE TEST:', success ? '✅ PASSED' : '❌ FAILED');
    console.log('='.repeat(50));
  });
