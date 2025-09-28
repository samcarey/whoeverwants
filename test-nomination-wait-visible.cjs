#!/usr/bin/env node

/**
 * Test that waits for modal to become visible before clicking
 */

const { chromium } = require('playwright');

async function testNominationWaitVisible() {
  console.log('⏳ Testing Nomination with Wait for Visible Modal');
  console.log('================================================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Step 1: Create nomination poll
    console.log('\n✅ Step 1: Creating nomination poll...');
    await page.goto('http://localhost:3000/create-poll', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(2000);
    await page.fill('input#title', 'Wait Visible Test');
    await page.click('button:has-text("Suggestions")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Submit")');

    await page.waitForSelector('text=Create Poll', { timeout: 5000 });
    await page.click('button:has-text("Create Poll")');

    await page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 10000 });
    const pollUrl = page.url();
    console.log(`   Poll created: ${pollUrl}`);

    // Wait for components to fully render
    await page.waitForTimeout(5000);
    await page.waitForFunction(() => {
      const inputs = document.querySelectorAll('input');
      return inputs.length > 0;
    }, { timeout: 10000 });

    // Step 2: Submit initial vote with nomination "A"
    console.log('\n✅ Step 2: Submitting initial vote with nomination "A"...');

    const nominationInput = await page.locator('input[placeholder*="nomination"]').first();
    await nominationInput.fill('A');
    await nominationInput.press('Enter');
    await page.waitForTimeout(1000);

    const voterNameInput = await page.locator('input[placeholder*="name"]').first();
    await voterNameInput.fill('TestVoter');

    console.log('   Clicking Submit Vote button...');
    await page.click('button:has-text("Submit Vote")');

    // Wait for modal to become visible (not just exist)
    try {
      console.log('   Waiting for modal to become visible...');
      await page.waitForSelector('div[id="modal-root"] div', {
        state: 'visible',
        timeout: 10000
      });
      console.log('   Modal content is now visible');

      // Now click the submit button in the modal
      const modalSubmitButton = await page.locator('div[id="modal-root"] button:has-text("Submit Vote")');
      await modalSubmitButton.waitFor({ state: 'visible', timeout: 5000 });
      console.log('   Modal submit button is visible, clicking...');

      await modalSubmitButton.click();
      console.log('   Modal submit button clicked');

      // Wait for submission to complete
      await page.waitForTimeout(5000);

      // Check if modal disappeared (sign of successful submission)
      const modalStillVisible = await page.isVisible('div[id="modal-root"] div');
      console.log(`   Modal still visible after click: ${modalStillVisible}`);

    } catch (e) {
      console.log('   Modal visibility failed:', e.message);

      // Fallback: Try to click even if not visible
      try {
        console.log('   Fallback: force-clicking modal button...');
        await page.locator('div[id="modal-root"] button:has-text("Submit Vote")').click({ force: true });
        await page.waitForTimeout(5000);
      } catch (e2) {
        console.log('   Fallback also failed:', e2.message);
      }
    }

    // Step 3: Check for Edit button (indicates successful vote)
    console.log('\n✅ Step 3: Checking for successful vote submission...');

    // Wait a bit more for the UI to update
    await page.waitForTimeout(3000);

    const hasEditButton = await page.isVisible('button:has-text("Edit")');
    const hasSubmitButton = await page.isVisible('button:has-text("Submit Vote")');
    const hasVotedText = await page.isVisible('text=voted');
    const hasNominationA = await page.isVisible('text=A');

    console.log(`   Edit button visible: ${hasEditButton}`);
    console.log(`   Submit button still visible: ${hasSubmitButton}`);
    console.log(`   "voted" text visible: ${hasVotedText}`);
    console.log(`   Nomination "A" visible: ${hasNominationA}`);

    if (hasEditButton) {
      console.log('\n🎉 SUCCESS: Vote was submitted successfully!');
      console.log('   Now testing the edit functionality...');

      // Step 4: Test editing
      await page.click('button:has-text("Edit")');
      await page.waitForTimeout(2000);

      // Clear and enter new nomination
      const editInput = await page.locator('input[placeholder*="nomination"]').first();
      await editInput.clear();
      await editInput.fill('B');
      await editInput.press('Enter');
      await page.waitForTimeout(1000);

      // Submit the edit
      await page.click('button:has-text("Submit Vote")');

      // Handle edit modal with same visibility wait
      try {
        console.log('   Waiting for edit modal to become visible...');
        await page.waitForSelector('div[id="modal-root"] div', {
          state: 'visible',
          timeout: 10000
        });

        const editModalSubmitButton = await page.locator('div[id="modal-root"] button:has-text("Submit Vote")');
        await editModalSubmitButton.waitFor({ state: 'visible', timeout: 5000 });
        await editModalSubmitButton.click();
        await page.waitForTimeout(5000);
      } catch (e) {
        console.log('   Edit modal handling failed, trying force click...');
        await page.locator('div[id="modal-root"] button:has-text("Submit Vote")').click({ force: true });
        await page.waitForTimeout(5000);
      }

      // Step 5: Verify results
      console.log('\n✅ Step 5: Verifying edit results...');

      // Wait for results to update
      await page.waitForTimeout(3000);

      const hasAAfterEdit = await page.isVisible('text=A');
      const hasBAfterEdit = await page.isVisible('text=B');

      console.log(`   Nomination "A" visible after edit: ${hasAAfterEdit}`);
      console.log(`   Nomination "B" visible after edit: ${hasBAfterEdit}`);

      if (!hasAAfterEdit && hasBAfterEdit) {
        console.log('\n🎉 FULL SUCCESS: Edit worked correctly!');
        console.log('   Results show only "B" and not "A"');
        return true;
      } else if (hasAAfterEdit && hasBAfterEdit) {
        console.log('\n❌ EDIT BUG CONFIRMED: Both A and B are visible');
        console.log('   This confirms the original bug - old nominations not being filtered out');
        return false;
      } else {
        console.log('\n❌ PARTIAL SUCCESS: Vote works but edit has issues');
        return false;
      }
    } else {
      console.log('\n❌ FAILURE: Vote submission did not work');
      // Take a screenshot for debugging
      await page.screenshot({ path: 'vote-submission-failed.png' });
      return false;
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'test-error-wait-visible.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
testNominationWaitVisible()
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