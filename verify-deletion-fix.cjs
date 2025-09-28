#!/usr/bin/env node

/**
 * Verify the exact user scenario: create poll, submit nomination, delete it, verify it's gone
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

async function verifyDeletionFix() {
  console.log('🔍 Verifying Nomination Deletion Fix...');
  console.log('=====================================');

  // Setup database client for verification
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Step 1: Create nomination poll via API (faster than UI)
    console.log('\n📝 STEP 1: Creating nomination poll via API...');
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        title: 'Delete Test Poll',
        poll_type: 'nomination',
        response_deadline: tomorrow.toISOString(),
        creator_name: 'TestCreator'
      })
      .select()
      .single();
      
    if (pollError) throw new Error(`Poll creation failed: ${pollError.message}`);
    
    const pollId = poll.id;
    console.log(`✅ Created poll: ${pollId}`);

    // Step 2: Visit poll page
    console.log('\n📱 STEP 2: Visiting poll page...');
    await page.goto(`http://localhost:3000/p/${pollId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Step 3: Submit nomination "TestNom"
    console.log('\n🗳️ STEP 3: Submitting nomination "TestNom"...');
    
    await page.waitForSelector('input[placeholder*="nomination"]', { timeout: 10000 });
    await page.fill('input[placeholder*="nomination"]', 'TestNom');
    await page.fill('input[placeholder*="name"]', 'TestUser');

    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);
    
    // Handle confirmation modal
    const submitBtn = page.locator('button:has-text("Submit"):not([disabled])');
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
    }
    await page.waitForTimeout(3000);

    console.log('✅ Nomination submitted');

    // Step 4: Verify nomination appears
    console.log('\n📊 STEP 4: Verifying nomination appears...');
    
    const beforeEdit = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let foundTestNom = false;
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes('TestNom')) {
          foundTestNom = true;
          break;
        }
      }
      return foundTestNom;
    });

    console.log(`   TestNom visible: ${beforeEdit}`);
    
    if (!beforeEdit) {
      console.log('❌ CRITICAL: Nomination not visible after submission');
      return false;
    }

    // Step 5: Edit to delete nomination
    console.log('\n✏️ STEP 5: Editing to delete nomination...');
    
    await page.waitForSelector('button:has-text("Edit")', { timeout: 10000 });
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(2000);

    // Clear nomination field
    const nominationInputs = await page.locator('input[placeholder*="nomination"]').all();
    if (nominationInputs.length > 0) {
      await nominationInputs[0].fill('');
      console.log('   ✅ Cleared nomination field');
    }

    // Submit deletion
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);
    
    const confirmBtn = page.locator('button:has-text("Submit"):not([disabled])');
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
      console.log('   ✅ Confirmed deletion');
    }

    // Wait for fix to take effect
    await page.waitForTimeout(5000);

    // Step 6: Verify nomination is deleted
    console.log('\n🔍 STEP 6: Verifying nomination is deleted...');
    
    const afterEdit = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let foundTestNom = false;
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes('TestNom')) {
          foundTestNom = true;
          break;
        }
      }
      return foundTestNom;
    });

    console.log(`   TestNom still visible: ${afterEdit}`);

    // Step 7: Database verification
    console.log('\n🔍 STEP 7: Database verification...');
    
    const { data: votes } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .order('updated_at', { ascending: false });
      
    if (votes && votes.length > 0) {
      const vote = votes[0];
      console.log(`   Vote state: nominations=${JSON.stringify(vote.nominations)}, is_abstain=${vote.is_abstain}`);
      console.log(`   Vote updated: ${vote.created_at !== vote.updated_at}`);
    }

    // Analysis
    console.log('\n📊 FINAL ANALYSIS:');
    
    const dbShowsDeleted = votes && votes.length > 0 && votes[0].is_abstain === true;
    const uiShowsDeleted = !afterEdit;
    
    console.log(`   Database shows deleted: ${dbShowsDeleted}`);
    console.log(`   UI shows deleted: ${uiShowsDeleted}`);
    
    if (dbShowsDeleted && uiShowsDeleted) {
      console.log('🎉 SUCCESS: Deletion works perfectly!');
      return true;
    } else if (dbShowsDeleted && !uiShowsDeleted) {
      console.log('❌ FAILURE: Database updated but UI still shows nomination');
      console.log('   The fix needs more work - UI refresh is not working');
      return false;
    } else if (!dbShowsDeleted) {
      console.log('❌ FAILURE: Database was not updated correctly');
      return false;
    } else {
      console.log('❌ FAILURE: Unexpected state');
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    try {
      await page.screenshot({ path: 'verify-deletion-error.png' });
      console.log('📸 Error screenshot: verify-deletion-error.png');
    } catch (e) {}
    return false;
  } finally {
    await browser.close();
  }
}

verifyDeletionFix()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    console.log('🏁 VERIFICATION RESULT:', success ? '✅ PASSED' : '❌ FAILED');
    console.log('='.repeat(60));
    
    if (!success) {
      console.log('\n🔧 Next steps: Debug why the fix is not working');
    }
    
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
