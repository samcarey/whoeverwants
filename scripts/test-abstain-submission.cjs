const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  // Capture all console messages with full details
  page.on('console', async msg => {
    const type = msg.type();
    const text = msg.text();
    console.log(`[${type.toUpperCase()}] ${text}`);
    
    // For objects, try to get the actual values
    if (text.includes('Submitting') || text.includes('Insert') || text.includes('Error') || text.includes('error')) {
      for (let i = 0; i < msg.args().length; i++) {
        try {
          const arg = await msg.args()[i].jsonValue();
          if (typeof arg === 'object' && arg !== null) {
            console.log(`  [ARG ${i}]:`, JSON.stringify(arg, null, 2));
          }
        } catch (e) {
          // Ignore if can't serialize
        }
      }
    }
  });
  
  // Also capture network requests to Supabase
  page.on('response', async response => {
    if (response.url().includes('supabase.co')) {
      console.log(`[NETWORK] ${response.status()} ${response.url()}`);
      if (response.status() >= 400) {
        try {
          const body = await response.text();
          console.log(`[RESPONSE BODY]`, body);
        } catch (e) {
          console.log(`[RESPONSE ERROR]`, e.message);
        }
      }
    }
  });
  
  console.log('🔍 Navigating to poll page...');
  await page.goto('http://localhost:3000/p/05829522-1afc-4075-9325-7fb1fd824724/', { waitUntil: 'networkidle' });
  
  console.log('🟡 Clicking Abstain button...');
  await page.click('button:has-text("Abstain")');
  await page.waitForTimeout(500);
  
  console.log('📤 Clicking Submit Vote button...');
  await page.click('button:has-text("Submit Vote")');
  
  console.log('⏳ Waiting for response...');
  await page.waitForTimeout(5000);
  
  // Check if there's an error message displayed
  const errorElement = await page.$('.bg-red-100');
  if (errorElement) {
    const errorText = await errorElement.textContent();
    console.log('[UI ERROR MESSAGE]:', errorText);
  }
  
  // Check if vote was successful (no error message)
  const noError = await page.$('.bg-red-100');
  if (!noError) {
    console.log('✅ No error message displayed - vote may have succeeded');
  }
  
  await browser.close();
})();