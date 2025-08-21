const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  // Capture console messages
  page.on('console', msg => {
    console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  // Use the new ranked choice poll
  const pollUrl = 'http://localhost:3000/p/6e9ec46c-061a-4d3d-9c7f-97b229ed6d5f/';
  console.log('1. Navigating to new ranked choice poll...');
  await page.goto(pollUrl);
  await page.waitForTimeout(2000);
  
  // Check for abstain button
  const abstainButton = await page.$('button:has-text("Abstain from this vote")');
  if (abstainButton) {
    console.log('2. ✅ Abstain button found on ranked choice poll');
  } else {
    console.log('2. ❌ Abstain button not found');
    await browser.close();
    return;
  }
  
  // Click abstain
  console.log('3. Clicking abstain button...');
  await page.click('button:has-text("Abstain from this vote")');
  await page.waitForTimeout(500);
  
  // Verify abstain state
  const abstainButtonSelected = await page.$('button:has-text("Abstaining (click to cancel)")');
  if (abstainButtonSelected) {
    console.log('4. ✅ Abstain button shows selected state');
  } else {
    console.log('4. ❌ Abstain button not showing selected state');
  }
  
  // Submit the abstain vote
  console.log('5. Submitting abstain vote...');
  await page.click('button:has-text("Submit Vote")');
  await page.waitForTimeout(3000);
  
  // Check for success confirmation
  const voteSubmitted = await page.$('h3:has-text("Vote Submitted!")');
  if (voteSubmitted) {
    console.log('6. ✅ Vote submission confirmed');
  } else {
    console.log('6. ❌ Vote submission failed');
    const errorMsg = await page.$('.bg-red-100');
    if (errorMsg) {
      const errorText = await errorMsg.textContent();
      console.log('   Error message:', errorText);
    }
    await browser.close();
    return;
  }
  
  // Check if it shows "Abstained"
  const abstainedText = await page.$('span:has-text("Abstained")');
  if (abstainedText) {
    console.log('7. ✅ Shows "Abstained" in confirmation');
  } else {
    console.log('7. ❌ Does not show "Abstained"');
  }
  
  // Check localStorage after submission
  const localStorageAfterSubmit = await page.evaluate(() => {
    const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
    const voteIds = JSON.parse(localStorage.getItem('voteIds') || '{}');
    return { votedPolls, voteIds };
  });
  console.log('8. localStorage after submit:', localStorageAfterSubmit);
  
  // Now refresh the page to test state restoration
  console.log('9. Refreshing page to test state restoration...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Check if it still shows as voted and abstained
  const voteSubmittedAfterRefresh = await page.$('h3:has-text("Vote Submitted!")');
  const abstainedTextAfterRefresh = await page.$('span:has-text("Abstained")');
  
  console.log('10. After refresh:');
  console.log('    - Vote submitted shown:', !!voteSubmittedAfterRefresh);
  console.log('    - Abstained text shown:', !!abstainedTextAfterRefresh);
  
  if (voteSubmittedAfterRefresh && abstainedTextAfterRefresh) {
    console.log('11. ✅ SUCCESS: Abstain state properly restored after refresh!');
  } else {
    console.log('11. ❌ FAILED: Abstain state not restored after refresh');
  }
  
  await browser.close();
})();