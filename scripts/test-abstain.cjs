const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Capture ALL console messages
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    console.log(`[${type.toUpperCase()}]`, text);
    
    // For errors and important logs, also show arguments
    if (type === 'error' || text.includes('Error') || text.includes('Insert') || text.includes('Submitting')) {
      msg.args().forEach(async (arg, i) => {
        try {
          const val = await arg.jsonValue();
          if (val && typeof val === 'object') {
            console.log(`  Arg ${i}:`, JSON.stringify(val, null, 2));
          }
        } catch (e) {
          // Ignore if can't serialize
        }
      });
    }
  });
  
  // Also capture network errors
  page.on('response', response => {
    if (response.status() >= 400 && response.url().includes('supabase')) {
      console.log(`[NETWORK ERROR] ${response.status()} ${response.url()}`);
      response.text().then(body => {
        console.log('[RESPONSE BODY]', body);
      }).catch(() => {});
    }
  });

  console.log('📍 Navigating to poll page...');
  await page.goto('http://localhost:3000/p/3224cfd0-5517-4029-b1b3-34652c2b657a', { waitUntil: 'networkidle' });
  
  console.log('🔘 Clicking Abstain button...');
  await page.click('button:has-text("Abstain")');
  
  console.log('📤 Clicking Submit Vote button...');
  await page.click('button:has-text("Submit Vote")');
  
  console.log('⏳ Waiting for response...');
  await page.waitForTimeout(3000);
  
  // Check for error message on page
  const errorElement = await page.$('.bg-red-100');
  if (errorElement) {
    const errorText = await errorElement.textContent();
    console.log('[PAGE ERROR]', errorText);
  }
  
  // Check if vote was successful
  const successElement = await page.$('text="Vote Submitted!"');
  if (successElement) {
    console.log('✅ Vote submitted successfully!');
  }
  
  await browser.close();
})();