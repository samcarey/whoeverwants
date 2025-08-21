const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  // Capture console messages
  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  // Create a fresh poll for this test
  console.log('1. Creating a fresh ranked choice poll...');
  
  // Navigate to poll - use our existing one first and clear localStorage
  const pollUrl = 'http://localhost:3000/p/6e9ec46c-061a-4d3d-9c7f-97b229ed6d5f/';
  await page.goto(pollUrl);
  
  // Clear localStorage
  await page.evaluate(() => {
    localStorage.clear();
  });
  
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  console.log('2. Checking if we can vote...');
  const abstainButton = await page.$('button:has-text("Abstain from this vote")');
  if (!abstainButton) {
    console.log('❌ Cannot vote on this poll - it may be closed or already voted');
    await browser.close();
    return;
  }
  
  console.log('3. Submitting abstain vote...');
  
  // Click abstain
  await page.click('button:has-text("Abstain from this vote")');
  await page.waitForTimeout(500);
  
  // Submit vote
  await page.click('button:has-text("Submit Vote")');
  await page.waitForTimeout(1000);
  
  // Click submit in modal
  await page.click('.fixed.inset-0 button:has-text("Submit Vote")');
  await page.waitForTimeout(3000);
  
  // Check submission success
  const voteSubmitted = await page.$('h3:has-text("Vote Submitted!")');
  const abstainedText = await page.$('span:has-text("Abstained")');
  
  console.log('4. After submission:');
  console.log('   - Vote submitted:', !!voteSubmitted);
  console.log('   - Abstained text:', !!abstainedText);
  
  if (!voteSubmitted || !abstainedText) {
    console.log('❌ Vote submission failed');
    await browser.close();
    return;
  }
  
  // Check localStorage immediately after submission
  const localStorageAfterSubmit = await page.evaluate(() => {
    const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
    const pollVoteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
    return { votedPolls, pollVoteIds };
  });
  console.log('5. localStorage after submit:', localStorageAfterSubmit);
  
  // Now refresh and test restoration
  console.log('6. Refreshing page to test restoration...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Check state after refresh
  const voteSubmittedAfterRefresh = await page.$('h3:has-text("Vote Submitted!")');
  const abstainedTextAfterRefresh = await page.$('span:has-text("Abstained")');
  
  console.log('7. After refresh:');
  console.log('   - Vote submitted:', !!voteSubmittedAfterRefresh);
  console.log('   - Abstained text:', !!abstainedTextAfterRefresh);
  
  // Check localStorage after refresh
  const localStorageAfterRefresh = await page.evaluate(() => {
    const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
    const pollVoteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
    return { votedPolls, pollVoteIds };
  });
  console.log('8. localStorage after refresh:', localStorageAfterRefresh);
  
  if (voteSubmittedAfterRefresh && abstainedTextAfterRefresh) {
    console.log('9. ✅ SUCCESS: Abstain state properly restored after refresh!');
  } else {
    console.log('9. ❌ FAILED: Abstain state not restored');
  }
  
  await browser.close();
})();