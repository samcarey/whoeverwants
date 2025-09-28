#!/usr/bin/env node

/**
 * Test script to verify the nomination vote editing results refresh fix
 *
 * This tests the bug where loadExistingNominations() was using created_at
 * instead of updated_at timestamps, causing edited votes to not reflect in results.
 */

const { chromium } = require('playwright');

async function testNominationEditFix() {
  console.log('🧪 Testing Nomination Vote Editing Results Refresh Fix');

  const browser = await chromium.launch({
    headless: true,  // Run headless (no X server available)
    slowMo: 500      // Slow down for stability
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('📝 Step 1: Creating nomination poll...');

    // Navigate to create poll page
    await page.goto('http://localhost:3000/create-poll/', {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    // Switch to nomination poll type (Preferences tab)
    await page.click('text=Preferences');
    await page.waitForTimeout(500);

    // Fill poll details
    await page.fill('input[id="title"]', 'Test Nomination Edit Fix');
    await page.selectOption('select[id="deadline"]', '30min'); // Longer deadline
    await page.fill('input[id="creatorName"]', 'Test Creator');

    // Create the poll
    await page.click('button[type="button"]:has-text("Submit")');

    // Handle confirmation modal
    await page.waitForSelector('text=Create Poll', { timeout: 5000 });
    await page.click('button:has-text("Create Poll")');

    // Wait for redirect to poll page
    await page.waitForURL('**/p/**', { timeout: 15000 });
    const pollUrl = page.url();
    console.log('✅ Poll created:', pollUrl);

    // Check if poll is expired and reopen if necessary
    const isExpired = await page.isVisible('text=Expired');
    if (isExpired) {
      console.log('🔄 Poll is expired, reopening...');
      await page.click('button:has-text("Reopen Poll")');
      await page.waitForTimeout(2000);
    }

    console.log('🗳️ Step 2: Submitting initial vote...');

    // Submit initial nominations: A, B
    await page.fill('input[placeholder="Add a nomination..."]', 'Option A');
    await page.click('button:has-text("Add")');
    await page.waitForTimeout(500);

    await page.fill('input[placeholder="Add a nomination..."]', 'Option B');
    await page.click('button:has-text("Add")');
    await page.waitForTimeout(500);

    // Submit the vote
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);

    console.log('✅ Initial vote submitted with Options A and B');

    console.log('📊 Step 3: Checking initial results...');

    // Check that results show A and B
    const initialResults = await page.textContent('.poll-results, [class*="result"]');
    console.log('Initial results content:', initialResults);

    const hasOptionA = await page.isVisible('text=Option A');
    const hasOptionB = await page.isVisible('text=Option B');

    console.log('Initial results show Option A:', hasOptionA);
    console.log('Initial results show Option B:', hasOptionB);

    console.log('✏️ Step 4: Editing vote...');

    // Click Edit button
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(1000);

    // Remove Option A (click X button next to it)
    try {
      const removeAButton = page.locator('text=Option A').locator('..').locator('button');
      await removeAButton.click();
      await page.waitForTimeout(500);
    } catch (error) {
      console.log('Could not remove Option A via X button, trying alternative method...');
      // Alternative: clear and re-add nominations
    }

    // Add Option C
    await page.fill('input[placeholder="Add a nomination..."]', 'Option C');
    await page.click('button:has-text("Add")');
    await page.waitForTimeout(500);

    // Submit the edited vote
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(3000); // Extra wait for results update

    console.log('✅ Vote edited: removed A, kept B, added C');

    console.log('🔍 Step 5: Verifying updated results...');

    // Refresh page to ensure we see latest data
    await page.reload();
    await page.waitForTimeout(2000);

    // Check updated results
    const updatedResults = await page.textContent('.poll-results, [class*="result"]');
    console.log('Updated results content:', updatedResults);

    const stillHasA = await page.isVisible('text=Option A');
    const stillHasB = await page.isVisible('text=Option B');
    const nowHasC = await page.isVisible('text=Option C');

    console.log('Updated results show Option A:', stillHasA);
    console.log('Updated results show Option B:', stillHasB);
    console.log('Updated results show Option C:', nowHasC);

    // Verify the fix worked
    if (!stillHasA && stillHasB && nowHasC) {
      console.log('🎉 SUCCESS: Results correctly show edited nominations (B, C) and not old ones (A)');
      console.log('✅ The updated_at timestamp fix is working properly!');
    } else {
      console.log('❌ FAILURE: Results still show old nominations instead of edited ones');
      console.log('🐛 The bug may still exist - check loadExistingNominations() query');
    }

    // Take screenshot for verification
    await page.screenshot({ path: 'nomination-edit-test-results.png' });
    console.log('📸 Screenshot saved: nomination-edit-test-results.png');

    return !stillHasA && stillHasB && nowHasC;

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'nomination-edit-test-error.png' });
    console.log('📸 Error screenshot saved: nomination-edit-test-error.png');
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
testNominationEditFix()
  .then(success => {
    console.log('\n🏁 Test completed');
    console.log('Result:', success ? '✅ PASSED' : '❌ FAILED');
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });