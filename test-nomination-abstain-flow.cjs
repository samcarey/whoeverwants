#!/usr/bin/env node

/**
 * Test the complete flow: Create nomination poll → Vote with nomination → Edit to abstain → Verify no nominations
 */

const { chromium } = require('playwright');

async function testNominationAbstainFlow() {
  console.log('🧪 Testing Nomination → Abstain Vote Flow');
  console.log('======================================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Step 1: Create a new nomination poll
    console.log('\n✅ Step 1: Creating nomination poll...');
    await page.goto('http://localhost:3000/create-poll', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for the page to fully load
    await page.waitForTimeout(3000);

    // Fill poll title using the correct selector
    await page.fill('input#title', 'Test Nomination to Abstain Flow');

    // Click on "Suggestions" button to select nomination type (the UI uses tabs)
    await page.click('button:has-text("Suggestions")');
    await page.waitForTimeout(500);

    // Create the poll
    await page.click('button:has-text("Submit")');

    // Handle confirmation modal
    await page.waitForSelector('text=Create Poll', { timeout: 5000 });
    await page.click('button:has-text("Create Poll")');

    // Wait for redirect to poll page
    await page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 10000 });
    const pollUrl = page.url();
    console.log('   Poll created:', pollUrl);

    // Step 2: Submit initial vote with one nomination
    console.log('\n✅ Step 2: Submitting vote with single nomination...');

    // Wait for the nomination interface to load
    await page.waitForTimeout(2000);

    // Add a single nomination - try different selectors
    try {
      const nominationInput = await page.locator('input[placeholder*="nomination"], input[placeholder*="Add"], input[placeholder*="suggestion"]').first();
      await nominationInput.fill('Test Nomination Item');

      // Try to find and click the Add button - it might be a plus icon or "Add" text
      const addButton = await page.locator('button:has-text("Add"), button:has-text("+"), button[aria-label*="add"], button[aria-label*="Add"]').first();
      await addButton.click();
    } catch (e) {
      // Alternative: directly type and press Enter
      await page.fill('input[type="text"]', 'Test Nomination Item');
      await page.press('input[type="text"]', 'Enter');
    }
    await page.waitForTimeout(500);

    // Add voter name
    const voterNameInput = await page.locator('input[placeholder*="name"], input[placeholder*="Name"]').first();
    if (await voterNameInput.isVisible()) {
      await voterNameInput.fill('TestVoter');
    }

    // Submit vote
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);

    // Verify nomination appears in results
    const nominationVisible = await page.isVisible('text=Test Nomination Item');
    console.log('   Nomination visible in results:', nominationVisible);

    if (!nominationVisible) {
      console.log('   ❌ FAILURE: Nomination not visible after voting');
      await page.screenshot({ path: 'nomination-not-visible.png' });
      return false;
    }

    // Step 3: Edit vote to abstain
    console.log('\n✅ Step 3: Editing vote to abstain...');

    const editButton = await page.locator('button:has-text("Edit")').first();
    if (!await editButton.isVisible()) {
      console.log('   ❌ FAILURE: No edit button found');
      await page.screenshot({ path: 'no-edit-button.png' });
      return false;
    }

    await editButton.click();
    await page.waitForTimeout(1000);

    // Click abstain button
    const abstainButton = await page.locator('button:has-text("Abstain")').first();
    if (!await abstainButton.isVisible()) {
      console.log('   ❌ FAILURE: No abstain button found');
      await page.screenshot({ path: 'no-abstain-button.png' });
      return false;
    }

    await abstainButton.click();
    await page.waitForTimeout(500);
    console.log('   Clicked abstain button');

    // Submit the abstain vote
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(3000);

    // Check for error messages
    const errorVisible = await page.isVisible('text=Failed to update vote');
    if (errorVisible) {
      console.log('   ❌ FAILURE: Got error message when updating to abstain');
      await page.screenshot({ path: 'abstain-error.png' });
      return false;
    }

    console.log('   Vote updated to abstain successfully');

    // Step 4: Verify no nominations are shown
    console.log('\n✅ Step 4: Verifying poll shows no nominations...');

    // Wait for results to refresh
    await page.waitForTimeout(2000);

    // Check if the nomination is still visible
    const nominationStillVisible = await page.isVisible('text=Test Nomination Item');

    // Check for "No nominations yet" or similar message
    const noNominationsMessage = await page.isVisible('text=No nominations yet') ||
                                 await page.isVisible('text=No nominations submitted') ||
                                 await page.isVisible('text=Be the first to nominate');

    // Check for abstain indicator
    const abstainIndicator = await page.isVisible('text=abstained') ||
                             await page.isVisible('text=Abstain') ||
                             await page.isVisible('text=You abstained');

    console.log('   Nomination still visible:', nominationStillVisible);
    console.log('   No nominations message visible:', noNominationsMessage);
    console.log('   Abstain indicator visible:', abstainIndicator);

    // Take screenshot for analysis
    await page.screenshot({ path: 'final-abstain-state.png' });

    // Success criteria: nomination should NOT be visible after abstaining
    if (nominationStillVisible) {
      console.log('\n❌ FAILURE: Nomination still visible after changing to abstain');
      console.log('   Expected: No nominations shown after abstaining');
      console.log('   Actual: "Test Nomination Item" still visible');
      return false;
    }

    if (noNominationsMessage || !nominationStillVisible) {
      console.log('\n🎉 SUCCESS: Poll correctly shows no nominations after abstaining!');
      return true;
    }

    console.log('\n⚠️  WARNING: Unexpected state - nomination gone but no clear indication');
    return true; // Still counts as success if nomination is gone

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'test-error.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
testNominationAbstainFlow()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 Test Result:', success ? '✅ PASSED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });