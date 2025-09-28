#!/usr/bin/env node

/**
 * Test the NEW reported issue:
 * 1. Create nomination poll
 * 2. Submit ballot with one nomination (e.g., "First")
 * 3. Edit ballot to have 2 nominations (e.g., "First", "Second")
 * 4. Resubmit ballot
 * 5. Expected: Both nominations show
 * 6. Actual bug: Only the 2nd nomination shows
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

async function testSecondNominationOnly() {
  console.log('🎯 Testing NEW Bug: Only 2nd Nomination Shows');
  console.log('==============================================');
  console.log('1. Submit "FirstNom"');
  console.log('2. Edit to have "FirstNom" + "SecondNom"');
  console.log('3. Check if BOTH show (expected) vs only SecondNom (bug)');

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
        title: 'Second Nomination Bug Test',
        poll_type: 'nomination',
        response_deadline: tomorrow.toISOString(),
        creator_name: 'BugTest'
      })
      .select()
      .single();

    const pollId = poll.id;
    console.log(`✅ Poll created: ${pollId}`);

    // Step 2: Navigate to poll and submit FIRST nomination
    console.log('\n🗳️ STEP 2: Submitting FIRST nomination "FirstNom"...');

    await page.goto(`http://localhost:3000/p/${pollId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await page.waitForSelector('input[placeholder*="nomination"]', { timeout: 10000 });
    await page.fill('input[placeholder*="nomination"]', 'FirstNom');
    await page.fill('input[placeholder*="name"]', 'TestUser');

    // Submit the form - this should work from the logs I've seen
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);

    // Handle modal if it appears
    try {
      const modal = await page.waitForSelector('[role="dialog"], .modal-content', { timeout: 3000 });
      if (modal) {
        const submitBtn = await page.locator('[role="dialog"] button:has-text("Submit"), .modal-content button:has-text("Submit")').first();
        if (await submitBtn.isVisible({ timeout: 2000 })) {
          await submitBtn.click();
          console.log('   ✅ First submission confirmed via modal');
        }
      }
    } catch (e) {
      console.log('   ✅ First submission completed');
    }

    await page.waitForTimeout(5000); // Wait for page refresh

    // Step 3: Verify first nomination appears
    console.log('\n📊 STEP 3: Verifying "FirstNom" appears...');

    const afterFirst = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasFirstNom: text.includes('FirstNom'),
        bodyText: text
      };
    });

    console.log(`   "FirstNom" visible: ${afterFirst.hasFirstNom}`);

    if (!afterFirst.hasFirstNom) {
      console.log('❌ FirstNom not visible after submission');
      await page.screenshot({ path: 'second-bug-no-first.png' });

      // Check database to see if vote was recorded
      const { data: votes } = await supabase
        .from('votes')
        .select('*')
        .eq('poll_id', pollId);
      console.log(`   Database votes: ${votes.length}`);

      if (votes.length === 0) {
        console.log('❌ Vote not recorded in database - submission failed');
        return false;
      }
    }

    // Step 4: Edit to add second nomination
    console.log('\n✏️ STEP 4: Editing to add "SecondNom" alongside "FirstNom"...');

    await page.waitForSelector('button:has-text("Edit")', { timeout: 10000 });
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(2000);

    // Look for nomination inputs
    const nominationInputs = await page.locator('input[placeholder*="nomination"]').all();
    console.log(`   Found ${nominationInputs.length} nomination input(s)`);

    // Check what's in the first input
    if (nominationInputs.length > 0) {
      const firstValue = await nominationInputs[0].inputValue();
      console.log(`   First input contains: "${firstValue}"`);
    }

    // Add second nomination to second field or create it
    let addedSecond = false;

    if (nominationInputs.length >= 2) {
      // Fill second field
      await nominationInputs[1].fill('SecondNom');
      addedSecond = true;
      console.log('   ✅ Added "SecondNom" to second field');
    } else {
      // Try to add a new field
      try {
        const addButton = page.locator('button:has-text("Add"), button[title*="add"], button:has-text("+")').first();
        if (await addButton.isVisible({ timeout: 2000 })) {
          await addButton.click();
          await page.waitForTimeout(1000);

          const newInputs = await page.locator('input[placeholder*="nomination"]').all();
          if (newInputs.length > nominationInputs.length) {
            await newInputs[newInputs.length - 1].fill('SecondNom');
            addedSecond = true;
            console.log('   ✅ Added "SecondNom" via add button');
          }
        }
      } catch (e) {
        console.log('   ⚠️ No add button found');
      }
    }

    if (!addedSecond) {
      console.log('❌ Could not add second nomination');
      await page.screenshot({ path: 'second-bug-cant-add.png' });
      return false;
    }

    // Submit the edit
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);

    // Handle edit modal
    try {
      const editModal = await page.waitForSelector('[role="dialog"], .modal-content', { timeout: 3000 });
      if (editModal) {
        const editSubmitBtn = await page.locator('[role="dialog"] button:has-text("Submit"), .modal-content button:has-text("Submit")').first();
        if (await editSubmitBtn.isVisible({ timeout: 2000 })) {
          await editSubmitBtn.click();
          console.log('   ✅ Edit confirmed via modal');
        }
      }
    } catch (e) {
      console.log('   ✅ Edit completed');
    }

    await page.waitForTimeout(5000); // Wait for refresh

    // Step 5: Check what shows after edit
    console.log('\n🔍 STEP 5: Checking results after edit...');

    const afterEdit = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasFirstNom: text.includes('FirstNom'),
        hasSecondNom: text.includes('SecondNom'),
        fullText: text.slice(0, 1000)
      };
    });

    console.log(`   "FirstNom" visible: ${afterEdit.hasFirstNom}`);
    console.log(`   "SecondNom" visible: ${afterEdit.hasSecondNom}`);

    // Step 6: Database verification
    console.log('\n🔍 STEP 6: Database verification...');

    const { data: finalVotes } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .order('updated_at', { ascending: false });

    console.log(`   Total votes: ${finalVotes.length}`);
    if (finalVotes.length > 0) {
      const latestVote = finalVotes[0];
      console.log(`   Latest vote nominations: ${JSON.stringify(latestVote.nominations)}`);
      console.log(`   Vote was updated: ${latestVote.created_at !== latestVote.updated_at}`);
    }

    // Final analysis
    console.log('\n📊 BUG ANALYSIS:');

    const bothVisible = afterEdit.hasFirstNom && afterEdit.hasSecondNom;
    const onlySecondVisible = !afterEdit.hasFirstNom && afterEdit.hasSecondNom;
    const dbHasBoth = finalVotes.length > 0 &&
                     finalVotes[0].nominations &&
                     finalVotes[0].nominations.length >= 2;

    console.log(`   UI shows both nominations: ${bothVisible}`);
    console.log(`   UI shows only 2nd nomination: ${onlySecondVisible}`);
    console.log(`   Database has both nominations: ${dbHasBoth}`);

    await page.screenshot({ path: 'second-bug-final.png' });
    console.log('   📸 Final screenshot saved');

    if (onlySecondVisible && dbHasBoth) {
      console.log('\n🎯 BUG CONFIRMED: Database has both but UI only shows 2nd nomination');
      console.log('   This is the exact issue the user reported!');
      return false;
    } else if (bothVisible) {
      console.log('\n✅ NO BUG: Both nominations showing correctly');
      return true;
    } else {
      console.log('\n❓ UNCLEAR: Different issue than expected');
      console.log(`   Full page text: ${afterEdit.fullText}`);
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    await page.screenshot({ path: 'second-bug-error.png' });
    return false;
  } finally {
    await browser.close();
  }
}

testSecondNominationOnly()
  .then(success => {
    console.log('\n' + '='.repeat(70));
    console.log('🏁 SECOND NOMINATION BUG TEST:', success ? '✅ NO BUG FOUND' : '❌ BUG CONFIRMED');
    console.log('='.repeat(70));
  });