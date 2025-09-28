#!/usr/bin/env node

/**
 * Test the nomination deletion fix with existing poll
 */

const { chromium } = require('playwright');

async function testDeletionFix() {
  console.log('🎭 Testing Nomination Deletion Fix...');
  console.log('=====================================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Create a fresh nomination poll quickly
    console.log('\n📝 STEP 1: Creating nomination poll...');

    await page.goto('http://localhost:3000/create-poll', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Wait for the page to load with a longer timeout
    try {
      await page.waitForSelector('input[placeholder*="poll title"], input[placeholder*="title"]', { timeout: 15000 });
    } catch (e) {
      console.log('Could not find title input, taking screenshot...');
      await page.screenshot({ path: 'create-poll-debug.png' });
      throw new Error('Create poll page did not load properly');
    }

    // Fill form quickly
    await page.fill('input[placeholder*="poll title"], input[placeholder*="title"]', 'Quick Delete Test');
    await page.selectOption('select', 'nomination');

    // Set future deadline
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];
    await page.fill('input[type="date"]', tomorrowStr);

    await page.click('button:has-text("Create Poll")');
    await page.waitForTimeout(3000);

    // Get poll ID
    const currentUrl = page.url();
    const pollIdMatch = currentUrl.match(/\/p\/([^\/]+)/);
    if (!pollIdMatch) {
      throw new Error('Failed to extract poll ID from URL: ' + currentUrl);
    }
    const pollId = pollIdMatch[1];
    console.log(`✅ Created poll: ${pollId}`);

    // STEP 2: Submit nomination "TestDelete"
    console.log('\n🗳️ STEP 2: Submitting nomination "TestDelete"...');

    await page.waitForSelector('input[placeholder*="nomination"]', { timeout: 10000 });
    await page.fill('input[placeholder*="nomination"]', 'TestDelete');
    await page.fill('input[placeholder*="name"]', 'TestUser');

    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);
    await page.waitForSelector('button:has-text("Submit"):not([disabled])', { timeout: 10000 });
    await page.click('button:has-text("Submit"):not([disabled])');
    await page.waitForTimeout(3000);

    console.log('✅ Initial nomination submitted');

    // STEP 3: Check nomination appears
    console.log('\n📊 STEP 3: Verifying nomination appears...');

    const beforeEdit = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let foundTestDelete = false;
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes('TestDelete')) {
          foundTestDelete = true;
          break;
        }
      }
      return { foundTestDelete };
    });

    console.log(`   TestDelete visible: ${beforeEdit.foundTestDelete}`);

    if (!beforeEdit.foundTestDelete) {
      console.log('❌ Initial nomination not visible - test cannot continue');
      return false;
    }

    // STEP 4: Edit vote to delete nomination
    console.log('\n✏️ STEP 4: Editing vote to delete nomination...');

    await page.waitForSelector('button:has-text("Edit")', { timeout: 10000 });
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(2000);

    // Clear the nomination field
    const nominationInputs = await page.locator('input[placeholder*="nomination"]').all();
    if (nominationInputs.length > 0) {
      await nominationInputs[0].fill('');
      console.log('   ✅ Cleared nomination field');
    }

    // Submit the edit (abstain)
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);

    const submitButton = page.locator('button:has-text("Submit"):not([disabled])');
    if (await submitButton.isVisible()) {
      await submitButton.click();
      console.log('   ✅ Confirmed deletion');
    }

    // Wait longer for the fix to take effect
    await page.waitForTimeout(5000);

    // STEP 5: Check nomination is deleted
    console.log('\n🔍 STEP 5: Verifying nomination is deleted...');

    const afterEdit = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let foundTestDelete = false;
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.includes('TestDelete')) {
          foundTestDelete = true;
          break;
        }
      }
      return { foundTestDelete };
    });

    console.log(`   TestDelete still visible: ${afterEdit.foundTestDelete}`);

    // ANALYSIS
    console.log('\n📊 ANALYSIS:');
    if (beforeEdit.foundTestDelete && !afterEdit.foundTestDelete) {
      console.log('🎉 SUCCESS: Nomination deletion fix works!');
      console.log('   ✅ Nomination was initially visible');
      console.log('   ✅ Nomination was successfully deleted');
      console.log('   ✅ Results refreshed correctly');
      return true;
    } else {
      console.log('❌ FAILURE: Nomination deletion still not working');
      console.log(`   Before edit: ${beforeEdit.foundTestDelete}`);
      console.log(`   After edit: ${afterEdit.foundTestDelete}`);
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    try {
      await page.screenshot({ path: 'deletion-fix-error.png' });
      console.log('📸 Error screenshot: deletion-fix-error.png');
    } catch (screenshotError) {
      // Ignore
    }
    return false;
  } finally {
    await browser.close();
  }
}

testDeletionFix()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 DELETION FIX TEST:', success ? '✅ PASSED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
