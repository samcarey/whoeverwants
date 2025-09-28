#!/usr/bin/env node

/**
 * Simple test: Vote in nomination poll then change to abstain
 */

const { chromium } = require('playwright');

async function testAbstainSimple() {
  console.log('🧪 Testing Nomination → Abstain Vote (Simplified)');
  console.log('================================================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Use the existing test poll from earlier
    const pollUrl = 'http://localhost:3000/p/21821498-e0f7-4f9e-a1cb-79b637b17c95';
    console.log('\n✅ Step 1: Navigating to nomination poll...');
    await page.goto(pollUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(2000);

    // Check if poll is expired and reopen if needed
    const isExpired = await page.isVisible('text=Expired');
    if (isExpired) {
      console.log('   🔄 Poll is expired, reopening...');
      await page.click('button:has-text("Reopen")');
      await page.waitForTimeout(1000);

      // Handle confirmation modal
      try {
        await page.click('button:has-text("Reopen Poll")', { force: true });
        await page.waitForTimeout(2000);
        console.log('   ✅ Poll reopened');
      } catch (e) {
        // Modal might not appear
      }
    }

    // Check if we already voted (look for Edit button)
    const hasEditButton = await page.isVisible('button:has-text("Edit")');

    if (!hasEditButton) {
      console.log('\n✅ Step 2: Submitting initial nomination vote...');

      // Find the input field and add a nomination
      const inputs = await page.$$('input[type="text"]');
      if (inputs.length > 0) {
        // First input is likely the nomination field
        await inputs[0].fill('Test Item');

        // Look for Add button or press Enter
        try {
          const addBtn = await page.$('button:has-text("Add")');
          if (addBtn) {
            await addBtn.click();
          } else {
            await inputs[0].press('Enter');
          }
        } catch (e) {
          await inputs[0].press('Enter');
        }

        await page.waitForTimeout(1000);
      }

      // Add voter name if there's a second input
      if (inputs.length > 1) {
        await inputs[1].fill('TestUser');
      }

      // Submit the vote
      await page.click('button:has-text("Submit Vote")');
      await page.waitForTimeout(3000);

      console.log('   ✅ Initial vote submitted');
    } else {
      console.log('   ✅ Already voted, ready to edit');
    }

    // Now change to abstain
    console.log('\n✅ Step 3: Changing vote to abstain...');

    // Click Edit button
    const editButton = await page.locator('button:has-text("Edit")').first();
    if (!await editButton.isVisible()) {
      console.log('   ❌ No Edit button found');
      return false;
    }

    await editButton.click();
    await page.waitForTimeout(1000);
    console.log('   ✅ Clicked Edit');

    // Click Abstain button
    const abstainButton = await page.locator('button:has-text("Abstain")').first();
    if (!await abstainButton.isVisible()) {
      console.log('   ❌ No Abstain button found');
      return false;
    }

    await abstainButton.click();
    await page.waitForTimeout(500);
    console.log('   ✅ Clicked Abstain');

    // Submit the abstain vote
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(3000);

    // Check for error
    const errorVisible = await page.isVisible('text=Failed to update vote');
    if (errorVisible) {
      console.log('   ❌ FAILURE: Error when updating to abstain');
      await page.screenshot({ path: 'abstain-error.png' });
      return false;
    }

    console.log('   ✅ Vote changed to abstain successfully');

    // Step 4: Verify results
    console.log('\n✅ Step 4: Verifying results...');
    await page.waitForTimeout(2000);

    // Take screenshot
    await page.screenshot({ path: 'abstain-final.png' });

    // Check if "Test Item" is still visible
    const itemStillVisible = await page.isVisible('text=Test Item');
    const noNominationsVisible = await page.isVisible('text=No nominations') ||
                                  await page.isVisible('text=Be the first');

    console.log('   Item visible:', itemStillVisible);
    console.log('   No nominations message:', noNominationsVisible);

    if (itemStillVisible) {
      console.log('\n❌ FAILURE: Nomination still visible after abstaining');
      return false;
    }

    console.log('\n🎉 SUCCESS: Abstain vote working correctly!');
    return true;

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await page.screenshot({ path: 'test-error.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
testAbstainSimple()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('Result:', success ? '✅ PASSED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Error:', error);
    process.exit(1);
  });