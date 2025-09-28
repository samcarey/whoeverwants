const { chromium } = require('playwright');

async function testNominationVoting() {
  console.log('🧪 Testing Nomination Voting with Logging System');

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
      console.log(`📝 [LOG BODY] ${request.postData() || 'No body'}`);
    }
  });

  try {
    console.log('📍 Navigating to poll...');
    await page.goto('http://localhost:3000/p/451f91ee-271b-4746-9182-b16dfaf6b8ab');
    await page.waitForLoadState('networkidle');

    console.log('🔍 Looking for nomination voting interface...');

    // Wait for React to render
    await page.waitForTimeout(2000);

    // Take screenshot to see current state
    await page.screenshot({ path: 'nomination-voting-test.png', fullPage: true });
    console.log('📸 Screenshot saved: nomination-voting-test.png');

    // Look for nomination voting elements
    const voteButtons = await page.locator('button').count();
    const inputs = await page.locator('input').count();
    const textareas = await page.locator('textarea').count();

    console.log(`🎯 Found ${voteButtons} buttons, ${inputs} inputs, ${textareas} textareas`);

    // Look specifically for nomination-related elements
    const nominationElements = await page.locator('[data-testid*="nomination"], [class*="nomination"], button:has-text("Submit"), button:has-text("Vote")').count();
    console.log(`🏷️  Found ${nominationElements} nomination-related elements`);

    // If we find voting elements, try to interact with them
    if (voteButtons > 0) {
      console.log('🎯 Attempting to interact with voting interface...');

      // Look for vote buttons or form elements
      const submitButtons = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Vote")');
      const submitCount = await submitButtons.count();

      if (submitCount > 0) {
        console.log(`📋 Found ${submitCount} submit/vote buttons`);

        // Try to click the first submit button
        try {
          await submitButtons.first().click();
          console.log('✅ Clicked submit button - waiting for response...');

          // Wait for potential network requests
          await page.waitForTimeout(3000);

        } catch (error) {
          console.log(`❌ Error clicking submit button: ${error.message}`);
        }
      }

      // Look for text inputs where we might enter nominations
      const textInputs = page.locator('input[type="text"], textarea');
      const textInputCount = await textInputs.count();

      if (textInputCount > 0) {
        console.log(`📝 Found ${textInputCount} text inputs - trying to fill one...`);

        try {
          await textInputs.first().fill('Test nomination for logging');
          console.log('✅ Filled text input');

          // Now look for submit button again
          const submitAfterFill = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Vote")');
          if (await submitAfterFill.count() > 0) {
            await submitAfterFill.first().click();
            console.log('✅ Clicked submit after filling input - waiting for logs...');
            await page.waitForTimeout(5000);
          }
        } catch (error) {
          console.log(`❌ Error filling input: ${error.message}`);
        }
      }
    }

    // Get page content to see what's actually rendered
    const pageTitle = await page.title();
    const bodyText = await page.locator('body').textContent();

    console.log(`📄 Page title: ${pageTitle}`);
    console.log(`📄 Body contains: ${bodyText.substring(0, 200)}...`);

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }

  console.log('🏁 Nomination voting test completed');
}

testNominationVoting().catch(console.error);