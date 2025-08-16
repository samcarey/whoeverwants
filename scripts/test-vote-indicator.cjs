#!/usr/bin/env node

/**
 * Test Vote Indicator Functionality
 * 
 * Tests that vote indicators appear correctly on closed yes/no polls
 * when users have a vote ID stored in localStorage.
 */

const { chromium } = require('playwright');

async function testVoteIndicator() {
  console.log('🧪 Testing Vote Indicator Functionality\n');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  try {
    // Visit homepage
    console.log('📍 Visiting homepage...');
    await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });
    
    // Check if we're in development mode
    const isDev = await page.evaluate(() => {
      return document.documentElement.innerHTML.includes('development');
    });
    
    console.log(`🔧 Development mode: ${isDev}`);
    
    // Navigate to create poll page
    console.log('📝 Navigating to create poll page...');
    await page.goto('http://localhost:3001/create-poll', { waitUntil: 'networkidle' });
    
    // Create a yes/no poll
    console.log('✏️ Creating test yes/no poll...');
    
    // Fill in poll details
    await page.fill('input[placeholder*="question"]', 'Test Poll: Should we test vote indicators?');
    await page.selectOption('select', 'yes_no');
    
    // Set deadline to 1 minute from now
    const tomorrow = new Date();
    tomorrow.setMinutes(tomorrow.getMinutes() + 1);
    const deadlineString = tomorrow.toISOString().slice(0, 16);
    await page.fill('input[type="datetime-local"]', deadlineString);
    
    // Submit the poll
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    
    // Get the poll URL
    const currentUrl = page.url();
    console.log(`📊 Poll created: ${currentUrl}`);
    
    // Vote on the poll
    console.log('🗳️ Voting "Yes" on the poll...');
    await page.click('input[value="yes"]');
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(1000);
    
    // Simulate poll closure by manually closing it (if we're the creator)
    console.log('🔒 Attempting to close poll...');
    const hasCloseButton = await page.locator('button:has-text("Close Poll")').isVisible();
    
    if (hasCloseButton) {
      await page.click('button:has-text("Close Poll")');
      await page.waitForTimeout(500);
      // Confirm closure
      const hasConfirmButton = await page.locator('button:has-text("Yes, Close Poll")').isVisible();
      if (hasConfirmButton) {
        await page.click('button:has-text("Yes, Close Poll")');
        await page.waitForTimeout(2000);
      }
    }
    
    // Check for vote indicator
    console.log('👀 Checking for vote indicator...');
    
    // Look for the "You voted" indicator
    const hasVoteIndicator = await page.locator('text=👆 You voted').isVisible();
    console.log(`✅ Vote indicator visible: ${hasVoteIndicator}`);
    
    if (hasVoteIndicator) {
      // Check if it's next to "Yes" option
      const yesSection = page.locator(':has-text("Yes"):has-text("👆 You voted")');
      const isNextToYes = await yesSection.isVisible();
      console.log(`✅ Indicator next to "Yes" option: ${isNextToYes}`);
      
      if (isNextToYes) {
        console.log('🎉 SUCCESS: Vote indicator is working correctly!');
      } else {
        console.log('⚠️ WARNING: Vote indicator found but not in correct location');
      }
    } else {
      console.log('❌ Vote indicator not found. This could be because:');
      console.log('   - Poll is not closed yet');
      console.log('   - Not in development mode');  
      console.log('   - Vote data not retrieved correctly');
    }
    
    // Check localStorage for vote data
    const voteData = await page.evaluate(() => {
      return {
        votedPolls: localStorage.getItem('votedPolls'),
        pollVoteIds: localStorage.getItem('pollVoteIds')
      };
    });
    
    console.log('\n💾 LocalStorage data:');
    console.log('   Voted polls:', voteData.votedPolls);
    console.log('   Vote IDs:', voteData.pollVoteIds);
    
  } catch (error) {
    console.log(`\n❌ Test failed: ${error.message}`);
  }
  
  await browser.close();
  console.log('\n✅ Vote indicator test complete');
}

// Run the test
testVoteIndicator().catch(error => {
  console.error('❌ Test script failed:', error.message);
  process.exit(1);
});