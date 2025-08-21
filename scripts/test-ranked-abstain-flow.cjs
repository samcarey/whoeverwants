const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  // Capture console messages
  page.on('console', msg => {
    console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  // Use an existing ranked choice poll
  const pollUrl = 'http://localhost:3000/p/8d2d0754-f55c-41f3-8196-23df076b5234/';
  console.log('1. Navigating to ranked choice poll...');
  await page.goto(pollUrl);
  await page.waitForTimeout(2000);
  
  // Check if we can vote (poll should be open)
  const abstainButton = await page.$('button:has-text("Abstain from this vote")');
  const submitButton = await page.$('button:has-text("Submit Vote")');
  
  if (!abstainButton || !submitButton) {
    console.log('2. ❌ Poll is already voted on or closed. Clearing localStorage...');
    
    // Clear localStorage and refresh
    await page.evaluate(() => {
      localStorage.removeItem('votedPolls');
      localStorage.removeItem('voteIds');
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
  }
  
  // Check again for abstain button
  const abstainButtonAfterClear = await page.$('button:has-text("Abstain from this vote")');
  if (abstainButtonAfterClear) {
    console.log('3. ✅ Abstain button found on ranked choice poll');
  } else {
    console.log('3. ❌ Abstain button still not found - poll may be closed');
    await browser.close();
    return;
  }
  
  // Click abstain
  console.log('4. Clicking abstain button...');
  await page.click('button:has-text("Abstain from this vote")');
  await page.waitForTimeout(500);
  
  // Verify abstain state
  const abstainButtonSelected = await page.$('button:has-text("Abstaining (click to cancel)")');
  if (abstainButtonSelected) {
    console.log('5. ✅ Abstain button shows selected state');
  } else {
    console.log('5. ❌ Abstain button not showing selected state');
  }
  
  // Submit the abstain vote
  console.log('6. Submitting abstain vote...');
  await page.click('button:has-text("Submit Vote")');
  await page.waitForTimeout(3000); // Wait longer for submission
  
  // Check for success confirmation
  const voteSubmitted = await page.$('h3:has-text("Vote Submitted!")');
  if (voteSubmitted) {
    console.log('7. ✅ Vote submission confirmed');
  } else {
    console.log('7. ❌ Vote submission failed');
    
    // Check for any error messages
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
    console.log('8. ✅ Shows "Abstained" in confirmation');
  } else {
    console.log('8. ❌ Does not show "Abstained"');
  }
  
  // Check localStorage after submission
  const localStorageAfterSubmit = await page.evaluate(() => {
    const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
    return votedPolls;
  });
  console.log('9. localStorage after submit:', localStorageAfterSubmit);
  
  // Now refresh the page to test state restoration
  console.log('10. Refreshing page to test state restoration...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Check if it still shows as voted and abstained
  const voteSubmittedAfterRefresh = await page.$('h3:has-text("Vote Submitted!")');
  const abstainedTextAfterRefresh = await page.$('span:has-text("Abstained")');
  
  console.log('11. After refresh:');
  console.log('    - Vote submitted shown:', !!voteSubmittedAfterRefresh);
  console.log('    - Abstained text shown:', !!abstainedTextAfterRefresh);
  
  if (voteSubmittedAfterRefresh && abstainedTextAfterRefresh) {
    console.log('12. ✅ SUCCESS: Abstain state properly restored after refresh!');
  } else {
    console.log('12. ❌ FAILED: Abstain state not restored after refresh');
  }
  
  await browser.close();
})();