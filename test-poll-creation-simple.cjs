// Simple poll creation test
const puppeteer = require('puppeteer');

async function testPollCreation() {
  console.log('🧪 Testing Poll Creation');
  console.log('========================');
  
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    
    // Capture console logs
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('Error') || text.includes('✅') || text.includes('❌')) {
        console.log(`[BROWSER] ${text}`);
      }
    });
    
    // Navigate to create poll page
    console.log('\n📍 Navigating to create poll...');
    await page.goto('http://localhost:3001/create-poll', { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
    
    // Fill form
    console.log('📝 Filling form...');
    await page.type('input[type="text"]', 'Test Poll ' + Date.now());
    
    // Wait for options to render
    await page.waitForTimeout(1000);
    
    // Find option inputs by their placeholder text
    await page.waitForSelector('input[placeholder*="Enter"]', { timeout: 5000 });
    const optionInputs = await page.$$('input[placeholder*="Enter"]');
    
    if (optionInputs.length >= 2) {
      await optionInputs[0].type('Option A');
      await optionInputs[1].type('Option B');
      console.log('✅ Form filled');
    } else {
      console.log('❌ Option inputs not found');
      return;
    }
    
    // Submit
    console.log('🚀 Submitting poll...');
    await page.click('button[type="submit"]');
    
    // Wait for navigation or error
    try {
      await page.waitForNavigation({ timeout: 15000 });
      console.log('✅ Navigation successful - poll created!');
      console.log('Final URL:', page.url());
    } catch (e) {
      console.log('⏳ Still loading after 15s, checking page content...');
      
      // Check for loading state
      const loadingText = await page.$eval('body', el => el.textContent).catch(() => '');
      if (loadingText.includes('Redirecting') || loadingText.includes('Creating')) {
        console.log('🔄 Still in creation process');
      }
      
      console.log('Current URL:', page.url());
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testPollCreation();