#!/usr/bin/env node

/**
 * Test nomination addition bug using direct API calls
 */

const { createClient } = require('@supabase/supabase-js');

async function testAdditionAPI() {
  console.log('🔍 Testing Nomination Addition via API');
  console.log('=====================================');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  
  const anonClient = createClient(supabaseUrl, anonKey);
  const serviceClient = createClient(supabaseUrl, serviceKey);

  try {
    // Create test poll
    const { data: poll } = await serviceClient
      .from('polls')
      .insert({
        title: 'API Addition Test',
        poll_type: 'nomination',
        response_deadline: new Date(Date.now() + 86400000).toISOString()
      })
      .select()
      .single();
      
    const pollId = poll.id;
    console.log(`\n✅ Test poll created: ${pollId}`);

    // Step 1: Submit initial vote with "FirstNom"
    console.log('\n🗳️ STEP 1: Submit initial nomination "FirstNom"...');
    const { data: insertData, error: insertError } = await anonClient
      .from('votes')
      .insert({
        poll_id: pollId,
        vote_type: 'nomination',
        nominations: ['FirstNom'],
        is_abstain: false,
        voter_name: 'AdditionUser'
      })
      .select('id')
      .single();
      
    if (insertError) {
      console.log(`❌ INSERT failed: ${insertError.message}`);
      return false;
    }
    
    const voteId = insertData.id;
    console.log(`✅ Vote created: ${voteId}`);

    // Step 2: Verify FirstNom appears in results
    console.log('\n📊 STEP 2: Verify FirstNom appears in results...');
    
    const { data: initialResults } = await serviceClient
      .from('votes')
      .select('nominations')
      .eq('poll_id', pollId)
      .eq('vote_type', 'nomination')
      .eq('is_abstain', false)
      .not('nominations', 'is', null);
      
    console.log(`   Results count: ${initialResults.length}`);
    const hasFirstNom = initialResults.some(vote => 
      vote.nominations && vote.nominations.includes('FirstNom')
    );
    console.log(`   Has FirstNom: ${hasFirstNom}`);

    if (!hasFirstNom) {
      console.log('❌ FirstNom not in results, cannot test addition');
      return false;
    }

    // Step 3: Update vote to ADD SecondNom (should have both FirstNom + SecondNom)
    console.log('\n✏️ STEP 3: Update vote to ADD SecondNom...');
    const { data: updateData, error: updateError } = await anonClient
      .from('votes')
      .update({
        nominations: ['FirstNom', 'SecondNom'], // Both nominations
        is_abstain: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', voteId)
      .select();
      
    console.log(`   Update error: ${updateError ? updateError.message : 'NONE'}`);
    console.log(`   Update returned data count: ${updateData ? updateData.length : 0}`);

    // Step 4: Verify database has both nominations
    console.log('\n🔍 STEP 4: Verify database state...');
    const { data: verifyData } = await serviceClient
      .from('votes')
      .select('*')
      .eq('id', voteId)
      .single();
      
    console.log(`   Vote nominations: ${JSON.stringify(verifyData.nominations)}`);
    console.log(`   Vote is_abstain: ${verifyData.is_abstain}`);
    console.log(`   Vote was updated: ${verifyData.created_at !== verifyData.updated_at}`);

    // Step 5: Check what appears in results query
    console.log('\n📊 STEP 5: Check results query...');
    
    const { data: finalResults } = await serviceClient
      .from('votes')
      .select('nominations')
      .eq('poll_id', pollId)
      .eq('vote_type', 'nomination')
      .eq('is_abstain', false)
      .not('nominations', 'is', null);
      
    console.log(`   Results count: ${finalResults.length}`);
    
    const hasFirstNomFinal = finalResults.some(vote => 
      vote.nominations && vote.nominations.includes('FirstNom')
    );
    const hasSecondNomFinal = finalResults.some(vote => 
      vote.nominations && vote.nominations.includes('SecondNom')
    );
    
    console.log(`   Results has FirstNom: ${hasFirstNomFinal}`);
    console.log(`   Results has SecondNom: ${hasSecondNomFinal}`);

    // Step 6: Test how nominations are counted (this is key!)
    console.log('\n🔢 STEP 6: Test nomination counting...');
    
    const nominationCounts = {};
    finalResults.forEach(vote => {
      if (vote.nominations && Array.isArray(vote.nominations)) {
        vote.nominations.forEach(nomination => {
          nominationCounts[nomination] = (nominationCounts[nomination] || 0) + 1;
        });
      }
    });
    
    console.log(`   Nomination counts:`, nominationCounts);

    // Final analysis
    console.log('\n📊 FINAL ANALYSIS:');
    
    const dbCorrect = verifyData.nominations && 
                     verifyData.nominations.includes('FirstNom') && 
                     verifyData.nominations.includes('SecondNom');
                     
    const resultsCorrect = hasFirstNomFinal && hasSecondNomFinal;
    const countsCorrect = nominationCounts['FirstNom'] === 1 && nominationCounts['SecondNom'] === 1;
    
    console.log(`   Database has both: ${dbCorrect}`);
    console.log(`   Results query finds both: ${resultsCorrect}`);
    console.log(`   Counting works correctly: ${countsCorrect}`);
    
    if (dbCorrect && resultsCorrect && countsCorrect) {
      console.log('🎉 SUCCESS: Nomination addition works at API level!');
      console.log('   The issue might be in the frontend UI logic');
      return true;
    } else {
      console.log('❌ FAILURE: API level nomination addition broken');
      if (!dbCorrect) console.log('   💾 Database not storing both nominations');
      if (!resultsCorrect) console.log('   🔍 Results query not finding both');
      if (!countsCorrect) console.log('   🔢 Counting logic broken');
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    return false;
  }
}

testAdditionAPI()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    console.log('🏁 API ADDITION TEST:', success ? '✅ API WORKS' : '❌ API BROKEN');
    console.log('='.repeat(60));
    
    if (success) {
      console.log('\n🎯 API level works - issue is in frontend');
    } else {
      console.log('\n🔧 API level broken - need to fix core logic');
    }
  });
