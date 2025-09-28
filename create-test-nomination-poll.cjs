const { chromium } = require('playwright');

async function createTestNominationPoll() {
  console.log('🧪 Creating Fresh Nomination Poll for Logging Test');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Listen to console messages
  page.on('console', msg => {
    console.log(`[BROWSER] ${msg.type()}: ${msg.text()}`);
  });

  try {
    console.log('📍 Step 1: Navigate to create poll page...');
    await page.goto('http://localhost:3000/create-poll');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    console.log('📍 Step 2: Fill poll details...');

    // Fill poll title
    const titleInput = page.locator('input[placeholder*="title" i], input[placeholder*="question" i]').first();
    await titleInput.fill('Test Nomination Poll with Comprehensive Logging');

    // Set poll type to nomination
    const nominationRadio = page.locator('input[value="nomination"], label:has-text("Nomination")');
    if (await nominationRadio.count() > 0) {
      await nominationRadio.first().click();
      console.log('✅ Selected nomination poll type');
    }

    // Set deadline to future date
    const deadlineInput = page.locator('input[type="datetime-local"], input[placeholder*="deadline" i]');
    if (await deadlineInput.count() > 0) {
      const futureDate = new Date();
      futureDate.setHours(futureDate.getHours() + 2); // 2 hours from now
      const isoString = futureDate.toISOString().slice(0, 16);
      await deadlineInput.fill(isoString);
      console.log('✅ Set deadline 2 hours in the future');
    }

    console.log('📍 Step 3: Create poll...');
    const createButton = page.locator('button:has-text("Create"), button[type="submit"]');
    await createButton.click();
    console.log('✅ Clicked create button - waiting for redirect...');

    // Wait for redirect to poll page
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);

    // Extract poll ID from URL
    const pollIdMatch = currentUrl.match(/\/p\/([a-f0-9-]+)/);
    if (pollIdMatch) {
      const pollId = pollIdMatch[1];
      console.log(`🎯 Created poll with ID: ${pollId}`);

      // Take screenshot of new poll
      await page.screenshot({ path: 'new-nomination-poll.png', fullPage: true });

      console.log('📍 Step 4: Test nomination voting with logging...');

      // Add a nomination
      const nominationInput = page.locator('input[placeholder*="nomination" i], input[placeholder*="Add" i]');
      if (await nominationInput.count() > 0) {
        await nominationInput.fill('Test Nomination with Full Logging System');
        console.log('✅ Added nomination');

        await page.waitForTimeout(500);

        // Submit the nomination
        const submitButton = page.locator('button:has-text("Submit")');
        await submitButton.click();
        console.log('✅ Clicked submit - checking for logs...');

        await page.waitForTimeout(5000);

        await page.screenshot({ path: 'nomination-with-logging.png', fullPage: true });

        return pollId;
      } else {
        console.log('❌ Could not find nomination input on new poll');
      }

    } else {
      console.log('❌ Could not extract poll ID from URL');
    }

  } catch (error) {
    console.error('❌ Poll creation failed:', error);
    await page.screenshot({ path: 'poll-creation-error.png', fullPage: true });
  } finally {
    await browser.close();
  }

  console.log('🏁 Test poll creation completed');
}

createTestNominationPoll().catch(console.error);