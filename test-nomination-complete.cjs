const { chromium } = require('playwright');

async function testNominationVotingComplete() {
  console.log('🧪 Complete Nomination Voting Test - Handle Modal & Test Logging');

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

  // Listen to responses from debug-logs endpoint
  page.on('response', response => {
    if (response.url().includes('/api/debug-logs')) {
      console.log(`📝 [LOG RESPONSE] ${response.status()} ${response.url()}`);
    }
  });

  try {
    console.log('📍 Step 1: Navigate to expired poll...');
    await page.goto('http://localhost:3000/p/451f91ee-271b-4746-9182-b16dfaf6b8ab');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('🔄 Step 2: Click "Reopen Poll (Dev)" button...');
    const reopenButton = page.locator('button:has-text("Reopen Poll (Dev)")');

    if (await reopenButton.count() > 0) {
      await reopenButton.click();
      console.log('✅ Clicked initial reopen button');

      // Wait for modal to appear
      await page.waitForTimeout(1000);

      console.log('🔄 Step 3: Handle confirmation modal...');
      // Be more specific - target the modal's confirmation button (not the dev button)
      const confirmButton = page.locator('button:has-text("Reopen Poll"):not(:has-text("Dev"))');

      if (await confirmButton.count() > 0) {
        console.log('✅ Found confirmation modal - clicking "Reopen Poll"');
        await confirmButton.first().click();
        console.log('✅ Clicked confirmation button - waiting for poll to reopen...');

        // Wait for the page to reload/update after reopening
        await page.waitForTimeout(5000);
        await page.waitForLoadState('networkidle');

      } else {
        console.log('❌ Could not find "Reopen Poll" confirmation button');
        await page.screenshot({ path: 'no-confirmation-button.png', fullPage: true });
        return;
      }

    } else {
      console.log('❌ Could not find "Reopen Poll (Dev)" button');
      return;
    }

    console.log('📸 Taking screenshot after reopening...');
    await page.screenshot({ path: 'reopened-poll.png', fullPage: true });

    console.log('📍 Step 4: Looking for nomination voting interface...');

    // Check if poll is now active
    const expiredText = await page.locator('text="Expired"').count();
    if (expiredText > 0) {
      console.log('⚠️ Poll still shows as expired - reopen may have failed');
    } else {
      console.log('✅ Poll no longer shows as expired');
    }

    // Look for voting interface elements
    const voteButtons = await page.locator('button').count();
    const inputs = await page.locator('input').count();
    const textareas = await page.locator('textarea').count();
    console.log(`🎯 Found ${voteButtons} buttons, ${inputs} inputs, ${textareas} textareas`);

    // Look for nomination-specific elements with more comprehensive selectors
    const nominationSelectors = [
      'input[placeholder*="nomination" i]',
      'textarea[placeholder*="nomination" i]',
      'input[placeholder*="candidate" i]',
      'textarea[placeholder*="candidate" i]',
      '[data-testid*="nomination"]',
      '[class*="nomination"]',
      'button:has-text("Add")',
      'button:has-text("Submit")',
      'button:has-text("Nominate")'
    ];

    let totalNominationElements = 0;
    for (const selector of nominationSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        console.log(`🏷️ Found ${count} elements matching "${selector}"`);
        totalNominationElements += count;
      }
    }

    console.log(`🏷️ Total nomination-related elements: ${totalNominationElements}`);

    // Try to find ANY text input that could be for nominations
    const allTextInputs = page.locator('input[type="text"], input:not([type]), textarea');
    const textInputCount = await allTextInputs.count();

    if (textInputCount > 0) {
      console.log(`📝 Step 5: Found ${textInputCount} text inputs - testing nomination submission...`);

      for (let i = 0; i < Math.min(textInputCount, 3); i++) {
        try {
          const input = allTextInputs.nth(i);
          const placeholder = await input.getAttribute('placeholder') || 'No placeholder';
          console.log(`📝 Testing input ${i + 1} with placeholder: "${placeholder}"`);

          await input.fill(`Test Nomination ${i + 1} for Logging System`);
          console.log(`✅ Filled input ${i + 1} with test nomination`);
          await page.waitForTimeout(500);

          // Look for nearby submit buttons
          const nearbySubmitButtons = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Add"), button:has-text("Nominate")');
          const submitCount = await nearbySubmitButtons.count();

          if (submitCount > 0) {
            console.log(`🎯 Found ${submitCount} potential submit buttons - trying first one...`);

            await nearbySubmitButtons.first().click();
            console.log(`✅ Clicked submit button for input ${i + 1} - waiting for logs...`);

            // Wait for potential debug logs and network requests
            await page.waitForTimeout(3000);

            break; // If we successfully submitted, no need to try more inputs
          }
        } catch (error) {
          console.log(`⚠️ Error with input ${i + 1}: ${error.message}`);
        }
      }
    } else {
      console.log('❌ No text inputs found for nominations');
    }

    // Get current page content to understand the state
    const bodyText = await page.locator('body').textContent();
    console.log(`📄 Current page content (first 400 chars): ${bodyText.substring(0, 400)}...`);

    // Take final screenshot
    await page.screenshot({ path: 'final-nomination-test.png', fullPage: true });
    console.log('📸 Final screenshot saved: final-nomination-test.png');

  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ path: 'nomination-test-error.png', fullPage: true });
  } finally {
    await browser.close();
  }

  console.log('🏁 Complete nomination voting test finished');

  // Check for any log files that might have been created
  console.log('📋 Checking for generated log files...');
}

testNominationVotingComplete().catch(console.error);