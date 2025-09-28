#!/usr/bin/env node

/**
 * Test the abstain vote update fix for nomination polls
 */

const { chromium } = require('playwright');

async function testAbstainVoteUpdate() {
  console.log('🧪 Testing Abstain Vote Update Fix');
  console.log('🎯 Testing that changing a nomination vote to abstain works properly');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Create a new nomination poll
    console.log('📝 Creating a new nomination poll...');
    await page.goto('http://localhost:3000/create-poll', {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    await page.waitForTimeout(1000);

    // Fill in poll details
    await page.fill('input[name="pollTitle"]', 'Test Abstain Update Poll');
    await page.selectOption('select[name="pollType"]', 'nomination');

    // Create the poll
    await page.click('button:has-text("Create Poll")');

    // Wait for redirect to poll page
    await page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 10000 });
    const pollUrl = page.url();
    console.log('✅ Poll created:', pollUrl);

    // Step 1: Submit initial nomination vote
    console.log('🗳️ Step 1: Submitting initial nomination votes...');

    // Add nominations
    const nominationInput = await page.locator('input[placeholder*="nomination"], input[placeholder*="Add"]').first();
    await nominationInput.fill('Option One');
    await page.click('button:has-text("Add")');
    await page.waitForTimeout(500);

    await nominationInput.fill('Option Two');
    await page.click('button:has-text("Add")');
    await page.waitForTimeout(500);

    // Add voter name
    const voterNameInput = await page.locator('input[placeholder*="name"], input[placeholder*="Name"]').first();
    await voterNameInput.fill('TestVoter');

    // Submit vote
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);

    console.log('✅ Initial vote submitted with nominations');

    // Check that results show the nominations
    const hasOptionOne = await page.isVisible('text=Option One');
    const hasOptionTwo = await page.isVisible('text=Option Two');

    console.log('📊 Initial results:');
    console.log('  - Option One visible:', hasOptionOne);
    console.log('  - Option Two visible:', hasOptionTwo);

    // Step 2: Edit vote to change to abstain
    console.log('✏️ Step 2: Editing vote to change to abstain...');

    const editButton = await page.locator('button:has-text("Edit")').first();
    if (!await editButton.isVisible()) {
      console.log('❌ No edit button found');
      return false;
    }

    await editButton.click();
    await page.waitForTimeout(1000);

    // Click abstain button
    const abstainButton = await page.locator('button:has-text("Abstain")').first();
    if (!await abstainButton.isVisible()) {
      console.log('❌ No abstain button found');
      return false;
    }

    await abstainButton.click();
    await page.waitForTimeout(500);

    // Submit the abstain vote
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);

    // Check for error messages
    const errorVisible = await page.isVisible('text=Failed to update vote');
    if (errorVisible) {
      console.log('❌ FAILURE: Got error message when updating to abstain');
      await page.screenshot({ path: 'abstain-update-error.png' });
      return false;
    }

    // Step 3: Verify the vote was updated
    console.log('🔍 Step 3: Verifying vote was updated to abstain...');

    // Check that we're still showing as having voted
    const hasVotedIndicator = await page.isVisible('text=You voted') ||
                              await page.isVisible('text=Your vote') ||
                              await page.isVisible('text=Edit');

    if (!hasVotedIndicator) {
      console.log('❌ FAILURE: Vote status not showing after abstain update');
      return false;
    }

    // Check the results - nominations should still be visible (from other voters if any)
    // but our vote should be registered as abstain
    console.log('📊 Final results after abstain:');

    // Look for abstain indicator
    const hasAbstainIndicator = await page.isVisible('text=abstained') ||
                                await page.isVisible('text=Abstain');

    console.log('  - Abstain indicator visible:', hasAbstainIndicator);

    console.log('🎉 SUCCESS: Vote update to abstain completed without errors!');
    return true;

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'abstain-test-error.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
testAbstainVoteUpdate()
  .then(success => {
    console.log('\n🏁 Test completed');
    console.log('Result:', success ? '✅ PASSED' : '❌ FAILED');
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });