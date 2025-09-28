#!/usr/bin/env node

/**
 * Test to verify the nomination editing fix works correctly
 * This test checks that A → B edit results in just B, not A+B
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

async function testEditFix() {
  console.log('🧪 Testing Nomination Edit Fix');
  console.log('==============================');

  // Database setup
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
    // STEP 1: Create a fresh nomination poll
    console.log('\n📝 STEP 1: Creating nomination poll...');

    await page.goto('http://localhost:3000/create-poll', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Wait for page to be ready
    await page.waitForSelector('input[placeholder*="poll title"]', { timeout: 20000 });

    // Fill poll creation form
    await page.fill('input[placeholder*="poll title"]', 'Edit Fix Test Poll');
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

    // STEP 2: Submit initial vote with "A"
    console.log('\n🗳️ STEP 2: Voting for "A"...');

    await page.waitForSelector('input[placeholder*="nomination"]', { timeout: 10000 });
    await page.fill('input[placeholder*="nomination"]', 'A');
    await page.fill('input[placeholder*="name"]', 'TestUser');

    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(3000);

    // Wait for page refresh
    await page.waitForSelector('button:has-text("Edit")', { timeout: 10000 });
    console.log('✅ Initial vote submitted');

    // STEP 3: Edit vote to change A → B
    console.log('\n✏️ STEP 3: Editing vote A → B...');

    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(2000);

    // Check if we're in edit mode
    const editableFields = await page.locator('input[placeholder*="nomination"]').count();
    console.log(`   Edit mode fields visible: ${editableFields}`);

    if (editableFields > 0) {
      // Clear the first field (should contain "A") and replace with "B"
      await page.fill('input[placeholder*="nomination"]', '');
      await page.fill('input[placeholder*="nomination"]', 'B');

      // Submit the edit
      await page.click('button:has-text("Submit Vote")');
      await page.waitForTimeout(5000);
      console.log('✅ Edit submitted');
    } else {
      throw new Error('Could not enter edit mode');
    }

    // STEP 4: Check database result
    console.log('\n🔍 STEP 4: Checking database result...');

    const { data: votes } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .order('updated_at', { ascending: false });

    console.log(`   Total votes: ${votes.length}`);

    if (votes.length === 1) {
      const vote = votes[0];
      const nominations = vote.nominations || [];
      const hasA = nominations.includes('A');
      const hasB = nominations.includes('B');
      const wasUpdated = vote.created_at !== vote.updated_at;

      console.log(`   Nominations: ${JSON.stringify(nominations)}`);
      console.log(`   Contains A: ${hasA}`);
      console.log(`   Contains B: ${hasB}`);
      console.log(`   Was updated: ${wasUpdated}`);

      if (!hasA && hasB && wasUpdated) {
        console.log('\n🎉 SUCCESS: Edit fix works perfectly!');
        console.log('   ✅ Vote changed from A to B (not A+B)');
        console.log('   ✅ No duplicate nominations');
        console.log('   ✅ Database shows vote was updated');
        return true;
      } else if (hasA && hasB) {
        console.log('\n❌ FAILURE: Edit still creates A+B combination');
        console.log('   Edit fix did not work - both nominations present');
        return false;
      } else if (hasA && !hasB) {
        console.log('\n❌ FAILURE: Vote was not updated');
        console.log('   Still contains original nomination A');
        return false;
      } else {
        console.log('\n❓ UNEXPECTED: Unusual nomination state');
        return false;
      }
    } else {
      console.log(`\n❌ FAILURE: Wrong number of votes (${votes.length})`);
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed with error:', error.message);
    return false;
  } finally {
    await browser.close();
  }
}

// Run the test
testEditFix()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 EDIT FIX TEST:', success ? '✅ PASSED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });