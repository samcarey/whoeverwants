const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  // Capture console messages
  page.on('console', msg => {
    console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  // First, let's create a ranked choice poll
  console.log('1. Creating a ranked choice poll...');
  await page.goto('http://localhost:3000/create-poll');
  
  // Fill in poll details
  await page.fill('input[placeholder="Enter your poll question"]', 'Test Ranked Choice Poll for Abstain');
  await page.click('button:has-text("Ranked Choice")');
  
  // Add options
  await page.fill('input[placeholder="Option 1"]', 'Option A');
  await page.fill('input[placeholder="Option 2"]', 'Option B');
  await page.click('button:has-text("Add Option")');
  await page.fill('input[placeholder="Option 3"]', 'Option C');
  
  // Set deadline
  await page.fill('input[type="datetime-local"]', '2025-12-31T23:59');
  
  // Create poll
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  
  // Get the poll URL
  const currentUrl = page.url();
  console.log('2. Created poll at:', currentUrl);
  
  // Check that abstain button exists
  const abstainButton = await page.$('button:has-text("Abstain from this vote")');
  if (abstainButton) {
    console.log('3. ✅ Abstain button found on ranked choice poll');
  } else {
    console.log('3. ❌ Abstain button NOT found');
    await browser.close();
    return;
  }
  
  // Click abstain
  console.log('4. Clicking abstain button...');
  await page.click('button:has-text("Abstain from this vote")');
  await page.waitForTimeout(500);
  
  // Check if ranking options are hidden
  const rankingOptions = await page.$('.space-y-2');
  const isHidden = await page.evaluate((el) => {
    return el ? window.getComputedStyle(el).display === 'none' : true;
  }, rankingOptions);
  
  if (isHidden) {
    console.log('5. ✅ Ranking options hidden when abstaining');
  } else {
    console.log('5. ⚠️ Ranking options still visible');
  }
  
  // Submit the abstain vote
  console.log('6. Submitting abstain vote...');
  await page.click('button:has-text("Submit Vote")');
  await page.waitForTimeout(1000);
  
  // Check for success confirmation
  const voteSubmitted = await page.$('h3:has-text("Vote Submitted!")');
  if (voteSubmitted) {
    console.log('7. ✅ Vote submission confirmed');
  } else {
    console.log('7. ❌ Vote submission failed');
    await browser.close();
    return;
  }
  
  // Check if it shows "Abstained"
  const abstainedText = await page.$('span:has-text("Abstained")');
  if (abstainedText) {
    console.log('8. ✅ Shows "Abstained" in confirmation');
  } else {
    console.log('8. ❌ Does not show "Abstained"');
  }
  
  // Now refresh the page to test state restoration
  console.log('9. Refreshing page to test state restoration...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  // Check if it still shows as voted and abstained
  const voteSubmittedAfterRefresh = await page.$('h3:has-text("Vote Submitted!")');
  const abstainedTextAfterRefresh = await page.$('span:has-text("Abstained")');
  
  if (voteSubmittedAfterRefresh && abstainedTextAfterRefresh) {
    console.log('10. ✅ SUCCESS: Abstain state properly restored after refresh!');
  } else {
    console.log('10. ❌ FAILED: Abstain state not restored after refresh');
    console.log('    - Vote submitted shown:', !!voteSubmittedAfterRefresh);
    console.log('    - Abstained text shown:', !!abstainedTextAfterRefresh);
  }
  
  await browser.close();
})();