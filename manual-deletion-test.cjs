#!/usr/bin/env node

/**
 * Manual test using existing poll ID
 */

const { chromium } = require('playwright');

async function manualTest() {
  console.log('🎭 Manual Deletion Test with Known Poll...');
  
  const browser = await chromium.launch({ headless: false, slowMo: 1000 }); // Show browser
  const page = await browser.newPage();

  try {
    // Use a known poll ID
    const testPollId = 'a08f4c7b-8e15-4021-855f-dc1f36788a07';
    
    console.log(`📱 Visiting poll: ${testPollId}`);
    await page.goto(`http://localhost:3000/p/${testPollId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Take screenshot to see current state
    await page.screenshot({ path: 'manual-test-initial.png' });
    console.log('📸 Initial screenshot: manual-test-initial.png');

    // Check what's currently on the page
    const pageContent = await page.evaluate(() => {
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
        if (text.includes('A') || text.includes('TestDelete') || text.includes('ServiceKeyTest')) {
          foundTexts.push({
            text: text.slice(0, 100),
            element: node.parentElement?.tagName || 'unknown'
          });
        }
      }

      return {
        foundTexts: foundTexts.slice(0, 10),
        pageTitle: document.title,
        url: window.location.href
      };
    });

    console.log('\n📊 Current page content:');
    console.log(`   Page title: ${pageContent.pageTitle}`);
    console.log(`   URL: ${pageContent.url}`);
    console.log(`   Text matches: ${pageContent.foundTexts.length}`);
    
    pageContent.foundTexts.forEach((item, i) => {
      console.log(`   ${i + 1}. "${item.text}" (${item.element})`);
    });

    console.log('\n✅ Manual test complete - check browser and screenshots');
    console.log('The browser will stay open for 30 seconds for you to inspect...');
    
    // Keep browser open for inspection
    await page.waitForTimeout(30000);

  } catch (error) {
    console.error('\n💥 Manual test error:', error.message);
    await page.screenshot({ path: 'manual-test-error.png' });
  } finally {
    await browser.close();
  }
}

manualTest().catch(console.error);
