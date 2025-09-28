#!/usr/bin/env node

/**
 * Load the poll page and capture frontend console logs to see nomination processing
 */

const { chromium } = require('playwright');

async function testFrontendLogs() {
  console.log('🔍 Testing Frontend Nomination Processing');
  console.log('========================================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture console logs
  const logs = [];
  page.on('console', msg => {
    if (msg.text().includes('[PollResults]')) {
      logs.push(msg.text());
    }
  });

  try {
    // Visit the poll with both nominations
    const pollId = '12006c39-055b-4fea-8afd-dc061efbf891';
    console.log(`\n📱 Loading poll: ${pollId}`);
    
    await page.goto(`http://localhost:3000/p/${pollId}`, { waitUntil: 'domcontentloaded' });
    
    // Wait for the nomination processing to complete
    await page.waitForTimeout(5000);
    
    console.log('\n📊 Frontend Console Logs:');
    logs.forEach(log => {
      console.log(`   ${log}`);
    });

    // Check what nominations are actually visible
    const visibleNominations = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      
      const foundNominations = [];
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent) {
          if (node.textContent.includes('FirstNom')) foundNominations.push('FirstNom');
          if (node.textContent.includes('SecondNom')) foundNominations.push('SecondNom');
        }
      }
      
      return [...new Set(foundNominations)]; // Remove duplicates
    });

    console.log('\n👀 Visible Nominations in UI:');
    console.log(`   Found: ${JSON.stringify(visibleNominations)}`);
    
    // Take a screenshot for visual inspection
    await page.screenshot({ path: 'nomination-display.png' });
    console.log('\n📸 Screenshot saved: nomination-display.png');

    return {
      logs: logs,
      visibleNominations: visibleNominations,
      hasBoth: visibleNominations.includes('FirstNom') && visibleNominations.includes('SecondNom')
    };

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    return { logs: [], visibleNominations: [], hasBoth: false };
  } finally {
    await browser.close();
  }
}

testFrontendLogs()
  .then(result => {
    console.log('\n📊 SUMMARY:');
    console.log(`   Console logs captured: ${result.logs.length}`);
    console.log(`   Visible nominations: ${result.visibleNominations.length}`);
    console.log(`   Shows both nominations: ${result.hasBoth}`);
    
    if (!result.hasBoth) {
      console.log('\n❌ CONFIRMED: Frontend is not displaying both nominations');
      console.log('   Need to debug the nomination processing logic');
    } else {
      console.log('\n✅ Frontend shows both nominations correctly');
    }
  });
