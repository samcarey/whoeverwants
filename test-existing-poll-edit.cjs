#!/usr/bin/env node

/**
 * Test using an existing poll that we know has votes
 * Focus on the actual nomination editing bug
 */

const { chromium } = require('playwright');

async function testExistingPollEdit() {
  console.log('🧪 Testing Nomination Edit on Existing Poll');
  console.log('==========================================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Use the poll that was just created in the logs from the server
    const pollUrl = 'http://localhost:3000/p/4dfa4706-8de2-40a5-ac51-3ce351c2a0fb';
    console.log(`\n✅ Step 1: Navigating to existing poll: ${pollUrl}`);

    await page.goto(pollUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'debug-existing-poll-initial.png' });

    // Check current state
    const hasEditButton = await page.isVisible('button:has-text("Edit")');
    const hasA = await page.isVisible('text=A');
    const hasB = await page.isVisible('text=B');

    console.log(`   Current state:`);
    console.log(`     - Edit button visible: ${hasEditButton}`);
    console.log(`     - Nomination "A" visible: ${hasA}`);
    console.log(`     - Nomination "B" visible: ${hasB}`);

    if (!hasEditButton) {
      console.log('\n❌ No edit button found - user has not voted yet or poll setup issue');

      // Try to vote first
      console.log('\n✅ Step 2: Attempting to vote first...');

      // Check if voting interface is available
      const hasNominationInput = await page.isVisible('input[placeholder*="nomination"], input[placeholder*="Add"], input[placeholder*="suggestion"]');
      if (hasNominationInput) {
        const nominationInput = await page.locator('input[placeholder*="nomination"], input[placeholder*="Add"], input[placeholder*="suggestion"]').first();
        await nominationInput.fill('A');

        try {
          const addButton = await page.locator('button:has-text("Add"), button:has-text("+")').first();
          await addButton.click();
        } catch (e) {
          await nominationInput.press('Enter');
        }

        await page.waitForTimeout(500);

        // Add voter name if needed
        const voterNameInput = await page.locator('input[placeholder*="name"], input[placeholder*="Name"]').first();
        if (await voterNameInput.isVisible()) {
          await voterNameInput.fill('TestVoter');
        }

        // Submit vote
        await page.click('button:has-text("Submit Vote")');
        await page.waitForTimeout(3000);

        // Check if modal confirmation is needed
        try {
          const modalConfirmButton = await page.locator('div[id="modal-root"] button:has-text("Submit Vote")').first();
          if (await modalConfirmButton.isVisible()) {
            await modalConfirmButton.click({ force: true });
            await page.waitForTimeout(3000);
          }
        } catch (e) {
          // No modal needed
        }

        await page.waitForTimeout(2000);
        console.log('   Vote submitted, checking for edit button...');

        const hasEditButtonAfterVote = await page.isVisible('button:has-text("Edit")');
        console.log(`   Edit button now visible: ${hasEditButtonAfterVote}`);

        if (!hasEditButtonAfterVote) {
          console.log('   ❌ Still no edit button after voting - submission may have failed');
          await page.screenshot({ path: 'debug-after-vote-no-edit.png' });
          return false;
        }
      }
    }

    // Now proceed with editing test
    console.log('\n✅ Step 3: Testing nomination edit...');

    // Take screenshot before edit
    await page.screenshot({ path: 'debug-before-edit-attempt.png' });

    // Check what nominations are currently visible
    const currentNominations = [];
    const textContent = await page.textContent('body');
    if (textContent.includes(' A ') || textContent.includes('>A<')) currentNominations.push('A');
    if (textContent.includes(' B ') || textContent.includes('>B<')) currentNominations.push('B');
    if (textContent.includes(' C ') || textContent.includes('>C<')) currentNominations.push('C');

    console.log(`   Currently visible nominations: ${currentNominations.join(', ')}`);

    // Click edit button
    const editButton = await page.locator('button:has-text("Edit")').first();
    await editButton.click();
    await page.waitForTimeout(1000);

    console.log('   Edit button clicked, now in edit mode');
    await page.screenshot({ path: 'debug-in-edit-mode.png' });

    // Clear and add new nomination
    const editNominationInput = await page.locator('input[placeholder*="nomination"], input[placeholder*="Add"], input[placeholder*="suggestion"]').first();
    await editNominationInput.clear();
    await editNominationInput.fill('B');  // Change from A to B

    try {
      const addButton = await page.locator('button:has-text("Add"), button:has-text("+")').first();
      await addButton.click();
    } catch (e) {
      await editNominationInput.press('Enter');
    }
    await page.waitForTimeout(500);

    // Submit the edit
    console.log('   Submitting edited vote...');
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(3000);

    // Handle modal if needed
    try {
      const modalConfirmButton = await page.locator('div[id="modal-root"] button:has-text("Submit Vote")').first();
      if (await modalConfirmButton.isVisible()) {
        await modalConfirmButton.click({ force: true });
        await page.waitForTimeout(3000);
      }
    } catch (e) {
      // No modal
    }

    // Wait for results to update
    await page.waitForTimeout(4000);
    console.log('   Edit submitted, checking results...');

    // Take final screenshot
    await page.screenshot({ path: 'debug-after-edit-final.png' });

    // Check final results
    const finalHasA = await page.isVisible('text=A');
    const finalHasB = await page.isVisible('text=B');

    console.log(`\n✅ Step 4: Final results verification:`);
    console.log(`     - Nomination "A" visible: ${finalHasA}`);
    console.log(`     - Nomination "B" visible: ${finalHasB}`);

    // Test the actual bug: if we edited from A to B, A should NOT be visible
    if (finalHasA && finalHasB) {
      console.log('\n❌ BUG CONFIRMED: Both A and B are visible');
      console.log('   This confirms the nomination editing bug - old values are not being filtered out');
      return false;
    } else if (finalHasA && !finalHasB) {
      console.log('\n❌ BUG CONFIRMED: Only A visible, B not visible');
      console.log('   Edit did not work - still showing old value');
      return false;
    } else if (!finalHasA && finalHasB) {
      console.log('\n🎉 SUCCESS: Only B visible - nomination edit worked correctly!');
      return true;
    } else {
      console.log('\n⚠️ UNEXPECTED: Neither A nor B visible');
      return false;
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'test-error-existing-poll.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
testExistingPollEdit()
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