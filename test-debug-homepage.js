import { chromium } from 'playwright';

async function testDebugHomepage() {
  console.log('🔍 Testing Debug Homepage on Production');
  console.log('=' .repeat(50));
  
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Capture console messages
    const consoleMessages = [];
    page.on('console', msg => {
      if (msg.text().includes('[DEBUG]')) {
        consoleMessages.push(msg.text());
      }
    });
    
    console.log('🌐 Loading debug homepage...');
    await page.goto('https://whoeverwants.com', { waitUntil: 'networkidle', timeout: 20000 });
    
    // Wait for debug info to populate
    await page.waitForTimeout(5000);
    
    // Check if debug panel exists
    const debugPanel = page.locator('div:has-text("🐛 DEBUG INFO")');
    const hasDebugPanel = await debugPanel.isVisible();
    console.log(`   Debug panel visible: ${hasDebugPanel}`);
    
    if (hasDebugPanel) {
      // Extract debug information from the page
      const debugText = await debugPanel.textContent();
      console.log('\n📊 DEBUG INFORMATION FROM PAGE:');
      console.log(debugText);
    }
    
    // Check console messages
    console.log('\n💬 CONSOLE DEBUG MESSAGES:');
    consoleMessages.forEach(msg => console.log(`   ${msg}`));
    
    // Check what's actually displayed
    const hasOpenPolls = await page.locator('text=Open Polls').isVisible();
    const hasClosedPolls = await page.locator('text=Closed Polls').isVisible();
    const hasNoPollsMsg = await page.locator('text=No polls created yet').isVisible();
    const hasErrorMsg = await page.locator('div.bg-red-100, div.bg-red-900').isVisible();
    
    console.log('\n📄 PAGE STATE:');
    console.log(`   Open Polls section: ${hasOpenPolls}`);
    console.log(`   Closed Polls section: ${hasClosedPolls}`);
    console.log(`   "No polls" message: ${hasNoPollsMsg}`);
    console.log(`   Error message: ${hasErrorMsg}`);
    
    if (hasErrorMsg) {
      const errorText = await page.locator('div.bg-red-100, div.bg-red-900').textContent();
      console.log(`   Error details: ${errorText}`);
    }
    
    // Count actual poll items
    const pollCount = await page.locator('a[href*="/p/"]').count();
    console.log(`   Poll links found: ${pollCount}`);
    
    return { 
      hasDebugPanel, 
      consoleMessages, 
      hasOpenPolls, 
      hasClosedPolls, 
      hasNoPollsMsg, 
      hasErrorMsg,
      pollCount 
    };
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

testDebugHomepage().then(result => {
  if (result) {
    console.log('\n🎯 SUMMARY:');
    if (result.hasDebugPanel) {
      console.log('✅ Debug panel loaded - check debug info above');
    } else {
      console.log('❌ Debug panel not found - deployment may not be ready');
    }
    
    if (result.pollCount > 0) {
      console.log(`✅ Found ${result.pollCount} polls displayed`);
    } else if (result.hasNoPollsMsg) {
      console.log('⚠️  Shows "No polls created yet" - API returned empty');
    } else if (result.hasErrorMsg) {
      console.log('❌ Shows error message - API call failed');
    }
  }
  
  console.log('\n🏁 Debug test complete');
});