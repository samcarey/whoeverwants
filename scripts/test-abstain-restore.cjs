const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then(c => c.newPage());
  
  // Capture console messages
  page.on('console', msg => {
    console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  });
  
  // Navigate to a poll (need to create a ranked choice poll first)
  const pollUrl = 'http://localhost:3000/p/05829522-1afc-4075-9325-7fb1fd824724/';
  console.log('1. Navigating to poll...');
  await page.goto(pollUrl);
  await page.waitForTimeout(2000);
  
  // Check current state - let's see what's shown
  const voteSubmitted = await page.$('h3:has-text("Vote Submitted!")');
  const abstainedText = await page.$('span:has-text("Abstained")');
  
  console.log('2. Current state:');
  console.log('   - Vote submitted shown:', !!voteSubmitted);
  console.log('   - Abstained text shown:', !!abstainedText);
  
  // Check localStorage
  const localStorageVotes = await page.evaluate(() => {
    const votedPolls = JSON.parse(localStorage.getItem('votedPolls') || '{}');
    return votedPolls;
  });
  
  console.log('3. localStorage votedPolls:', localStorageVotes);
  
  // Check specifically for our poll ID
  const pollId = '05829522-1afc-4075-9325-7fb1fd824724';
  const voteStatus = localStorageVotes[pollId];
  console.log('4. Vote status for this poll:', voteStatus);
  
  // Test the hasVotedOnPoll function logic
  const hasVoted = voteStatus === true || voteStatus === 'abstained';
  console.log('5. hasVotedOnPoll would return:', hasVoted);
  
  await browser.close();
})();