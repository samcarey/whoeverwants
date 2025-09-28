#!/usr/bin/env node

/**
 * Test the nomination vote editing results refresh fix using an existing nomination poll
 * Tests the bug where loadExistingNominations() used created_at instead of updated_at
 */

const { chromium } = require('playwright');

async function testExistingNominationPoll() {
  console.log('🧪 Testing Nomination Vote Editing Results Refresh Fix');
  console.log('🎯 Using existing nomination poll to test the updated_at fix');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Use the poll URL from your test-nomination-voting.cjs
    console.log('📍 Navigating to existing nomination poll...');
    await page.goto('http://localhost:3000/p/451f91ee-271b-4746-9182-b16dfaf6b8ab', {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    await page.waitForTimeout(2000);

    // Take initial screenshot
    await page.screenshot({ path: 'nomination-poll-initial.png' });
    console.log('📸 Initial screenshot saved');

    console.log('🔍 Checking if poll exists and is accessible...');

    // Check if the poll loaded properly
    const pageTitle = await page.textContent('h1, .poll-title, [class*="title"]').catch(() => null);
    console.log('📋 Page title:', pageTitle);

    // Look for nomination voting interface
    const hasNominationInput = await page.isVisible('input[placeholder*="nomination"], input[placeholder*="Add"]');
    const hasSubmitButton = await page.isVisible('button:has-text("Submit Vote")');

    console.log('🎯 Has nomination input:', hasNominationInput);
    console.log('🗳️ Has submit button:', hasSubmitButton);

    if (!hasNominationInput) {
      console.log('⚠️ This might not be a nomination poll, or it may be closed/expired');

      // Check if poll is expired and try to reopen
      const isExpired = await page.isVisible('text=Expired');
      if (isExpired) {
        console.log('🔄 Poll is expired, trying to reopen...');
        const hasReopenButton = await page.isVisible('button:has-text("Reopen")');
        if (hasReopenButton) {
          await page.click('button:has-text("Reopen")');
          await page.waitForTimeout(1000);

          // Handle confirmation modal - force click to bypass modal overlay
          await page.waitForSelector('button:has-text("Reopen Poll")', { timeout: 3000 });
          await page.click('button:has-text("Reopen Poll")', { force: true });
          await page.waitForTimeout(2000);
          console.log('✅ Poll reopened');
        }
      }
    }

    console.log('🗳️ Step 1: Submitting initial nominations...');

    // Clear any existing nominations and add new ones
    const nominationInput = await page.locator('input[placeholder*="nomination"], input[placeholder*="Add"]').first();
    if (await nominationInput.isVisible()) {
      // Add first nomination
      await nominationInput.fill('Option A');
      await page.click('button:has-text("Add")');
      await page.waitForTimeout(500);

      // Add second nomination
      await nominationInput.fill('Option B');
      await page.click('button:has-text("Add")');
      await page.waitForTimeout(500);

      console.log('✅ Added initial nominations: Option A, Option B');
    } else {
      console.log('❌ Could not find nomination input field');
      await page.screenshot({ path: 'nomination-poll-error.png' });
      return false;
    }

    // Submit the vote
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);

    console.log('✅ Initial vote submitted');

    console.log('📊 Step 2: Checking initial results...');

    // Take screenshot of results
    await page.screenshot({ path: 'nomination-results-initial.png' });

    // Check that results show A and B
    const hasOptionA = await page.isVisible('text=Option A');
    const hasOptionB = await page.isVisible('text=Option B');

    console.log('📊 Results show Option A:', hasOptionA);
    console.log('📊 Results show Option B:', hasOptionB);

    if (!hasOptionA || !hasOptionB) {
      console.log('⚠️ Initial results not showing expected nominations');
    }

    console.log('✏️ Step 3: Editing the vote...');

    // Look for Edit button
    const hasEditButton = await page.isVisible('button:has-text("Edit")');
    console.log('🖊️ Has edit button:', hasEditButton);

    if (!hasEditButton) {
      console.log('❌ No edit button found - this may not be the voter\'s poll or edit may not be available');
      await page.screenshot({ path: 'nomination-no-edit-button.png' });
      return false;
    }

    // Click Edit
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(1000);

    console.log('🖊️ Clicked edit button');

    // Try to modify nominations
    // Remove Option A if possible and add Option C
    try {
      // Look for existing nominations and their remove buttons
      const nominations = await page.locator('[class*="nomination"], [data-testid*="nomination"]').count();
      console.log('📝 Found', nominations, 'existing nominations');

      // Add Option C
      const editNominationInput = await page.locator('input[placeholder*="nomination"], input[placeholder*="Add"]').first();
      if (await editNominationInput.isVisible()) {
        await editNominationInput.fill('Option C');
        await page.click('button:has-text("Add")');
        await page.waitForTimeout(500);
        console.log('✅ Added Option C');
      }

      // Submit edited vote
      await page.click('button:has-text("Submit Vote")');
      await page.waitForTimeout(3000);

      console.log('✅ Vote edited and resubmitted');

    } catch (error) {
      console.log('⚠️ Error during edit:', error.message);
    }

    console.log('🔍 Step 4: Verifying updated results...');

    // Wait a bit more for results to update
    await page.waitForTimeout(2000);

    // Take final screenshot
    await page.screenshot({ path: 'nomination-results-final.png' });

    // Check updated results
    const stillHasA = await page.isVisible('text=Option A');
    const stillHasB = await page.isVisible('text=Option B');
    const nowHasC = await page.isVisible('text=Option C');

    console.log('🔍 Final results:');
    console.log('  - Option A present:', stillHasA);
    console.log('  - Option B present:', stillHasB);
    console.log('  - Option C present:', nowHasC);

    // The fix should ensure that edited nominations reflect in results
    // (we added C, A and B might both still be there depending on edit behavior)
    if (nowHasC) {
      console.log('🎉 SUCCESS: Option C appears in results - vote edit was reflected!');
      console.log('✅ The updated_at timestamp fix is working properly!');
      return true;
    } else {
      console.log('❌ FAILURE: Option C not found in results after edit');
      console.log('🐛 The updated_at fix may not be working properly');
      return false;
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'nomination-test-error.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
testExistingNominationPoll()
  .then(success => {
    console.log('\n🏁 Test completed');
    console.log('Result:', success ? '✅ PASSED' : '❌ FAILED');
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });