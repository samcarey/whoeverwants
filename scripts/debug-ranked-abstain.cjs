const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  // Capture ALL console messages including network errors
  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  // Capture network responses
  page.on('response', async response => {
    if (response.url().includes('supabase.co') && response.status() >= 400) {
      console.log(`[NETWORK ERROR] ${response.status()} ${response.url()}`);
      try {
        const body = await response.text();
        console.log(`[RESPONSE BODY] ${body}`);
      } catch (e) {
        console.log(`[RESPONSE ERROR] Could not read body`);
      }
    }
  });
  
  // Use the new ranked choice poll
  const pollUrl = 'http://localhost:3000/p/6e9ec46c-061a-4d3d-9c7f-97b229ed6d5f/';
  console.log('1. Navigating to new ranked choice poll...');
  await page.goto(pollUrl);
  await page.waitForTimeout(2000);
  
  // Check for abstain button
  const abstainButton = await page.$('button:has-text("Abstain from this vote")');
  if (abstainButton) {
    console.log('2. ✅ Abstain button found');
  } else {
    console.log('2. ❌ Abstain button not found');
    await browser.close();
    return;
  }
  
  // Click abstain
  console.log('3. Clicking abstain button...');
  await page.click('button:has-text("Abstain from this vote")');
  await page.waitForTimeout(500);
  
  // Submit the abstain vote
  console.log('4. Submitting abstain vote...');
  await page.click('button:has-text("Submit Vote")');
  
  // Wait and monitor for 5 seconds
  console.log('5. Waiting for response...');
  await page.waitForTimeout(5000);
  
  // Check for any error messages in the UI
  const errorElements = await page.$$('.bg-red-100, .text-red-700, .border-red-300');
  if (errorElements.length > 0) {
    console.log('6. Found error elements:');
    for (let i = 0; i < errorElements.length; i++) {
      const text = await errorElements[i].textContent();
      console.log(`   Error ${i + 1}: ${text}`);
    }
  } else {
    console.log('6. No UI error messages found');
  }
  
  // Check for success
  const voteSubmitted = await page.$('h3:has-text("Vote Submitted!")');
  const abstainedText = await page.$('span:has-text("Abstained")');
  
  console.log('7. Final state:');
  console.log('   - Vote submitted:', !!voteSubmitted);
  console.log('   - Abstained text:', !!abstainedText);
  
  await browser.close();
})();