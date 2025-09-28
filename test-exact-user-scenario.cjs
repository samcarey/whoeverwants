#!/usr/bin/env node

/**
 * Test the EXACT user scenario:
 * 1. Create nomination poll
 * 2. Submit ballot with single nomination  
 * 3. Edit ballot to add additional nomination
 * 4. Verify both nominations appear
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

async function testExactUserScenario() {
  console.log('🎯 Testing EXACT User Scenario');
  console.log('===============================');
  console.log('1. Submit single nomination');
  console.log('2. Edit to ADD another nomination');
  console.log('3. Verify BOTH show in results');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, serviceKey);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Step 1: Create fresh poll
    console.log('\n📝 STEP 1: Creating fresh nomination poll...');
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const { data: poll } = await supabase
      .from('polls')
      .insert({
        title: 'Exact User Scenario Test',
        poll_type: 'nomination', 
        response_deadline: tomorrow.toISOString(),
        creator_name: 'ExactTest'
      })
      .select()
      .single();
      
    const pollId = poll.id;
    console.log(`✅ Poll created: ${pollId}`);

    // Step 2: Navigate to poll and submit SINGLE nomination
    console.log('\n🗳️ STEP 2: Submitting SINGLE nomination "Original"...');
    
    await page.goto(`http://localhost:3000/p/${pollId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await page.waitForSelector('input[placeholder*="nomination"]', { timeout: 10000 });
    await page.fill('input[placeholder*="nomination"]', 'Original');
    await page.fill('input[placeholder*="name"]', 'ExactUser');

    // Submit the form
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);
    
    // Handle any modal
    try {
      const modalSubmit = page.locator('button:has-text("Submit"):not([disabled])').first();
      if (await modalSubmit.isVisible({ timeout: 2000 })) {
        await modalSubmit.click();
        console.log('   ✅ Submitted via modal');
      } else {
        console.log('   ✅ Submitted directly (no modal)');
      }
    } catch (e) {
      console.log('   ✅ Submitted (modal handling skipped)');
    }
    
    await page.waitForTimeout(3000);

    // Step 3: Verify "Original" appears
    console.log('\n📊 STEP 3: Verifying "Original" appears...');
    
    const afterOriginal = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Original');
    });

    console.log(`   "Original" visible: ${afterOriginal}`);
    
    if (!afterOriginal) {
      console.log('❌ Original nomination not visible - cannot test addition');
      await page.screenshot({ path: 'exact-test-error-1.png' });
      return false;
    }

    // Step 4: Click Edit to add another nomination
    console.log('\n✏️ STEP 4: Editing to ADD "Additional" nomination...');
    
    await page.waitForSelector('button:has-text("Edit")', { timeout: 10000 });
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(2000);

    // Check what nomination inputs are available
    const nominationInputs = await page.locator('input[placeholder*="nomination"]').all();
    console.log(`   Found ${nominationInputs.length} nomination input(s)`);
    
    // Check first input value
    if (nominationInputs.length > 0) {
      const firstValue = await nominationInputs[0].inputValue();
      console.log(`   First input value: "${firstValue}"`);
    }

    // Try to add second nomination
    let addedSecondNomination = false;
    
    if (nominationInputs.length >= 2) {
      // Fill second field
      await nominationInputs[1].fill('Additional');
      addedSecondNomination = true;
      console.log('   ✅ Added "Additional" to second field');
    } else {
      // Look for add button
      try {
        const addButton = page.locator('button:has-text("Add"), button[title*="add"], button:has-text("+")').first();
        if (await addButton.isVisible({ timeout: 2000 })) {
          await addButton.click();
          await page.waitForTimeout(1000);
          
          const newInputs = await page.locator('input[placeholder*="nomination"]').all();
          if (newInputs.length > nominationInputs.length) {
            await newInputs[newInputs.length - 1].fill('Additional');
            addedSecondNomination = true;
            console.log('   ✅ Added "Additional" via add button');
          }
        }
      } catch (e) {
        console.log('   ⚠️ No add button found');
      }
    }

    if (!addedSecondNomination) {
      console.log('   ⚠️ Could not add second nomination - UI might not support it');
      console.log('   This could be the source of the user\'s issue');
    }

    // Submit the edit
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);
    
    try {
      const editModalSubmit = page.locator('button:has-text("Submit"):not([disabled])').first();
      if (await editModalSubmit.isVisible({ timeout: 2000 })) {
        await editModalSubmit.click();
        console.log('   ✅ Edit submitted via modal');
      } else {
        console.log('   ✅ Edit submitted directly');
      }
    } catch (e) {
      console.log('   ✅ Edit submitted');
    }
    
    await page.waitForTimeout(5000); // Wait for refresh

    // Step 5: Check what's visible after edit
    console.log('\n🔍 STEP 5: Checking results after edit...');
    
    const afterEdit = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasOriginal: text.includes('Original'),
        hasAdditional: text.includes('Additional'),
        fullText: text.slice(0, 1000) // First 1000 chars for debugging
      };
    });

    console.log(`   "Original" visible: ${afterEdit.hasOriginal}`);
    console.log(`   "Additional" visible: ${afterEdit.hasAdditional}`);
    
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
      console.log(`   Latest vote nominations: ${JSON.stringify(latestVote.nominations)}`);
      console.log(`   Latest vote is_abstain: ${latestVote.is_abstain}`);
      console.log(`   Vote was updated: ${latestVote.created_at !== latestVote.updated_at}`);
    }

    // Final analysis
    console.log('\n📊 FINAL ANALYSIS:');
    
    const bothVisible = afterEdit.hasOriginal && afterEdit.hasAdditional;
    const dbCorrect = votes.length > 0 && votes[0].nominations && 
                     votes[0].nominations.includes('Original');
                     
    console.log(`   UI shows both nominations: ${bothVisible}`);
    console.log(`   Database has correct data: ${dbCorrect}`);
    console.log(`   Added second nomination successfully: ${addedSecondNomination}`);
    
    if (!addedSecondNomination) {
      console.log('\n🎯 LIKELY ISSUE: UI doesn\'t support adding multiple nominations in edit mode');
      console.log('   This matches the user\'s reported behavior');
      return false;
    } else if (bothVisible) {
      console.log('\n✅ SUCCESS: User scenario works correctly');
      return true;
    } else {
      console.log('\n❌ ISSUE: Added nomination but not showing in UI');
      await page.screenshot({ path: 'exact-test-issue.png' });
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    await page.screenshot({ path: 'exact-test-error.png' });
    return false;
  } finally {
    await browser.close();
  }
}

testExactUserScenario()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    console.log('🏁 EXACT SCENARIO TEST:', success ? '✅ WORKS' : '❌ ISSUE FOUND');
    console.log('='.repeat(60));
    
    if (!success) {
      console.log('\n🔧 Next: Fix the nomination UI to support adding multiple nominations in edit mode');
    }
  });
