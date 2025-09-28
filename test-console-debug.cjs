#!/usr/bin/env node

/**
 * Test that captures browser console to see debug output
 */

const { chromium } = require('playwright');

async function consoleDebugTest() {
  console.log('🎧 Console Debug Test');
  console.log('====================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture console logs
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    if (text.includes('loadExistingNominations') || text.includes('DEBUG')) {
      console.log(`[BROWSER] ${text}`);
    }
  });

  try {
    // Step 1: Create poll
    console.log('\n✅ Creating nomination poll...');
    await page.goto('http://localhost:3000/create-poll', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(2000);
    await page.fill('input#title', 'Console Debug Test');
    await page.click('button:has-text("Suggestions")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Submit")');

    await page.waitForSelector('text=Create Poll', { timeout: 5000 });
    await page.click('button:has-text("Create Poll")');

    await page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 10000 });
    const pollUrl = page.url();
    console.log(`   Poll created: ${pollUrl}`);

    // Wait for page to load and capture initial state
    console.log('\n🔍 Waiting for page load...');
    await page.waitForTimeout(10000); // Wait longer for all console logs

    // Check what's visible
    const hasA = await page.isVisible('text=A');
    const hasB = await page.isVisible('text=B');
    console.log(`   Shows A: ${hasA}`);
    console.log(`   Shows B: ${hasB}`);

    // Print relevant console logs
    console.log('\n📝 Relevant console logs:');
    consoleLogs.forEach(log => {
      if (log.includes('DEBUG') || log.includes('nominations') || log.includes('votes') || log.includes('poll')) {
        console.log(`   ${log}`);
      }
    });

    return true;

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
consoleDebugTest()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 Console Debug Result:', success ? '✅ COMPLETED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });