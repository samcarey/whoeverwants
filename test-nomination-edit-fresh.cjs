#!/usr/bin/env node

/**
 * Complete end-to-end test of nomination editing functionality
 * Creates fresh poll, votes, edits, and verifies database state
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

async function testNominationEditingFlow() {
  console.log('🧪 Testing Nomination Editing Flow (Fresh Test)');
  console.log('===============================================');

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
    console.log('\n📝 STEP 1: Creating fresh nomination poll...');

    await page.goto('http://localhost:3000/create-poll', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Fill poll creation form
    await page.fill('input[placeholder*="poll title"]', 'Fresh Nomination Edit Test');
    await page.selectOption('select', 'nomination');

    // Set future deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    await page.fill('input[type="date"]', tomorrowStr);

    await page.click('button:has-text("Create Poll")');
    await page.waitForTimeout(3000);

    // Extract poll URL and ID
    const currentUrl = page.url();
    const pollIdMatch = currentUrl.match(/\/p\/([^\/]+)/);
    if (!pollIdMatch) {
      throw new Error('Failed to extract poll ID from URL: ' + currentUrl);
    }
    const pollId = pollIdMatch[1];
    console.log(`✅ Created poll: ${pollId}`);
    console.log(`   URL: ${currentUrl}`);

    // STEP 2: Submit initial vote with nomination "A"
    console.log('\n🗳️ STEP 2: Submitting initial vote with "A"...');

    await page.fill('input[placeholder*="nomination"]', 'A');
    await page.fill('input[placeholder*="name"]', 'TestVoter');
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(3000);

    // Check database after initial vote
    const { data: initialVotes } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .order('created_at', { ascending: false });

    console.log(`   Database check: ${initialVotes.length} vote(s) found`);
    if (initialVotes.length > 0) {
      const vote = initialVotes[0];
      console.log(`   Initial vote: ${JSON.stringify(vote.nominations)} (ID: ${vote.id.slice(0,8)}...)`);
      console.log(`   Created: ${vote.created_at}`);
      console.log(`   Updated: ${vote.updated_at}`);
    }

    // STEP 3: Edit the vote to change from "A" to "B"
    console.log('\n✏️ STEP 3: Editing vote to change A → B...');

    // Look for edit button and click it
    await page.waitForSelector('button:has-text("Edit")', { timeout: 10000 });
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(2000);

    // Check if we're in edit mode
    const isInEditMode = await page.isVisible('input[placeholder*="nomination"]');
    console.log(`   Edit mode active: ${isInEditMode}`);

    if (isInEditMode) {
      // Clear existing nomination and enter new one
      await page.fill('input[placeholder*="nomination"]', '');
      await page.fill('input[placeholder*="nomination"]', 'B');

      // Submit the edit
      await page.click('button:has-text("Submit Vote")');
      await page.waitForTimeout(3000);
      console.log('   ✅ Edit submitted');
    } else {
      console.log('   ❌ Could not enter edit mode');
      return false;
    }

    // STEP 4: Check database state after edit
    console.log('\n🔍 STEP 4: Checking database state after edit...');

    const { data: finalVotes } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId)
      .order('updated_at', { ascending: false });

    console.log(`   Total votes: ${finalVotes.length}`);

    if (finalVotes.length === 0) {
      console.log('   ❌ No votes found after edit');
      return false;
    }

    finalVotes.forEach((vote, i) => {
      console.log(`   Vote ${i + 1}:`);
      console.log(`     ID: ${vote.id}`);
      console.log(`     Nominations: ${JSON.stringify(vote.nominations)}`);
      console.log(`     Voter: ${vote.voter_name}`);
      console.log(`     Created: ${vote.created_at}`);
      console.log(`     Updated: ${vote.updated_at}`);
      console.log(`     Was Updated: ${vote.created_at !== vote.updated_at}`);
      console.log('');
    });

    // STEP 5: Analyze results
    console.log('\n📊 STEP 5: Analyzing results...');

    if (finalVotes.length === 1) {
      const vote = finalVotes[0];
      const hasA = vote.nominations && vote.nominations.includes('A');
      const hasB = vote.nominations && vote.nominations.includes('B');
      const wasUpdated = vote.created_at !== vote.updated_at;

      console.log(`   Vote contains A: ${hasA}`);
      console.log(`   Vote contains B: ${hasB}`);
      console.log(`   Vote was updated: ${wasUpdated}`);

      if (!hasA && hasB && wasUpdated) {
        console.log('\n🎉 SUCCESS: Vote editing works perfectly!');
        console.log('   ✅ Vote correctly changed from A to B');
        console.log('   ✅ Database shows vote was updated (not duplicated)');
        console.log('   ✅ No duplicate votes created');
        return true;
      } else if (hasA && !hasB && !wasUpdated) {
        console.log('\n❌ FAILURE: Vote was never updated');
        console.log('   - Vote still contains original value "A"');
        console.log('   - Created and updated timestamps are identical');
        console.log('   - Edit functionality is not working');
        return false;
      } else if (hasA && hasB) {
        console.log('\n❌ FAILURE: Vote contains both A and B');
        console.log('   - This indicates a data corruption issue');
        return false;
      } else {
        console.log('\n❓ UNEXPECTED: Vote has unusual state');
        console.log(`   - Contains A: ${hasA}, Contains B: ${hasB}, Updated: ${wasUpdated}`);
        return false;
      }
    } else if (finalVotes.length === 2) {
      console.log('\n❌ FAILURE: Duplicate votes created');
      console.log('   - Edit created new vote instead of updating existing');
      console.log('   - userVoteId mechanism is not working');

      const [newer, older] = finalVotes;
      console.log(`   Older vote: ${JSON.stringify(older.nominations)} (${older.created_at})`);
      console.log(`   Newer vote: ${JSON.stringify(newer.nominations)} (${newer.created_at})`);
      return false;
    } else {
      console.log(`\n❌ FAILURE: Unexpected number of votes (${finalVotes.length})`);
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
testNominationEditingFlow()
  .then(success => {
    console.log('\n' + '='.repeat(60));
    console.log('🏁 FINAL RESULT:', success ? '✅ NOMINATION EDITING WORKS' : '❌ NOMINATION EDITING BROKEN');
    console.log('='.repeat(60));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });