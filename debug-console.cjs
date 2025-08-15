const { chromium } = require('playwright');

async function debugConsole() {
  console.log('🔍 Launching browser to capture console logs...');
  
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Capture all console events
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    console.log(`[BROWSER ${type.toUpperCase()}] ${text}`);
  });
  
  // Capture errors
  page.on('pageerror', error => {
    console.log(`[BROWSER ERROR] ${error.message}`);
  });
  
  // Capture network failures
  page.on('response', response => {
    if (!response.ok()) {
      console.log(`[NETWORK ERROR] ${response.status()} ${response.url()}`);
    }
  });
  
  try {
    console.log('📍 Navigating to homepage...');
    await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });
    
    // Wait a bit for any async operations
    console.log('⏳ Waiting for page to load...');
    await page.waitForTimeout(5000);
    
    // Check if loading spinner is present
    const spinner = await page.$('.animate-spin');
    console.log('🔄 Loading spinner present:', !!spinner);
    
    // Check for any error elements
    const errorDiv = await page.$('[class*="red"]');
    console.log('❌ Error elements present:', !!errorDiv);
    
    // Get page title to confirm it loaded
    const title = await page.title();
    console.log('📄 Page title:', title);
    
  } catch (error) {
    console.log('❌ Failed to load page:', error.message);
  }
  
  await browser.close();
  console.log('✅ Browser debugging complete');
}

debugConsole().catch(console.error);