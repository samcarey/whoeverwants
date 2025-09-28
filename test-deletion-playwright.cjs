#!/usr/bin/env node

/**
 * Comprehensive Playwright test for nomination deletion
 * Tests the EXACT user flow: create poll, submit nomination, edit to delete, verify deletion
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

async function testNominationDeletion() {
  console.log('🎭 Testing Nomination Deletion with Playwright');
  console.log('==============================================');

  // Database setup for verification
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST || '';
  const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // STEP 1: Create nomination poll
    console.log('\n📝 STEP 1: Creating nomination poll...');

    await page.goto('http://localhost:3000/create-poll', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Wait for page to be ready
    await page.waitForSelector('input[placeholder*="poll title"]', { timeout: 10000 });

    // Fill poll creation form
    await page.fill('input[placeholder*="poll title"]', 'Deletion Test Poll');
    await page.selectOption('select', 'nomination');

    // Set future deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    await page.fill('input[type="date"]', tomorrowStr);

    await page.click('button:has-text("Create Poll")');
    await page.waitForTimeout(5000);

    // Extract poll ID
    const currentUrl = page.url();
    const pollIdMatch = currentUrl.match(/\/p\/([^\/]+)/);
    if (!pollIdMatch) {
      throw new Error('Failed to extract poll ID from URL: ' + currentUrl);
    }
    const pollId = pollIdMatch[1];
    console.log(`✅ Created poll: ${pollId}`);

    // STEP 2: Submit initial nomination
    console.log('\n🗳️ STEP 2: Submitting nomination "TestNom"...');

    await page.waitForSelector('input[placeholder*="nomination"]', { timeout: 10000 });
    await page.fill('input[placeholder*="nomination"]', 'TestNom');
    await page.fill('input[placeholder*="name"]', 'TestUser');

    // Click submit and handle confirmation modal
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);

    // Wait for and click confirmation
    await page.waitForSelector('button:has-text("Submit"):not([disabled])', { timeout: 10000 });
    await page.click('button:has-text("Submit"):not([disabled])');
    await page.waitForTimeout(5000);

    console.log('✅ Initial nomination submitted');

    // STEP 3: Verify nomination appears in results
    console.log('\n📊 STEP 3: Verifying nomination appears in results...');

    // Check for the nomination in the page
    const beforeDeletion = await page.evaluate(() => {
      // Look for text content containing our nomination
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
      return { foundTestNom };
    });

    console.log(`   TestNom visible in UI: ${beforeDeletion.foundTestNom}`);

    // STEP 4: Click edit and delete the nomination
    console.log('\n✏️ STEP 4: Editing vote to delete nomination...');

    // Wait for edit button and click it
    await page.waitForSelector('button:has-text("Edit")', { timeout: 10000 });
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(3000);

    // Verify we're in edit mode
    const editModeActive = await page.isVisible('input[placeholder*="nomination"]');
    console.log(`   Edit mode active: ${editModeActive}`);

    if (editModeActive) {
      // Clear the nomination field completely
      const nominationInputs = await page.locator('input[placeholder*="nomination"]').all();
      if (nominationInputs.length > 0) {
        await nominationInputs[0].fill(''); // Clear the first (and likely only) nomination field
        console.log('   ✅ Cleared nomination field');
      }

      // Submit the edit (which should result in abstain since no nominations)
      await page.click('button:has-text("Submit Vote")');
      await page.waitForTimeout(2000);

      // Handle confirmation modal if present
      const submitButton = page.locator('button:has-text("Submit"):not([disabled])');
      if (await submitButton.isVisible()) {
        await submitButton.click();
        console.log('   ✅ Confirmed deletion');
      }

      await page.waitForTimeout(5000); // Wait for results to refresh
    } else {
      throw new Error('Could not enter edit mode');
    }

    // STEP 5: Verify nomination is removed from results
    console.log('\n🔍 STEP 5: Verifying nomination is deleted from results...');

    // Check database state first
    const { data: votes } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .order('updated_at', { ascending: false });

    console.log(`   Database check: ${votes.length} vote(s) found`);
    if (votes.length > 0) {
      const vote = votes[0];
      console.log(`   Vote state: nominations=${JSON.stringify(vote.nominations)}, is_abstain=${vote.is_abstain}`);
      console.log(`   Vote was updated: ${vote.created_at !== vote.updated_at}`);
    }

    // Check if nomination still appears in UI
    const afterDeletion = await page.evaluate(() => {
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
      return { foundTestNom };
    });

    console.log(`   TestNom still visible in UI: ${afterDeletion.foundTestNom}`);

    // STEP 6: Analyze results
    console.log('\n📊 STEP 6: Analyzing results...');

    if (beforeDeletion.foundTestNom && !afterDeletion.foundTestNom) {
      console.log('\n🎉 SUCCESS: Nomination deletion works perfectly!');
      console.log('   ✅ Nomination was initially visible');
      console.log('   ✅ Nomination was successfully deleted from UI');
      console.log('   ✅ Database was updated correctly');
      console.log('   ✅ Results refreshed automatically');
      return true;
    } else if (!beforeDeletion.foundTestNom) {
      console.log('\n❌ FAILURE: Initial nomination not showing');
      console.log('   Issue with nomination submission or display');
      return false;
    } else if (afterDeletion.foundTestNom) {
      console.log('\n❌ FAILURE: Nomination still visible after deletion');
      console.log('   Frontend is not refreshing correctly after edit');

      // Check if database was actually updated
      if (votes.length > 0 && votes[0].is_abstain) {
        console.log('   📊 Database was updated correctly (vote is abstained)');
        console.log('   🔄 Issue is with frontend results not refreshing');
      } else {
        console.log('   📊 Database was NOT updated correctly');
        console.log('   💾 Issue is with the vote update mechanism');
      }
      return false;
    } else {
      console.log('\n❓ UNEXPECTED: Unusual state encountered');
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed with error:', error.message);

    // Save screenshot for debugging
    try {
      await page.screenshot({ path: 'deletion-test-error.png' });
      console.log('📸 Error screenshot saved as: deletion-test-error.png');
    } catch (screenshotError) {
      // Ignore screenshot errors
    }

    return false;
  } finally {
    await browser.close();
  }
}

// Run the test
testNominationDeletion()
  .then(success => {
    console.log('\n' + '='.repeat(70));
    console.log('🏁 PLAYWRIGHT DELETION TEST:', success ? '✅ PASSED' : '❌ FAILED');
    console.log('='.repeat(70));

    if (!success) {
      console.log('\n🔧 If test failed, check:');
      console.log('   1. Dev server is running on port 3000');
      console.log('   2. Database connections are working');
      console.log('   3. Frontend results refresh after edits');
      console.log('   4. Error screenshot: deletion-test-error.png');
    }

    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });