#!/usr/bin/env node

/**
 * Simple test: just submit one vote and check what happens
 */

const { chromium } = require('playwright');

async function simpleVoteTest() {
  console.log('🧪 Simple Vote Test');
  console.log('===================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Step 1: Create poll
    console.log('\n✅ Step 1: Creating nomination poll...');
    await page.goto('http://localhost:3000/create-poll', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(2000);
    await page.fill('input#title', 'Simple Vote Test');
    await page.click('button:has-text("Suggestions")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Submit")');

    await page.waitForSelector('text=Create Poll', { timeout: 5000 });
    await page.click('button:has-text("Create Poll")');

    await page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 10000 });
    const pollUrl = page.url();
    console.log(`   Poll created: ${pollUrl}`);

    // Step 2: Check initial state before voting
    console.log('\n🔍 Initial state (before any votes):');
    await page.waitForTimeout(5000);
    await page.waitForFunction(() => document.querySelectorAll('input').length > 0, { timeout: 10000 });

    const hasABefore = await page.isVisible('text=A');
    const hasBBefore = await page.isVisible('text=B');
    console.log(`   Shows A: ${hasABefore}`);
    console.log(`   Shows B: ${hasBBefore}`);

    if (hasABefore || hasBBefore) {
      console.log('   ⚠️  WARNING: Poll already shows nominations before voting!');
      console.log('   This suggests contamination from previous tests or cached data');
    }

    // Step 3: Submit single vote "A"
    console.log('\n✅ Step 3: Submitting single vote "A"...');

    const nominationInput = await page.locator('input[placeholder*="nomination"]').first();
    await nominationInput.fill('A');
    await nominationInput.press('Enter');
    await page.waitForTimeout(1000);

    const voterNameInput = await page.locator('input[placeholder*="name"]').first();
    await voterNameInput.fill('SimpleVoter');

    await page.click('button:has-text("Submit Vote")');

    // Handle modal
    try {
      await page.waitForSelector('div[id="modal-root"] div', { state: 'visible', timeout: 10000 });
      const modalSubmitButton = await page.locator('div[id="modal-root"] button:has-text("Submit Vote")');
      await modalSubmitButton.waitFor({ state: 'visible', timeout: 5000 });
      await modalSubmitButton.click();
      console.log('   Modal submitted successfully');
      await page.waitForTimeout(5000);
    } catch (e) {
      console.log('   Modal handling failed:', e.message);
    }

    // Step 4: Check state after single vote
    console.log('\n🔍 State after voting for "A" only:');
    await page.waitForTimeout(3000);

    const hasAAfter = await page.isVisible('text=A');
    const hasBAfter = await page.isVisible('text=B');
    const hasEditButton = await page.isVisible('button:has-text("Edit")');

    console.log(`   Shows A: ${hasAAfter}`);
    console.log(`   Shows B: ${hasBAfter}`);
    console.log(`   Edit button: ${hasEditButton}`);

    // Analysis
    if (!hasEditButton) {
      console.log('\n❌ VOTE FAILED: No edit button appeared');
      return false;
    } else if (hasAAfter && !hasBAfter) {
      console.log('\n✅ PERFECT: Shows only A as expected');
      return true;
    } else if (hasAAfter && hasBAfter) {
      console.log('\n❌ CONTAMINATION BUG: Shows both A and B after voting only for A');
      console.log('   This means the results aggregation is pulling in data from other sources');
      return false;
    } else if (!hasAAfter && hasBAfter) {
      console.log('\n❌ WRONG DISPLAY: Shows B instead of A');
      return false;
    } else {
      console.log('\n❌ NO DISPLAY: Shows neither A nor B');
      return false;
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'simple-vote-error.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
simpleVoteTest()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 Simple Test Result:', success ? '✅ PASSED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });