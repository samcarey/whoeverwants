const { chromium } = require('playwright');

async function testCompleteNominationFlow() {
  console.log('🧪 Complete Nomination Flow Test - Full Submission with Logging');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Listen to console messages
  page.on('console', msg => {
    console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`);
  });

  // Listen to requests to debug-logs endpoint
  page.on('request', request => {
    if (request.url().includes('/api/debug-logs')) {
      console.log(`📝 [LOG REQUEST] ${request.method()} ${request.url()}`);
      const body = request.postData();
      if (body) {
        try {
          const parsed = JSON.parse(body);
          console.log(`📝 [LOG] ${parsed.level.toUpperCase()}: ${parsed.message}`);
          if (parsed.data) {
            console.log(`📝 [DATA] ${JSON.stringify(parsed.data, null, 2).substring(0, 200)}...`);
          }
        } catch (e) {
          console.log(`📝 [LOG BODY] ${body.substring(0, 200)}...`);
        }
      }
    }
  });

  // Listen to responses
  page.on('response', response => {
    if (response.url().includes('/api/debug-logs')) {
      console.log(`📝 [LOG RESPONSE] ${response.status()} ${response.url()}`);
    }
  });

  try {
    console.log('📍 Step 1: Navigate to poll...');
    await page.goto('http://localhost:3000/p/451f91ee-271b-4746-9182-b16dfaf6b8ab');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check if poll is already open (from previous test)
    const expiredText = await page.locator('text="Expired"').count();

    if (expiredText > 0) {
      console.log('🔄 Poll is expired - reopening...');

      // Reopen the poll
      const reopenButton = page.locator('button:has-text("Reopen Poll (Dev)")');
      await reopenButton.click();
      await page.waitForTimeout(1000);

      // Handle confirmation modal
      const confirmButton = page.locator('button:has-text("Reopen Poll"):not(:has-text("Dev"))');
      await confirmButton.first().click();
      await page.waitForTimeout(3000);
    } else {
      console.log('✅ Poll is already active');
    }

    console.log('📍 Step 2: Add nomination...');
    const nominationInput = page.locator('input[placeholder*="nomination" i]');

    if (await nominationInput.count() > 0) {
      await nominationInput.fill('Complete Test Nomination with Full Logging');
      console.log('✅ Added nomination text');
      await page.waitForTimeout(500);

      console.log('📍 Step 3: Click Submit Vote...');
      const submitButton = page.locator('button:has-text("Submit")');
      await submitButton.click();
      console.log('✅ Clicked initial submit - waiting for confirmation modal...');
      await page.waitForTimeout(2000);

      console.log('📍 Step 4: Handle confirmation modal...');
      const finalSubmitButton = page.locator('button:has-text("Submit Vote"):not(:disabled)');

      if (await finalSubmitButton.count() > 0) {
        console.log('✅ Found "Submit Vote" button in confirmation modal');

        // Fill optional name field if present
        const nameInput = page.locator('input[placeholder*="name" i], input[placeholder*="Enter your name" i]');
        if (await nameInput.count() > 0) {
          await nameInput.fill('Test User for Logging');
          console.log('✅ Filled voter name');
          await page.waitForTimeout(500);
        }

        await finalSubmitButton.click();
        console.log('✅ Clicked final Submit Vote - waiting for complete submission...');

        // Wait longer for complete submission and all logging
        await page.waitForTimeout(8000);

        console.log('📸 Taking final screenshot after submission...');
        await page.screenshot({ path: 'complete-nomination-submission.png', fullPage: true });

      } else {
        console.log('❌ Could not find final Submit Vote button');
        await page.screenshot({ path: 'no-final-submit.png', fullPage: true });
      }

    } else {
      console.log('❌ Could not find nomination input');
      await page.screenshot({ path: 'no-nomination-input.png', fullPage: true });
    }

    // Get final page state
    const finalBodyText = await page.locator('body').textContent();
    console.log(`📄 Final page content preview: ${finalBodyText.substring(0, 300)}...`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'complete-flow-error.png', fullPage: true });
  } finally {
    await browser.close();
  }

  console.log('🏁 Complete nomination flow test finished');
}

testCompleteNominationFlow().catch(console.error);