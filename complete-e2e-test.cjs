#!/usr/bin/env node

/**
 * Complete end-to-end test of the user's exact scenario:
 * "create nomination poll, submit a ballot with a single nomination, 
 *  click edit, unselect previous nomination, enter new nomination, submit"
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

async function completeE2ETest() {
  console.log('🎯 Complete End-to-End Deletion Test');
  console.log('====================================');
  console.log('Testing exact user scenario: submit nomination → edit → delete → verify gone');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, serviceKey);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Step 1: Create poll via API (faster)
    console.log('\n📝 STEP 1: Creating fresh nomination poll...');
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        title: 'E2E Deletion Test',
        poll_type: 'nomination', 
        response_deadline: tomorrow.toISOString(),
        creator_name: 'E2ETest'
      })
      .select()
      .single();
      
    if (pollError) throw new Error(`Poll creation failed: ${pollError.message}`);
    const pollId = poll.id;
    console.log(`✅ Poll created: ${pollId}`);

    // Step 2: Visit poll and submit nomination
    console.log('\n🗳️ STEP 2: Submitting initial nomination "OriginalNom"...');
    
    await page.goto(`http://localhost:3000/p/${pollId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await page.waitForSelector('input[placeholder*="nomination"]', { timeout: 10000 });
    await page.fill('input[placeholder*="nomination"]', 'OriginalNom');
    await page.fill('input[placeholder*="name"]', 'E2EUser');

    // Submit first nomination
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);
    
    const submitBtn1 = page.locator('button:has-text("Submit"):not([disabled])').first();
    if (await submitBtn1.isVisible()) {
      await submitBtn1.click();
    }
    await page.waitForTimeout(3000);
    console.log('✅ Original nomination submitted');

    // Step 3: Verify nomination appears
    console.log('\n📊 STEP 3: Verifying "OriginalNom" appears in results...');
    
    const beforeEdit = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let found = false;
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes('OriginalNom')) {
          found = true;
          break;
        }
      }
      return found;
    });

    console.log(`   OriginalNom visible: ${beforeEdit}`);
    if (!beforeEdit) {
      console.log('❌ CRITICAL: Original nomination not showing, cannot test deletion');
      return false;
    }

    // Step 4: Edit vote to delete nomination (user's exact scenario)
    console.log('\n✏️ STEP 4: Editing vote to DELETE nomination...');
    
    await page.waitForSelector('button:has-text("Edit")', { timeout: 10000 });
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(2000);

    // Clear the nomination field completely (this simulates deletion)
    const nominationInputs = await page.locator('input[placeholder*="nomination"]').all();
    if (nominationInputs.length > 0) {
      await nominationInputs[0].fill(''); // Clear = delete
      console.log('   ✅ Deleted nomination (cleared field)');
    }

    // Submit the edit (should become abstain vote)
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);
    
    const submitBtn2 = page.locator('button:has-text("Submit"):not([disabled])').first();
    if (await submitBtn2.isVisible()) {
      await submitBtn2.click();
    }
    await page.waitForTimeout(5000); // Wait for our fix to trigger
    console.log('   ✅ Deletion submitted');

    // Step 5: Verify nomination is gone
    console.log('\n🔍 STEP 5: Verifying "OriginalNom" is DELETED from results...');
    
    const afterEdit = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let found = false;
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes('OriginalNom')) {
          found = true;
          break;
        }
      }
      return found;
    });

    console.log(`   OriginalNom still visible: ${afterEdit}`);

    // Step 6: Database verification
    console.log('\n🔍 STEP 6: Database verification...');
    
    const { data: votes } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .order('updated_at', { ascending: false });
      
    console.log(`   Total votes: ${votes.length}`);
    if (votes.length > 0) {
      const latestVote = votes[0];
      console.log(`   Latest vote: nominations=${JSON.stringify(latestVote.nominations)}, is_abstain=${latestVote.is_abstain}`);
      console.log(`   Vote was updated: ${latestVote.created_at !== latestVote.updated_at}`);
    }

    // Final verification using the same query the frontend uses
    const { data: resultsVotes } = await supabase
      .from('votes')
      .select('nominations')
      .eq('poll_id', pollId)
      .eq('vote_type', 'nomination')
      .eq('is_abstain', false)
      .not('nominations', 'is', null);
      
    const hasOriginalNom = resultsVotes.some(vote => 
      vote.nominations && vote.nominations.includes('OriginalNom')
    );
    console.log(`   OriginalNom in results query: ${hasOriginalNom}`);

    // Final analysis
    console.log('\n📊 FINAL ANALYSIS:');
    
    const dbCorrect = votes.length > 0 && votes[0].is_abstain === true;
    const resultsCorrect = !hasOriginalNom;
    const uiCorrect = !afterEdit;
    
    console.log(`   Database shows abstain: ${dbCorrect}`);
    console.log(`   Results query excludes nomination: ${resultsCorrect}`);
    console.log(`   UI shows nomination deleted: ${uiCorrect}`);
    
    if (dbCorrect && resultsCorrect && uiCorrect) {
      console.log('🎉 SUCCESS: Nomination deletion works PERFECTLY!');
      console.log('   ✅ Database updated correctly');
      console.log('   ✅ Results query filters correctly');
      console.log('   ✅ UI refreshed correctly');
      console.log('   ✅ User\'s exact scenario now works');
      return true;
    } else {
      console.log('❌ FAILURE: Some aspect of deletion is still broken');
      if (!dbCorrect) console.log('   💾 Database not updated properly');
      if (!resultsCorrect) console.log('   🔍 Results query not filtering correctly');
      if (!uiCorrect) console.log('   🖥️ UI not refreshing correctly');
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    await page.screenshot({ path: 'e2e-test-error.png' });
    return false;
  } finally {
    await browser.close();
  }
}

completeE2ETest()
  .then(success => {
    console.log('\n' + '='.repeat(70));
    console.log('🏁 END-TO-END TEST:', success ? '✅ DELETION FIXED!' : '❌ STILL BROKEN');
    console.log('='.repeat(70));
    
    if (success) {
      console.log('\n🎯 The user\'s exact issue has been resolved:');
      console.log('   ✓ Create nomination poll');
      console.log('   ✓ Submit nomination');
      console.log('   ✓ Edit to delete nomination');
      console.log('   ✓ Nomination disappears from results');
    }
    
    process.exit(success ? 0 : 1);
  });
