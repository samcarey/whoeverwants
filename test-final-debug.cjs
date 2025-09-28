#!/usr/bin/env node

/**
 * Final comprehensive test to check both database and frontend state
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

async function finalDebugTest() {
  console.log('🎯 Final Debug Test: Database vs Frontend');
  console.log('==========================================');

  // Setup Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST || '';
  const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY || '';
  const supabase = createClient(supabaseUrl, supabaseKey);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let pollId = '';

  try {
    // Step 1: Create poll and get ID
    console.log('\n✅ Step 1: Creating nomination poll...');
    await page.goto('http://localhost:3000/create-poll', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(2000);
    await page.fill('input#title', 'Final Debug Test');
    await page.click('button:has-text("Suggestions")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Submit")');

    await page.waitForSelector('text=Create Poll', { timeout: 5000 });
    await page.click('button:has-text("Create Poll")');

    await page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 10000 });
    const pollUrl = page.url();
    pollId = pollUrl.split('/').pop();
    console.log(`   Poll created: ${pollUrl}`);
    console.log(`   Poll ID: ${pollId}`);

    // Wait for components to load
    await page.waitForTimeout(5000);
    await page.waitForFunction(() => document.querySelectorAll('input').length > 0, { timeout: 10000 });

    // Step 2: Submit initial vote "A"
    console.log('\n✅ Step 2: Submitting vote "A"...');

    const nominationInput = await page.locator('input[placeholder*="nomination"]').first();
    await nominationInput.fill('A');
    await nominationInput.press('Enter');
    await page.waitForTimeout(1000);

    const voterNameInput = await page.locator('input[placeholder*="name"]').first();
    await voterNameInput.fill('FinalTester');

    await page.click('button:has-text("Submit Vote")');

    // Handle modal
    await page.waitForSelector('div[id="modal-root"] div', { state: 'visible', timeout: 10000 });
    const modalSubmitButton = await page.locator('div[id="modal-root"] button:has-text("Submit Vote")');
    await modalSubmitButton.waitFor({ state: 'visible', timeout: 5000 });
    await modalSubmitButton.click();
    await page.waitForTimeout(5000);

    // Check database state after initial vote
    console.log('\n🔍 Database after vote "A":');
    const { data: votesAfterA } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .eq('vote_type', 'nomination');

    if (votesAfterA) {
      votesAfterA.forEach((vote, i) => {
        console.log(`   Vote ${i+1}: ${JSON.stringify(vote.nominations)} (ID: ${vote.id.slice(0,8)}...)`);
      });
    }

    // Check frontend state after initial vote
    console.log('\n🔍 Frontend after vote "A":');
    const hasAAfterVote = await page.isVisible('text=A');
    const hasBAfterVote = await page.isVisible('text=B');
    const hasEditButton = await page.isVisible('button:has-text("Edit")');
    console.log(`   Frontend shows A: ${hasAAfterVote}`);
    console.log(`   Frontend shows B: ${hasBAfterVote}`);
    console.log(`   Edit button visible: ${hasEditButton}`);

    if (!hasEditButton) {
      console.log('❌ No edit button - initial vote failed');
      return false;
    }

    // Step 3: Edit vote to "B"
    console.log('\n✅ Step 3: Editing vote to "B"...');

    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(2000);

    const editInput = await page.locator('input[placeholder*="nomination"]').first();
    await editInput.clear();
    await editInput.fill('B');
    await editInput.press('Enter');
    await page.waitForTimeout(1000);

    await page.click('button:has-text("Submit Vote")');

    // Handle edit modal
    try {
      await page.waitForSelector('div[id="modal-root"] div', { state: 'visible', timeout: 10000 });
      const editModalSubmitButton = await page.locator('div[id="modal-root"] button:has-text("Submit Vote")');
      await editModalSubmitButton.waitFor({ state: 'visible', timeout: 5000 });
      await editModalSubmitButton.click();
      await page.waitForTimeout(5000);
    } catch (e) {
      console.log('   Edit modal handling failed, trying direct click');
      await page.waitForTimeout(3000);
    }

    // Check database state after edit
    console.log('\n🔍 Database after edit to "B":');
    const { data: votesAfterB } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .eq('vote_type', 'nomination')
      .order('updated_at', { ascending: false });

    if (votesAfterB) {
      console.log(`   Total votes in database: ${votesAfterB.length}`);
      votesAfterB.forEach((vote, i) => {
        console.log(`   Vote ${i+1}: ${JSON.stringify(vote.nominations)} (ID: ${vote.id.slice(0,8)}..., updated: ${vote.updated_at})`);
      });

      if (votesAfterB.length === 1) {
        console.log('   ✅ Good: Only one vote in database');
        const singleVote = votesAfterB[0];
        if (JSON.stringify(singleVote.nominations) === '["B"]') {
          console.log('   ✅ Perfect: Vote was updated to ["B"]');
        } else {
          console.log(`   ❌ Issue: Vote contains ${JSON.stringify(singleVote.nominations)}, expected ["B"]`);
        }
      } else {
        console.log(`   ❌ Problem: ${votesAfterB.length} votes found, expected 1`);
      }
    }

    // Check frontend state after edit
    console.log('\n🔍 Frontend after edit to "B":');
    await page.waitForTimeout(3000); // Give frontend time to update

    const hasAAfterEdit = await page.isVisible('text=A');
    const hasBAfterEdit = await page.isVisible('text=B');
    console.log(`   Frontend shows A: ${hasAAfterEdit}`);
    console.log(`   Frontend shows B: ${hasBAfterEdit}`);

    // Detailed frontend analysis
    if (hasAAfterEdit && hasBAfterEdit) {
      console.log('   📍 FRONTEND BUG: Shows both A and B (even if database is correct)');
    } else if (hasAAfterEdit && !hasBAfterEdit) {
      console.log('   📍 EDIT FAILED: Still shows only A (edit did not work)');
    } else if (!hasAAfterEdit && hasBAfterEdit) {
      console.log('   ✅ PERFECT: Shows only B (edit worked correctly)');
    } else {
      console.log('   📍 STRANGE: Shows neither A nor B');
    }

    // Final verdict
    const databaseCorrect = votesAfterB && votesAfterB.length === 1 && JSON.stringify(votesAfterB[0].nominations) === '["B"]';
    const frontendCorrect = !hasAAfterEdit && hasBAfterEdit;

    console.log('\n🏁 FINAL VERDICT:');
    console.log(`   Database state: ${databaseCorrect ? '✅ CORRECT' : '❌ INCORRECT'}`);
    console.log(`   Frontend state: ${frontendCorrect ? '✅ CORRECT' : '❌ INCORRECT'}`);

    if (databaseCorrect && frontendCorrect) {
      console.log('   🎉 FULL SUCCESS: Both database and frontend work correctly!');
      return true;
    } else if (databaseCorrect && !frontendCorrect) {
      console.log('   🔧 PARTIAL: Database fixed, but frontend display issue remains');
      return false;
    } else if (!databaseCorrect && frontendCorrect) {
      console.log('   🤔 WEIRD: Frontend correct but database wrong');
      return false;
    } else {
      console.log('   💥 FAILURE: Both database and frontend have issues');
      return false;
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'final-debug-error.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
finalDebugTest()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    console.log('🏁 Final Test Result:', success ? '✅ PASSED' : '❌ FAILED');
    console.log('='.repeat(60));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });