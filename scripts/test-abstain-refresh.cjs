const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  // Capture console messages
  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  // Use the poll we just voted on
  const pollUrl = 'http://localhost:3000/p/6e9ec46c-061a-4d3d-9c7f-97b229ed6d5f/';
  console.log('1. Navigating to poll that was just voted on...');
  await page.goto(pollUrl);
  await page.waitForTimeout(3000);
  
  // Check current state
  const voteSubmitted = await page.$('h3:has-text("Vote Submitted!")');
  const abstainedText = await page.$('span:has-text("Abstained")');
  
  console.log('2. Initial state:');
  console.log('   - Vote submitted:', !!voteSubmitted);
  console.log('   - Abstained text:', !!abstainedText);
  
  // Check localStorage
  const localStorage = await page.evaluate(() => {
    const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
    const pollVoteIds = JSON.parse(localStorage.getItem('pollVoteIds') || '{}');
    return { votedPolls, pollVoteIds };
  });
  console.log('3. localStorage:', localStorage);
  
  // Now refresh to test state restoration
  console.log('4. Refreshing page...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Check state after refresh
  const voteSubmittedAfterRefresh = await page.$('h3:has-text("Vote Submitted!")');
  const abstainedTextAfterRefresh = await page.$('span:has-text("Abstained")');
  
  console.log('5. After refresh:');
  console.log('   - Vote submitted:', !!voteSubmittedAfterRefresh);
  console.log('   - Abstained text:', !!abstainedTextAfterRefresh);
  
  if (voteSubmittedAfterRefresh && abstainedTextAfterRefresh) {
    console.log('6. ✅ SUCCESS: Abstain state properly restored after refresh!');
  } else {
    console.log('6. ❌ FAILED: Abstain state not properly restored');
    
    // Debug what's shown instead
    const editButton = await page.$('button:has-text("Edit")');
    const rankingItems = await page.$$('.flex.items-center.p-2');
    
    console.log('   Debug info:');
    console.log('   - Edit button present:', !!editButton);
    console.log('   - Number of ranking items:', rankingItems.length);
  }
  
  await browser.close();
})();