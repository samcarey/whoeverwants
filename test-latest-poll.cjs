#!/usr/bin/env node

/**
 * Check the latest poll from the logs to see if both nominations display
 */

const { chromium } = require('playwright');

async function testLatestPoll() {
  console.log('🔍 Testing Latest Poll Display');
  console.log('================================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // From the logs, the last successful poll was d7c5a531-4179-408e-a367-57fd0dbbc545
    // It had ['B', 'A'] nominations after edit
    const pollId = 'd7c5a531-4179-408e-a367-57fd0dbbc545';

    console.log(`📱 Loading poll: ${pollId}`);
    await page.goto(`http://localhost:3000/p/${pollId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Check what's actually visible in the results
    const visibleContent = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasA: text.includes('A'),
        hasB: text.includes('B'),
        fullText: text
      };
    });

    console.log('\n📊 Visible Content:');
    console.log(`   Contains "A": ${visibleContent.hasA}`);
    console.log(`   Contains "B": ${visibleContent.hasB}`);
    console.log(`   Both visible: ${visibleContent.hasA && visibleContent.hasB}`);

    // Take screenshot for visual inspection
    await page.screenshot({ path: 'latest-poll-display.png' });
    console.log('\n📸 Screenshot saved: latest-poll-display.png');

    if (visibleContent.hasA && visibleContent.hasB) {
      console.log('\n✅ SUCCESS: Both nominations are displaying correctly');
      return true;
    } else {
      console.log('\n❌ ISSUE: Missing nominations in display');
      console.log('Full page text:');
      console.log(visibleContent.fullText.slice(0, 500));
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    return false;
  } finally {
    await browser.close();
  }
}

testLatestPoll()
  .then(success => {
    console.log('\n' + '='.repeat(40));
    console.log('📊 DISPLAY TEST:', success ? '✅ WORKING' : '❌ BROKEN');
    console.log('='.repeat(40));
  });