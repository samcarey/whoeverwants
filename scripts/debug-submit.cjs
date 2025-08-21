const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  // Capture ALL console messages
  page.on('console', async msg => {
    console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  await page.goto('http://localhost:3000/p/05829522-1afc-4075-9325-7fb1fd824724/', { waitUntil: 'networkidle' });
  
  console.log('1. Clicking Abstain button...');
  await page.click('button:has-text("Abstain")');
  await page.waitForTimeout(1000);
  
  // Check if abstain button is selected (should have yellow background)
  const abstainButton = await page.$('button:has-text("Abstain")');
  const abstainClass = await abstainButton.getAttribute('class');
  console.log('2. Abstain button classes:', abstainClass);
  
  // Check submit button state
  const submitButton = await page.$('button:has-text("Submit Vote")');
  const submitDisabled = await submitButton.getAttribute('disabled');
  const submitClass = await submitButton.getAttribute('class');
  console.log('3. Submit button disabled:', submitDisabled);
  console.log('4. Submit button classes:', submitClass);
  
  console.log('5. Clicking Submit Vote button...');
  await page.click('button:has-text("Submit Vote")');
  await page.waitForTimeout(1000);
  
  // Check if a confirmation modal appeared
  const modal = await page.$('.fixed.inset-0'); // Common modal pattern
  console.log('6. Modal appeared:', !!modal);
  
  if (modal) {
    console.log('7. Found modal - looking for confirm button...');
    const submitVoteButton = await page.$('button:has-text("Submit Vote")');
    const confirmButton = await page.$('button:has-text("Confirm")');
    if (submitVoteButton) {
      console.log('8. Clicking Submit Vote button in modal...');
      await submitVoteButton.click({ force: true });
      await page.waitForTimeout(2000);
    } else if (confirmButton) {
      console.log('8. Clicking Confirm button...');
      await confirmButton.click();
      await page.waitForTimeout(2000);
    } else {
      console.log('8. No confirm button found - modal buttons:');
      const allModalButtons = await page.$$eval('.fixed.inset-0 button', buttons => buttons.map(b => b.textContent.trim()));
      console.log('   Modal button texts:', allModalButtons);
    }
  }
  
  // Check for any error messages
  const errorElement = await page.$('.bg-red-100');
  if (errorElement) {
    const errorText = await errorElement.textContent();
    console.log('9. Error message found:', errorText);
  } else {
    console.log('9. No error message found');
  }
  
  await browser.close();
})();