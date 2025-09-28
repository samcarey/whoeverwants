#!/usr/bin/env node

const { chromium } = require('playwright');

async function testCreatePoll() {
  console.log('🧪 Testing Create Poll Flow...');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3000/create-poll', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(3000);

    // Fill poll title
    console.log('📝 Filling poll title...');
    await page.fill('input#title', 'Test Poll');

    // Click on "Suggestions" button to select nomination type
    console.log('🎯 Selecting Suggestions (nomination) type...');
    await page.click('button:has-text("Suggestions")');
    await page.waitForTimeout(500);

    // Take screenshot before submitting
    await page.screenshot({ path: 'before-submit.png' });

    // Create the poll
    console.log('📤 Submitting poll...');
    await page.click('button:has-text("Submit")');

    // Wait for either redirect or error
    console.log('⏳ Waiting for response...');
    await page.waitForTimeout(5000);

    // Take screenshot after submitting
    await page.screenshot({ path: 'after-submit.png' });

    // Check if we're still on create-poll page
    const currentUrl = page.url();
    console.log('📍 Current URL:', currentUrl);

    // Check for any error messages
    const errorMessages = await page.$$eval('[class*="error"], [class*="Error"], .text-red-600',
      els => els.map(el => el.textContent).filter(t => t.trim()));
    if (errorMessages.length > 0) {
      console.log('❌ Error messages found:', errorMessages);
    }

    // Check if we successfully redirected
    if (currentUrl.includes('/p/')) {
      console.log('✅ Successfully created poll and redirected to:', currentUrl);
      return true;
    } else {
      console.log('❌ Failed to redirect - still on:', currentUrl);
      return false;
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    await page.screenshot({ path: 'error-state.png' });
    return false;
  } finally {
    await browser.close();
  }
}

testCreatePoll();