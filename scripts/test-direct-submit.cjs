const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  // Capture ALL console messages including errors
  page.on('console', msg => {
    console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  // Capture JavaScript errors
  page.on('pageerror', err => {
    console.log('[PAGE ERROR]', err.message);
  });
  
  await page.goto('http://localhost:3000/p/05829522-1afc-4075-9325-7fb1fd824724/', { waitUntil: 'networkidle' });
  
  console.log('1. Clicking Abstain...');
  await page.click('button:has-text("Abstain")');
  await page.waitForTimeout(500);
  
  console.log('2. Clicking Submit Vote...');
  await page.click('button:has-text("Submit Vote")');
  await page.waitForTimeout(1000);
  
  console.log('3. Looking for modal Submit Vote button...');
  // Try to click the modal confirm button using JavaScript execution
  const modalSubmitClicked = await page.evaluate(() => {
    // Find the modal
    const modal = document.querySelector('.fixed.inset-0');
    if (!modal) return 'No modal found';
    
    // Find all buttons in the modal
    const buttons = modal.querySelectorAll('button');
    console.log('Modal buttons found:', buttons.length);
    
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      console.log(`Button ${i}: "${btn.textContent.trim()}"`);
      
      if (btn.textContent.trim().includes('Submit Vote')) {
        console.log('Found Submit Vote button, clicking...');
        btn.click();
        return 'Clicked Submit Vote button';
      }
    }
    
    return 'Submit Vote button not found in modal';
  });
  
  console.log('4. Modal submit result:', modalSubmitClicked);
  await page.waitForTimeout(3000);
  
  // Check for errors
  const errorElement = await page.$('.bg-red-100');
  if (errorElement) {
    const errorText = await errorElement.textContent();
    console.log('5. Error found:', errorText);
  } else {
    console.log('5. No error message displayed');
  }
  
  await browser.close();
})();