const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  // Capture ALL console messages
  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  // Use the new ranked choice poll
  const pollUrl = 'http://localhost:3000/p/6e9ec46c-061a-4d3d-9c7f-97b229ed6d5f/';
  console.log('1. Navigating to poll...');
  await page.goto(pollUrl);
  await page.waitForTimeout(2000);
  
  // Click abstain
  console.log('2. Clicking abstain button...');
  await page.click('button:has-text("Abstain from this vote")');
  await page.waitForTimeout(500);
  
  // Click submit vote button
  console.log('3. Clicking Submit Vote button...');
  await page.click('button:has-text("Submit Vote")');
  await page.waitForTimeout(1000);
  
  // Check if modal appeared
  const modal = await page.$('.fixed.inset-0');
  if (modal) {
    console.log('4. ✅ Confirmation modal appeared');
    
    // Find modal buttons
    const modalButtons = await page.$$eval('.fixed.inset-0 button', buttons => 
      buttons.map(b => b.textContent.trim())
    );
    console.log('5. Modal buttons:', modalButtons);
    
    // Click the Submit Vote button in the modal
    const submitInModal = await page.$('.fixed.inset-0 button:has-text("Submit Vote")');
    if (submitInModal) {
      console.log('6. Clicking Submit Vote in modal...');
      await submitInModal.click();
      await page.waitForTimeout(3000);
    } else {
      console.log('6. ❌ Submit Vote button not found in modal');
    }
  } else {
    console.log('4. ❌ Confirmation modal did not appear');
  }
  
  // Check final state
  const voteSubmitted = await page.$('h3:has-text("Vote Submitted!")');
  const abstainedText = await page.$('span:has-text("Abstained")');
  
  console.log('7. Final state:');
  console.log('   - Vote submitted:', !!voteSubmitted);
  console.log('   - Abstained text:', !!abstainedText);
  
  await browser.close();
})();