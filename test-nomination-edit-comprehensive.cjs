#!/usr/bin/env node

/**
 * Comprehensive test for nomination editing bug
 * Tests: create poll → vote A → verify A shows → edit to B → verify B shows (not A)
 */

const { chromium } = require('playwright');

async function testNominationEditComprehensive() {
  console.log('🧪 Testing Comprehensive Nomination Edit Flow');
  console.log('============================================');

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
    await page.fill('input#title', 'Nomination Edit Test Poll');
    await page.click('button:has-text("Suggestions")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Submit")');

    await page.waitForSelector('text=Create Poll', { timeout: 5000 });
    await page.click('button:has-text("Create Poll")');

    await page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 10000 });
    const pollUrl = page.url();
    console.log(`   Poll created: ${pollUrl}`);

    // Step 2: Submit initial vote with nomination "A"
    console.log('\n✅ Step 2: Submitting initial vote with nomination "A"...');
    await page.waitForTimeout(2000);

    // Find nomination input and add "A"
    const nominationInput = await page.locator('input[placeholder*="nomination"], input[placeholder*="Add"], input[placeholder*="suggestion"]').first();
    await nominationInput.fill('A');

    // Try to find and click Add button
    try {
      const addButton = await page.locator('button:has-text("Add"), button:has-text("+")').first();
      await addButton.click();
    } catch (e) {
      await nominationInput.press('Enter');
    }
    await page.waitForTimeout(500);

    // Add voter name if available
    const voterNameInput = await page.locator('input[placeholder*="name"], input[placeholder*="Name"]').first();
    if (await voterNameInput.isVisible()) {
      await voterNameInput.fill('TestVoter');
    }

    // Submit the vote
    console.log('   Clicking Submit Vote button...');
    await page.click('button:has-text("Submit Vote")');

    // Wait for and handle confirmation modal
    try {
      await page.waitForSelector('div[id="modal-root"]', { timeout: 5000 });
      console.log('   Confirmation modal detected');

      // Wait a bit for modal to fully render
      await page.waitForTimeout(1000);

      // Look for the submit button inside the modal more broadly
      const modalSubmitButton = await page.locator('div[id="modal-root"] button:has-text("Submit")').first();
      if (await modalSubmitButton.isVisible({ timeout: 2000 })) {
        console.log('   Found modal submit button, clicking...');
        await modalSubmitButton.click();
        console.log('   Modal submit button clicked');
      } else {
        // Fallback: try any button in modal that might submit
        const anyModalButton = await page.locator('div[id="modal-root"] button').first();
        if (await anyModalButton.isVisible()) {
          console.log('   Fallback: clicking first modal button');
          await anyModalButton.click();
        }
      }

      // Wait longer for submission to complete
      await page.waitForTimeout(5000);
    } catch (e) {
      console.log('   No modal detected or modal handling failed:', e.message);
      // If no modal, the vote might have been submitted directly
      await page.waitForTimeout(3000);
    }

    // Take screenshot to see post-submission state
    await page.screenshot({ path: 'debug-after-submission.png' });

    // Check for vote success indicators
    const hasVotedText = await page.isVisible('text=voted', { timeout: 1000 }).catch(() => false);
    const hasEditButton = await page.isVisible('button:has-text("Edit")', { timeout: 1000 }).catch(() => false);
    const hasSubmitButton = await page.isVisible('button:has-text("Submit Vote")', { timeout: 1000 }).catch(() => false);

    console.log(`   Post-submission state:`);
    console.log(`     - "voted" text visible: ${hasVotedText}`);
    console.log(`     - Edit button visible: ${hasEditButton}`);
    console.log(`     - Submit button still visible: ${hasSubmitButton}`);

    // Step 3: Verify "A" appears in results
    console.log('\n✅ Step 3: Verifying nomination "A" appears in results...');
    await page.waitForTimeout(2000);

    const hasA = await page.isVisible('text=A');
    console.log(`   Nomination "A" visible: ${hasA}`);

    if (!hasA) {
      await page.screenshot({ path: 'debug-step3-no-A.png' });
      console.log('   ❌ FAILURE: Nomination "A" not visible after initial vote');
      return false;
    }

    // Step 4: Edit vote to nomination "B"
    console.log('\n✅ Step 4: Editing vote to nomination "B"...');

    // Wait a bit longer and take screenshot to see page state
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'debug-before-edit.png' });

    // Look for various edit button variations
    const editButton = await page.locator('button:has-text("Edit"), button:has-text("edit"), button[aria-label*="edit"], button[aria-label*="Edit"]').first();
    const editButtonVisible = await editButton.isVisible().catch(() => false);

    console.log(`   Edit button visible: ${editButtonVisible}`);

    if (!editButtonVisible) {
      console.log('   ❌ FAILURE: No edit button found');

      // Debug: Print all buttons on the page
      const allButtons = await page.locator('button').all();
      console.log('   Available buttons:');
      for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
        const buttonText = await allButtons[i].textContent().catch(() => 'N/A');
        console.log(`     - "${buttonText}"`);
      }

      await page.screenshot({ path: 'debug-step4-no-edit.png' });
      return false;
    }

    await editButton.click();
    await page.waitForTimeout(1000);

    // Clear previous nominations and add "B"
    const editNominationInput = await page.locator('input[placeholder*="nomination"], input[placeholder*="Add"], input[placeholder*="suggestion"]').first();
    await editNominationInput.clear();
    await editNominationInput.fill('B');

    try {
      const addButton = await page.locator('button:has-text("Add"), button:has-text("+")').first();
      await addButton.click();
    } catch (e) {
      await editNominationInput.press('Enter');
    }
    await page.waitForTimeout(500);

    // Submit the updated vote
    await page.click('button:has-text("Submit Vote")');

    // Handle confirmation modal for the edit submission too
    try {
      await page.waitForSelector('div[id="modal-root"]', { timeout: 3000 });
      console.log('   Edit confirmation modal detected');

      await page.waitForTimeout(1000);

      const modalSubmitButton = await page.locator('div[id="modal-root"] button:has-text("Submit")').first();
      if (await modalSubmitButton.isVisible({ timeout: 2000 })) {
        console.log('   Found edit modal submit button, clicking...');
        await modalSubmitButton.click();
        console.log('   Edit modal submit button clicked');
      }

      await page.waitForTimeout(5000);
    } catch (e) {
      console.log('   No edit modal detected, continuing...');
      await page.waitForTimeout(4000);
    }

    // Step 5: Verify results show "B" and not "A"
    console.log('\n✅ Step 5: Verifying results show "B" and not "A"...');
    await page.waitForTimeout(2000);

    const hasAAfterEdit = await page.isVisible('text=A');
    const hasBAfterEdit = await page.isVisible('text=B');

    console.log(`   Nomination "A" visible after edit: ${hasAAfterEdit}`);
    console.log(`   Nomination "B" visible after edit: ${hasBAfterEdit}`);

    // Take screenshot for debugging
    await page.screenshot({ path: 'debug-final-results.png' });

    // Test success criteria
    if (hasAAfterEdit) {
      console.log('\n❌ FAILURE: Old nomination "A" still visible after editing to "B"');
      console.log('   Expected: Only "B" should be visible');
      console.log('   Actual: Both "A" and "B" are visible or only "A" is visible');
      return false;
    }

    if (!hasBAfterEdit) {
      console.log('\n❌ FAILURE: New nomination "B" not visible after editing');
      console.log('   Expected: "B" should be visible');
      console.log('   Actual: "B" is not visible');
      return false;
    }

    console.log('\n🎉 SUCCESS: Nomination editing works correctly!');
    console.log('   Results correctly show "B" and not "A" after editing');
    return true;

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'test-error-comprehensive.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
testNominationEditComprehensive()
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