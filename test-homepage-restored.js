import { chromium } from 'playwright';

async function testHomePageRestored() {
  console.log('🧪 Testing Restored Homepage Poll List');
  console.log('=' .repeat(40));
  
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log('🌐 Navigating to homepage...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 15000 });
    
    // Wait for React to load
    await page.waitForTimeout(3000);
    
    // Check for welcome banner (should NOT be there anymore)
    const hasWelcomeBanner = await page.locator('text=Welcome to WhoeverWants').isVisible();
    console.log(`   Welcome banner: ${hasWelcomeBanner ? '❌ Still present (BAD)' : '✅ Removed (GOOD)'}`);
    
    // Check for poll list sections
    const hasOpenPolls = await page.locator('text=Open Polls').isVisible();
    const hasClosedPolls = await page.locator('text=Closed Polls').isVisible();
    const hasNoPollsMessage = await page.locator('text=No polls created yet').isVisible();
    
    console.log(`   "Open Polls" section: ${hasOpenPolls ? '✅ Found' : '❌ Missing'}`);
    console.log(`   "Closed Polls" section: ${hasClosedPolls ? '✅ Found' : '❌ Missing'}`);
    console.log(`   "No polls" message: ${hasNoPollsMessage ? '⚠️  Visible' : '✅ Hidden'}`);
    
    // Check for actual poll items
    const pollLinks = await page.locator('a[href*="/p/"]').count();
    console.log(`   Poll links found: ${pollLinks}`);
    
    // Check for loading state
    const hasLoadingSpinner = await page.locator('svg.animate-spin').isVisible();
    console.log(`   Loading spinner: ${hasLoadingSpinner ? '⚠️  Still loading' : '✅ Loaded'}`);
    
    // Check for create poll button
    const hasCreateButton = await page.locator('text=Create Poll').isVisible();
    console.log(`   Create Poll button: ${hasCreateButton ? '✅ Found' : '❌ Missing'}`);
    
    // Final assessment
    console.log('\n🎯 ASSESSMENT:');
    
    const restored = !hasWelcomeBanner && (hasOpenPolls || hasClosedPolls || hasNoPollsMessage);
    
    if (restored) {
      console.log('   ✅ SUCCESS! Poll list functionality restored');
      console.log('   ✅ Welcome banner removed');
      console.log('   ✅ Poll sections are present');
      if (pollLinks > 0) {
        console.log(`   ✅ Found ${pollLinks} poll(s) in the list`);
      }
    } else {
      console.log('   ❌ ISSUE: Homepage not fully restored');
      if (hasWelcomeBanner) {
        console.log('     - Welcome banner still present');
      }
      if (!hasOpenPolls && !hasClosedPolls && !hasNoPollsMessage) {
        console.log('     - No poll sections found');
      }
    }
    
    return restored;
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

testHomePageRestored().then(success => {
  console.log(`\n🏁 Result: ${success ? 'PASS' : 'FAIL'}`);
  process.exit(success ? 0 : 1);
});