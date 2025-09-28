const { chromium } = require('playwright');

async function testNominationVotingWithReopen() {
  console.log('🧪 Testing Nomination Voting - First Reopening Poll, Then Testing');

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
    console.log('📍 Step 1: Navigate to expired poll...');
    await page.goto('http://localhost:3000/p/451f91ee-271b-4746-9182-b16dfaf6b8ab');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('🔄 Step 2: Clicking "Reopen Poll (Dev)" button...');
    const reopenButton = page.locator('button:has-text("Reopen Poll (Dev)")');

    if (await reopenButton.count() > 0) {
      await reopenButton.click();
      console.log('✅ Clicked reopen button - waiting for response...');

      // Wait for the page to reload or update
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle');

      console.log('📸 Taking screenshot after reopening...');
      await page.screenshot({ path: 'after-reopen.png', fullPage: true });

    } else {
      console.log('❌ Could not find "Reopen Poll (Dev)" button');
      await page.screenshot({ path: 'no-reopen-button.png', fullPage: true });
      return;
    }

    console.log('📍 Step 3: Looking for nomination voting interface...');

    // Wait a bit more for React to re-render after reopening
    await page.waitForTimeout(2000);

    // Look for nomination voting elements after reopening
    const voteButtons = await page.locator('button').count();
    const inputs = await page.locator('input').count();
    const textareas = await page.locator('textarea').count();

    console.log(`🎯 Found ${voteButtons} buttons, ${inputs} inputs, ${textareas} textareas`);

    // Look for nomination-specific elements
    const nominationElements = await page.locator('[data-testid*="nomination"], [class*="nomination"], input[placeholder*="nomination" i], textarea[placeholder*="nomination" i]').count();
    console.log(`🏷️  Found ${nominationElements} nomination-related elements`);

    // Look for any text inputs that might be for nominations
    const textInputs = page.locator('input[type="text"], input:not([type]), textarea');
    const textInputCount = await textInputs.count();

    if (textInputCount > 0) {
      console.log(`📝 Step 4: Found ${textInputCount} text inputs - testing nomination submission...`);

      try {
        // Fill the first text input with a test nomination
        await textInputs.first().fill('Test Nomination for Logging System');
        console.log('✅ Filled nomination input with test text');
        await page.waitForTimeout(1000);

        // Look for submit button
        const submitButton = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Add"), button:has-text("Nominate")');
        const submitCount = await submitButton.count();

        if (submitCount > 0) {
          console.log(`🎯 Found ${submitCount} submit buttons - clicking...`);
          await submitButton.first().click();
          console.log('✅ Clicked submit button - waiting for logging...');

          // Wait longer for potential debug logs
          await page.waitForTimeout(5000);

          // Take final screenshot
          await page.screenshot({ path: 'after-nomination-submit.png', fullPage: true });

        } else {
          console.log('❌ No submit buttons found after filling input');
        }
      } catch (error) {
        console.log(`❌ Error during nomination submission: ${error.message}`);
      }
    } else {
      console.log('❌ No text inputs found for nominations');
    }

    // Get final page state
    const finalBodyText = await page.locator('body').textContent();
    console.log(`📄 Final page content preview: ${finalBodyText.substring(0, 300)}...`);

    console.log('📸 Final screenshot saved: after-nomination-submit.png');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'test-error.png', fullPage: true });
  } finally {
    await browser.close();
  }

  console.log('🏁 Nomination voting with reopen test completed');
}

testNominationVotingWithReopen().catch(console.error);