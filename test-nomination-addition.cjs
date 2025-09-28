#!/usr/bin/env node

/**
 * Test the nomination addition bug:
 * 1. Create poll, submit "FirstNom"
 * 2. Edit to add "SecondNom" (so ballot has both FirstNom + SecondNom)
 * 3. Verify BOTH nominations appear in results
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

async function testNominationAddition() {
  console.log('🔍 Testing Nomination Addition Bug');
  console.log('==================================');
  console.log('Expected: Edit to add nomination should show BOTH nominations');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, serviceKey);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Step 1: Create poll via API
    console.log('\n📝 STEP 1: Creating nomination poll...');
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        title: 'Addition Test Poll',
        poll_type: 'nomination', 
        response_deadline: tomorrow.toISOString(),
        creator_name: 'AdditionTest'
      })
      .select()
      .single();
      
    if (pollError) throw new Error(`Poll creation failed: ${pollError.message}`);
    const pollId = poll.id;
    console.log(`✅ Poll created: ${pollId}`);

    // Step 2: Submit first nomination
    console.log('\n🗳️ STEP 2: Submitting first nomination "FirstNom"...');
    
    await page.goto(`http://localhost:3000/p/${pollId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await page.waitForSelector('input[placeholder*="nomination"]', { timeout: 10000 });
    await page.fill('input[placeholder*="nomination"]', 'FirstNom');
    await page.fill('input[placeholder*="name"]', 'AdditionUser');

    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);
    
    // Handle confirmation modal
    try {
      const submitBtn = page.locator('button:has-text("Submit"):not([disabled])').first();
      if (await submitBtn.isVisible({ timeout: 3000 })) {
        await submitBtn.click();
      }
    } catch (e) {
      console.log('   No modal or already submitted');
    }
    
    await page.waitForTimeout(3000);
    console.log('✅ First nomination submitted');

    // Step 3: Verify first nomination appears
    console.log('\n📊 STEP 3: Verifying "FirstNom" appears...');
    
    const afterFirst = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let foundFirst = false;
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes('FirstNom')) {
          foundFirst = true;
          break;
        }
      }
      return foundFirst;
    });

    console.log(`   FirstNom visible: ${afterFirst}`);
    if (!afterFirst) {
      console.log('❌ CRITICAL: First nomination not visible, cannot test addition');
      return false;
    }

    // Step 4: Edit to ADD second nomination
    console.log('\n✏️ STEP 4: Editing to ADD "SecondNom" (should have BOTH)...');
    
    await page.waitForSelector('button:has-text("Edit")', { timeout: 10000 });
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(2000);

    // Find nomination inputs and add second nomination
    const nominationInputs = await page.locator('input[placeholder*="nomination"]').all();
    console.log(`   Found ${nominationInputs.length} nomination input field(s)`);
    
    if (nominationInputs.length >= 2) {
      // Fill second field with new nomination
      await nominationInputs[1].fill('SecondNom');
      console.log('   ✅ Added SecondNom to second field');
    } else if (nominationInputs.length === 1) {
      // Check what's in the first field and add second nomination
      const firstValue = await nominationInputs[0].inputValue();
      console.log(`   First field value: "${firstValue}"`);
      
      // Look for add button or way to add another nomination
      const addButtons = await page.locator('button:has-text("Add"), button[title*="add"], button:has-text("+")').all();
      if (addButtons.length > 0) {
        await addButtons[0].click();
        await page.waitForTimeout(1000);
        const newInputs = await page.locator('input[placeholder*="nomination"]').all();
        if (newInputs.length > 1) {
          await newInputs[1].fill('SecondNom');
          console.log('   ✅ Added SecondNom via add button');
        }
      } else {
        // Try filling multiple nominations in one field (comma-separated or similar)
        await nominationInputs[0].fill(`${firstValue}, SecondNom`);
        console.log('   ⚠️ Tried adding SecondNom to same field');
      }
    }

    // Submit the edit
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);
    
    try {
      const editSubmitBtn = page.locator('button:has-text("Submit"):not([disabled])').first();
      if (await editSubmitBtn.isVisible({ timeout: 3000 })) {
        await editSubmitBtn.click();
      }
    } catch (e) {
      console.log('   No modal or already submitted');
    }
    
    await page.waitForTimeout(5000); // Wait for updates
    console.log('   ✅ Edit submitted');

    // Step 5: Check what nominations appear after edit
    console.log('\n🔍 STEP 5: Checking nominations after edit...');
    
    const afterEdit = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let foundFirst = false;
      let foundSecond = false;
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent) {
          if (node.textContent.includes('FirstNom')) foundFirst = true;
          if (node.textContent.includes('SecondNom')) foundSecond = true;
        }
      }
      return { foundFirst, foundSecond };
    });

    console.log(`   FirstNom visible: ${afterEdit.foundFirst}`);
    console.log(`   SecondNom visible: ${afterEdit.foundSecond}`);

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

    // Check results query
    const { data: resultsVotes } = await supabase
      .from('votes')
      .select('nominations')
      .eq('poll_id', pollId)
      .eq('vote_type', 'nomination')
      .eq('is_abstain', false)
      .not('nominations', 'is', null);
      
    console.log(`   Results query returned: ${resultsVotes.length} vote(s)`);
    resultsVotes.forEach((vote, i) => {
      console.log(`   Vote ${i + 1} nominations: ${JSON.stringify(vote.nominations)}`);
    });

    // Final analysis
    console.log('\n📊 FINAL ANALYSIS:');
    
    const dbHasBoth = votes.length > 0 && votes[0].nominations && 
                     votes[0].nominations.includes('FirstNom') && 
                     votes[0].nominations.includes('SecondNom');
                     
    const uiShowsBoth = afterEdit.foundFirst && afterEdit.foundSecond;
    
    console.log(`   Database has both nominations: ${dbHasBoth}`);
    console.log(`   UI shows both nominations: ${uiShowsBoth}`);
    
    if (dbHasBoth && uiShowsBoth) {
      console.log('🎉 SUCCESS: Nomination addition works correctly!');
      console.log('   ✅ Database updated with both nominations');
      console.log('   ✅ UI shows both nominations');
      return true;
    } else if (!dbHasBoth) {
      console.log('❌ FAILURE: Database not updated correctly');
      console.log('   Issue with vote update mechanism');
      return false;
    } else if (!uiShowsBoth) {
      console.log('❌ FAILURE: UI not showing both nominations');
      console.log('   Issue with results display or refresh');
      return false;
    } else {
      console.log('❓ UNEXPECTED: Unusual state');
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    await page.screenshot({ path: 'addition-test-error.png' });
    return false;
  } finally {
    await browser.close();
  }
}

testNominationAddition()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    console.log('🏁 ADDITION TEST:', success ? '✅ WORKS!' : '❌ BROKEN');
    console.log('='.repeat(60));
    
    if (!success) {
      console.log('\n🔧 If test failed, the bug is confirmed:');
      console.log('   Adding nominations via edit only shows original');
    }
  });
