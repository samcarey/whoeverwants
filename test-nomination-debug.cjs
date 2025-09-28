#!/usr/bin/env node

/**
 * Debug test to understand why nomination submission isn't working
 */

const { chromium } = require('playwright');

async function debugNominationSubmission() {
  console.log('🔍 Debugging Nomination Submission Process');
  console.log('=========================================');

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
    await page.fill('input#title', 'Debug Nomination Test');
    await page.click('button:has-text("Suggestions")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Submit")');

    await page.waitForSelector('text=Create Poll', { timeout: 5000 });
    await page.click('button:has-text("Create Poll")');

    await page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 10000 });
    const pollUrl = page.url();
    console.log(`   Poll created: ${pollUrl}`);

    // Wait longer for React hydration and component rendering
    console.log('   Waiting for components to fully render...');
    await page.waitForTimeout(5000);

    // Wait specifically for the nomination interface to load
    try {
      await page.waitForFunction(() => {
        const inputs = document.querySelectorAll('input');
        return inputs.length > 0;
      }, { timeout: 10000 });
      console.log('   Input fields detected');
    } catch (e) {
      console.log('   Warning: No input fields detected even after waiting');
    }

    // Step 2: Debug form state before adding nomination
    console.log('\n🔍 Step 2: Checking initial form state...');

    // Check what input fields are available
    const inputs = await page.locator('input').all();
    console.log(`   Found ${inputs.length} input fields`);

    for (let i = 0; i < inputs.length; i++) {
      const placeholder = await inputs[i].getAttribute('placeholder').catch(() => 'N/A');
      const type = await inputs[i].getAttribute('type').catch(() => 'N/A');
      const visible = await inputs[i].isVisible();
      console.log(`   Input ${i}: type="${type}", placeholder="${placeholder}", visible=${visible}`);
    }

    // Check submit button state
    const submitButtons = await page.locator('button:has-text("Submit Vote")').all();
    console.log(`   Found ${submitButtons.length} Submit Vote buttons`);

    for (let i = 0; i < submitButtons.length; i++) {
      const disabled = await submitButtons[i].isDisabled();
      const visible = await submitButtons[i].isVisible();
      console.log(`   Submit button ${i}: disabled=${disabled}, visible=${visible}`);
    }

    // Step 3: Add nomination and check form state
    console.log('\n✅ Step 3: Adding nomination "A"...');

    const nominationInput = await page.locator('input[placeholder*="nomination"], input[placeholder*="Add"], input[placeholder*="suggestion"]').first();
    const nominationInputVisible = await nominationInput.isVisible();
    console.log(`   Nomination input visible: ${nominationInputVisible}`);

    if (nominationInputVisible) {
      await nominationInput.fill('A');
      console.log('   Filled nomination input with "A"');

      // Try to add the nomination
      try {
        const addButton = await page.locator('button:has-text("Add"), button:has-text("+")').first();
        const addButtonVisible = await addButton.isVisible();
        console.log(`   Add button visible: ${addButtonVisible}`);

        if (addButtonVisible) {
          await addButton.click();
          console.log('   Clicked Add button');
        } else {
          await nominationInput.press('Enter');
          console.log('   Pressed Enter on nomination input');
        }
      } catch (e) {
        await nominationInput.press('Enter');
        console.log('   Fallback: pressed Enter on nomination input');
      }

      await page.waitForTimeout(1000);

      // Check if nomination was added
      const nominationVisible = await page.isVisible('text=A');
      console.log(`   Nomination "A" visible on page: ${nominationVisible}`);

      // Check submit button state after adding nomination
      const submitButtonAfter = await page.locator('button:has-text("Submit Vote")').first();
      const disabledAfter = await submitButtonAfter.isDisabled();
      console.log(`   Submit button disabled after adding nomination: ${disabledAfter}`);
    }

    // Step 4: Try to submit and see what happens
    console.log('\n✅ Step 4: Attempting to submit vote...');

    // Add voter name if required
    const voterNameInput = await page.locator('input[placeholder*="name"], input[placeholder*="Name"]').first();
    if (await voterNameInput.isVisible()) {
      await voterNameInput.fill('TestVoter');
      console.log('   Added voter name');
    }

    // Click submit and see what happens
    const submitButton = await page.locator('button:has-text("Submit Vote")').first();
    const canSubmit = await submitButton.isEnabled();
    console.log(`   Submit button enabled: ${canSubmit}`);

    if (canSubmit) {
      console.log('   Clicking Submit Vote button...');
      await submitButton.click();

      // Wait and check what elements appear
      await page.waitForTimeout(2000);

      // Check for modal
      const modalExists = await page.locator('div[id="modal-root"]').count();
      const modalVisible = modalExists > 0 ? await page.locator('div[id="modal-root"]').isVisible() : false;
      console.log(`   Modal exists: ${modalExists > 0}, visible: ${modalVisible}`);

      if (modalExists > 0) {
        // Get modal content
        const modalText = await page.locator('div[id="modal-root"]').textContent();
        console.log(`   Modal content: "${modalText}"`);

        // Look for buttons in modal
        const modalButtons = await page.locator('div[id="modal-root"] button').all();
        console.log(`   Modal buttons count: ${modalButtons.length}`);

        for (let i = 0; i < modalButtons.length; i++) {
          const buttonText = await modalButtons[i].textContent();
          const buttonVisible = await modalButtons[i].isVisible();
          console.log(`   Modal button ${i}: "${buttonText}", visible=${buttonVisible}`);
        }
      }

      // Check page state after click
      const hasVotedText = await page.isVisible('text=voted');
      const hasEditButton = await page.isVisible('button:has-text("Edit")');
      const hasSubmitButton = await page.isVisible('button:has-text("Submit Vote")');

      console.log(`   Post-click state:`);
      console.log(`     - "voted" text visible: ${hasVotedText}`);
      console.log(`     - Edit button visible: ${hasEditButton}`);
      console.log(`     - Submit button still visible: ${hasSubmitButton}`);
    } else {
      console.log('   ❌ Submit button is disabled, cannot submit');
    }

    // Take screenshot for debugging
    await page.screenshot({ path: 'debug-nomination-submission.png' });
    console.log('   Screenshot saved: debug-nomination-submission.png');

    return true;

  } catch (error) {
    console.error('\n❌ Debug test failed with error:', error.message);
    await page.screenshot({ path: 'debug-error.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the debug test
debugNominationSubmission()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 Debug Result:', success ? '✅ COMPLETED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });