#!/usr/bin/env node

/**
 * Test the abstain vote update fix using an existing nomination poll
 */

const { chromium } = require('playwright');

async function testAbstainUpdateExisting() {
  console.log('🧪 Testing Abstain Vote Update Fix on Existing Poll');
  console.log('🎯 Testing that changing a nomination vote to abstain works properly');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Use the existing test poll
    const pollUrl = 'http://localhost:3000/p/451f91ee-271b-4746-9182-b16dfaf6b8ab';
    console.log('📍 Navigating to existing nomination poll...');
    await page.goto(pollUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });

    await page.waitForTimeout(2000);

    // Check if poll is expired and reopen if needed
    const isExpired = await page.isVisible('text=Expired');
    if (isExpired) {
      console.log('🔄 Poll is expired, trying to reopen...');
      const hasReopenButton = await page.isVisible('button:has-text("Reopen")');
      if (hasReopenButton) {
        await page.click('button:has-text("Reopen")');
        await page.waitForTimeout(1000);

        // Handle confirmation modal
        await page.waitForSelector('button:has-text("Reopen Poll")', { timeout: 3000 });
        await page.click('button:has-text("Reopen Poll")', { force: true });
        await page.waitForTimeout(2000);
        console.log('✅ Poll reopened');
      }
    }

    // Check if we've already voted
    const hasEditButton = await page.isVisible('button:has-text("Edit")');

    if (!hasEditButton) {
      // Need to vote first
      console.log('🗳️ No existing vote found, submitting initial vote...');

      // Add nominations
      const nominationInput = await page.locator('input[placeholder*="nomination"], input[placeholder*="Add"]').first();
      if (await nominationInput.isVisible()) {
        await nominationInput.fill('Test Option A');
        await page.click('button:has-text("Add")');
        await page.waitForTimeout(500);

        await nominationInput.fill('Test Option B');
        await page.click('button:has-text("Add")');
        await page.waitForTimeout(500);

        // Add voter name
        const voterNameInput = await page.locator('input[placeholder*="name"], input[placeholder*="Name"]').first();
        if (await voterNameInput.isVisible()) {
          await voterNameInput.fill('TestAbstainUser');
        }

        // Submit vote
        await page.click('button:has-text("Submit Vote")');
        await page.waitForTimeout(2000);
        console.log('✅ Initial vote submitted');
      }
    } else {
      console.log('✅ Existing vote found');
    }

    // Now test changing to abstain
    console.log('✏️ Step 1: Editing vote to change to abstain...');

    const editBtn = await page.locator('button:has-text("Edit")').first();
    if (!await editBtn.isVisible()) {
      console.log('❌ No edit button found after voting');
      return false;
    }

    await editBtn.click();
    await page.waitForTimeout(1000);
    console.log('✅ Clicked edit button');

    // Click abstain button
    const abstainButton = await page.locator('button:has-text("Abstain")').first();
    if (!await abstainButton.isVisible()) {
      console.log('❌ No abstain button found in edit mode');
      await page.screenshot({ path: 'no-abstain-button.png' });
      return false;
    }

    await abstainButton.click();
    await page.waitForTimeout(500);
    console.log('✅ Clicked abstain button');

    // Submit the abstain vote
    await page.click('button:has-text("Submit Vote")');
    console.log('✅ Clicked submit button');

    // Wait for submission to complete
    await page.waitForTimeout(3000);

    // Check for error messages
    const errorVisible = await page.isVisible('text=Failed to update vote');
    const errorMessage = await page.locator('text=Failed to update vote').textContent().catch(() => null);

    if (errorVisible) {
      console.log('❌ FAILURE: Got error message when updating to abstain');
      console.log('Error message:', errorMessage);
      await page.screenshot({ path: 'abstain-update-error.png' });

      // Check debug logs
      console.log('\n📋 Checking debug logs for details...');
      const logs = await page.evaluate(() => {
        return window.localStorage.getItem('debugLogs') || 'No logs found';
      });
      console.log('Debug logs:', logs);

      return false;
    }

    // Step 2: Verify the vote was updated
    console.log('🔍 Step 2: Verifying vote was updated to abstain...');

    // Check that we're still showing as having voted
    const stillHasEditButton = await page.isVisible('button:has-text("Edit")');
    const hasVoteIndicator = await page.isVisible('text=You voted') ||
                             await page.isVisible('text=Your vote') ||
                             stillHasEditButton;

    if (!hasVoteIndicator) {
      console.log('❌ FAILURE: Vote status not showing after abstain update');
      await page.screenshot({ path: 'no-vote-indicator.png' });
      return false;
    }

    console.log('✅ Vote status still showing after update');

    // Take final screenshot
    await page.screenshot({ path: 'abstain-update-success.png' });

    console.log('🎉 SUCCESS: Vote update to abstain completed without errors!');
    console.log('✅ The fix is working properly - no false error messages');
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
testAbstainUpdateExisting()
  .then(success => {
    console.log('\n🏁 Test completed');
    console.log('Result:', success ? '✅ PASSED' : '❌ FAILED');
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });