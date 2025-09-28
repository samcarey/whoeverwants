#!/usr/bin/env node

/**
 * Complete end-to-end test of the exact user scenario:
 * 1. Create nomination poll
 * 2. Submit ballot with single nomination
 * 3. Edit ballot to add additional nomination
 * 4. Verify both nominations appear in results
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

async function testCompleteWorkflow() {
  console.log('🎯 Complete End-to-End Workflow Test');
  console.log('====================================');
  console.log('1. Create poll');
  console.log('2. Submit single nomination');
  console.log('3. Edit to add second nomination');
  console.log('4. Verify both show in results');

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
        title: 'Complete Workflow Test',
        poll_type: 'nomination',
        response_deadline: tomorrow.toISOString(),
        creator_name: 'WorkflowTest'
      })
      .select()
      .single();

    const pollId = poll.id;
    console.log(`✅ Poll created: ${pollId}`);

    // Step 2: Navigate to poll and submit SINGLE nomination
    console.log('\n🗳️ STEP 2: Submitting SINGLE nomination "FirstChoice"...');

    await page.goto(`http://localhost:3000/p/${pollId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Fill in single nomination
    await page.waitForSelector('input[placeholder*="nomination"]', { timeout: 10000 });
    await page.fill('input[placeholder*="nomination"]', 'FirstChoice');
    await page.fill('input[placeholder*="name"]', 'TestUser');

    // Submit the form
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(1000);

    // Handle confirmation modal
    try {
      // Wait for modal to appear first
      await page.waitForSelector('[role="dialog"], .modal', { timeout: 3000 });

      // Try different selectors for the modal submit button
      const modalSubmit = page.locator('[role="dialog"] button:has-text("Submit Vote"), .modal button:has-text("Submit Vote")').first();
      if (await modalSubmit.isVisible({ timeout: 3000 })) {
        await modalSubmit.click({ force: true }); // Force click to bypass overlay
        console.log('   ✅ Submitted via modal');
        await page.waitForTimeout(3000); // Wait for modal to close and page to refresh
      } else {
        console.log('   ✅ Submitted directly (no modal found)');
      }
    } catch (e) {
      console.log('   ⚠️ Modal handling error, trying fallback...');
      // Fallback: try to click any Submit Vote button that's visible
      try {
        await page.click('button:has-text("Submit Vote")', { force: true });
        console.log('   ✅ Submitted via fallback');
        await page.waitForTimeout(3000);
      } catch (e2) {
        console.log('   ❌ All modal submission attempts failed');
      }
    }

    await page.waitForTimeout(3000);

    // Step 3: Verify "FirstChoice" appears
    console.log('\n📊 STEP 3: Verifying "FirstChoice" appears...');

    const afterFirst = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('FirstChoice');
    });

    console.log(`   "FirstChoice" visible: ${afterFirst}`);

    if (!afterFirst) {
      console.log('❌ FirstChoice nomination not visible - test failed');
      await page.screenshot({ path: 'workflow-error-first.png' });
      return false;
    }

    // Step 4: Click Edit to add another nomination
    console.log('\n✏️ STEP 4: Editing to ADD "SecondChoice" nomination...');

    await page.waitForSelector('button:has-text("Edit")', { timeout: 10000 });
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(2000);

    // Get all nomination inputs
    const nominationInputs = await page.locator('input[placeholder*="nomination"]').all();
    console.log(`   Found ${nominationInputs.length} nomination input(s)`);

    // Check first input value
    if (nominationInputs.length > 0) {
      const firstValue = await nominationInputs[0].inputValue();
      console.log(`   First input value: "${firstValue}"`);
    }

    // Add second nomination
    let addedSecond = false;

    if (nominationInputs.length >= 2) {
      // Fill second field if it exists
      await nominationInputs[1].fill('SecondChoice');
      addedSecond = true;
      console.log('   ✅ Added "SecondChoice" to second field');
    } else {
      // Look for add button to create more fields
      try {
        const addButton = page.locator('button:has-text("Add"), button[title*="add"], button:has-text("+")').first();
        if (await addButton.isVisible({ timeout: 2000 })) {
          await addButton.click();
          await page.waitForTimeout(1000);

          const newInputs = await page.locator('input[placeholder*="nomination"]').all();
          if (newInputs.length > nominationInputs.length) {
            await newInputs[newInputs.length - 1].fill('SecondChoice');
            addedSecond = true;
            console.log('   ✅ Added "SecondChoice" via add button');
          }
        }
      } catch (e) {
        console.log('   ⚠️ No add button found, trying to use existing field');
        // Maybe there's only one field that can hold multiple values?
        if (nominationInputs.length > 0) {
          const currentValue = await nominationInputs[0].inputValue();
          await nominationInputs[0].fill(currentValue + ', SecondChoice');
          addedSecond = true;
          console.log('   ✅ Added "SecondChoice" to same field');
        }
      }
    }

    if (!addedSecond) {
      console.log('   ⚠️ Could not add second nomination - checking field structure');
      await page.screenshot({ path: 'workflow-edit-structure.png' });
    }

    // Submit the edit
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(1000);

    // Handle edit confirmation modal
    try {
      const editModalSubmit = page.locator('button:has-text("Submit Vote"):not([disabled])').first();
      if (await editModalSubmit.isVisible({ timeout: 5000 })) {
        await editModalSubmit.click();
        console.log('   ✅ Edit submitted via modal');
        await page.waitForTimeout(2000); // Wait for modal to close
      } else {
        console.log('   ✅ Edit submitted directly (no modal found)');
      }
    } catch (e) {
      console.log('   ⚠️ Edit modal handling error:', e.message);
    }

    await page.waitForTimeout(5000); // Wait for refresh

    // Step 5: Check final results
    console.log('\n🔍 STEP 5: Checking final results...');

    const finalResults = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasFirst: text.includes('FirstChoice'),
        hasSecond: text.includes('SecondChoice'),
        fullText: text.slice(0, 1000)
      };
    });

    console.log(`   "FirstChoice" visible: ${finalResults.hasFirst}`);
    console.log(`   "SecondChoice" visible: ${finalResults.hasSecond}`);

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
      console.log(`   Vote was updated: ${latestVote.created_at !== latestVote.updated_at}`);
    }

    // Final analysis
    console.log('\n📊 FINAL ANALYSIS:');

    const bothVisible = finalResults.hasFirst && finalResults.hasSecond;
    const dbCorrect = votes.length > 0 &&
                     Array.isArray(votes[0].nominations) &&
                     votes[0].nominations.length >= 2;

    console.log(`   UI shows both nominations: ${bothVisible}`);
    console.log(`   Database has multiple nominations: ${dbCorrect}`);
    console.log(`   Added second nomination: ${addedSecond}`);

    // Take final screenshot
    await page.screenshot({ path: 'workflow-final-result.png' });
    console.log('   📸 Final screenshot saved: workflow-final-result.png');

    if (bothVisible && dbCorrect) {
      console.log('\n✅ SUCCESS: Complete workflow works correctly!');
      return true;
    } else if (!addedSecond) {
      console.log('\n⚠️ ISSUE: Could not add second nomination via UI');
      return false;
    } else if (!bothVisible) {
      console.log('\n❌ ISSUE: Added nominations but not displaying in UI');
      return false;
    } else {
      console.log('\n❌ ISSUE: Database not storing multiple nominations correctly');
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    await page.screenshot({ path: 'workflow-error.png' });
    return false;
  } finally {
    await browser.close();
  }
}

testCompleteWorkflow()
  .then(success => {
    console.log('\n' + '='.repeat(70));
    console.log('🏁 COMPLETE WORKFLOW TEST:', success ? '✅ WORKS PERFECTLY' : '❌ NEEDS FIXING');
    console.log('='.repeat(70));
  });