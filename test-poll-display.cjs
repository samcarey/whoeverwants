#!/usr/bin/env node

/**
 * Simple test to check what's currently displayed on the poll page
 */

const { chromium } = require('playwright');

async function testPollDisplay() {
  console.log('🎭 Testing Current Poll Display');
  console.log('===============================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Visit the user's poll directly
    const pollId = 'fba2f43b-19a7-4ed2-a58c-18121b94ed31';
    const pollUrl = `http://localhost:3000/p/${pollId}`;

    console.log(`📱 Visiting poll: ${pollUrl}`);

    await page.goto(pollUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Check what's actually displayed
    const pageContent = await page.evaluate(() => {
      // Look for any text content containing "A" or nominations
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      const foundTexts = [];
      let node;
      while (node = walker.nextNode()) {
        const text = node.textContent ? node.textContent.trim() : '';
        if (text.includes('A') || text.includes('nomination') || text.includes('TestNom')) {
          foundTexts.push({
            text: text.slice(0, 100), // First 100 chars
            element: node.parentElement?.tagName || 'unknown',
            className: node.parentElement?.className || 'no-class'
          });
        }
      }

      // Also check for any visible nomination lists or results
      const nominationElements = document.querySelectorAll('[class*="nomination"], [class*="result"], [class*="vote"]');

      return {
        foundTexts: foundTexts.slice(0, 10), // First 10 matches
        hasNominationElements: nominationElements.length > 0,
        nominationElementsCount: nominationElements.length,
        pageTitle: document.title,
        url: window.location.href
      };
    });

    console.log('\n📊 Page Analysis:');
    console.log(`   Page title: ${pageContent.pageTitle}`);
    console.log(`   Current URL: ${pageContent.url}`);
    console.log(`   Nomination-related elements: ${pageContent.nominationElementsCount}`);
    console.log(`   Text matches found: ${pageContent.foundTexts.length}`);

    if (pageContent.foundTexts.length > 0) {
      console.log('\n📝 Text containing "A", "nomination", or "TestNom":');
      pageContent.foundTexts.forEach((item, i) => {
        console.log(`   ${i + 1}. "${item.text}" (${item.element})`);
      });
    }

    // Take screenshot for visual verification
    await page.screenshot({ path: 'current-poll-display.png' });
    console.log('\n📸 Screenshot saved as: current-poll-display.png');

    // Check if there are any results showing
    const hasResults = pageContent.foundTexts.some(item =>
      item.text.toLowerCase().includes('result') ||
      item.text.includes('A') ||
      item.text.includes('TestNom')
    );

    if (hasResults) {
      console.log('\n❌ ISSUE: Poll still shows nominations/results');
      console.log('   Even though database queries return no nominations');
      console.log('   This confirms frontend cache is not refreshing');
      return false;
    } else {
      console.log('\n✅ SUCCESS: Poll correctly shows no nominations');
      console.log('   Frontend display matches database state');
      return true;
    }

  } catch (error) {
    console.error('\n💥 Test failed with error:', error.message);

    try {
      await page.screenshot({ path: 'poll-display-error.png' });
      console.log('📸 Error screenshot saved as: poll-display-error.png');
    } catch (screenshotError) {
      // Ignore screenshot errors
    }

    return false;
  } finally {
    await browser.close();
  }
}

// Run the test
testPollDisplay()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 POLL DISPLAY TEST:', success ? '✅ PASSED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });