// Test poll creation with browser automation
const puppeteer = require('puppeteer');

async function testPollCreation() {
  console.log('🧪 Testing Poll Creation Flow');
  console.log('==============================');
  
  const browser = await puppeteer.launch({ 
    headless: false, // Show browser for debugging
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  try {
    const page = await browser.newPage();
    
    // Capture all console logs
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      console.log(`[BROWSER ${type.toUpperCase()}] ${text}`);
    });
    
    // Navigate to create poll page
    console.log('\n📍 Navigating to create poll page...');
    await page.goto('https://decisionbot.a.pinggy.link/create-poll', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait a bit for page to fully load
    await page.waitForTimeout(2000);
    
    // Fill in poll details
    console.log('\n📝 Filling poll form...');
    
    // Find and fill title field
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    const titleInput = await page.$('input[type="text"]');
    if (titleInput) {
      await titleInput.click();
      await titleInput.type('Debug Test Poll');
      console.log('✅ Title filled');
    }
    
    // Find option inputs
    const optionInputs = await page.$$('input[placeholder*="option"]');
    if (optionInputs.length >= 2) {
      await optionInputs[0].click();
      await optionInputs[0].type('Debug Option A');
      
      await optionInputs[1].click();
      await optionInputs[1].type('Debug Option B');
      console.log('✅ Options filled');
    }
    
    // Try to submit
    console.log('\n🚀 Submitting poll...');
    const submitButton = await page.$('button[type="submit"]');
    if (submitButton) {
      await submitButton.click();
      console.log('✅ Submit button clicked');
      
      // Wait for response or error
      await page.waitForTimeout(10000);
      
      // Check current URL
      const currentUrl = page.url();
      console.log(`Current URL: ${currentUrl}`);
      
      // Check for any visible errors
      const errorElements = await page.$$('[class*="error"], [class*="Error"]');
      console.log(`Error elements found: ${errorElements.length}`);
      
    } else {
      console.log('❌ Submit button not found');
    }
    
    // Keep browser open for manual inspection
    console.log('\n🔍 Keeping browser open for 30 seconds for inspection...');
    await page.waitForTimeout(30000);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

// Run the test
testPollCreation();