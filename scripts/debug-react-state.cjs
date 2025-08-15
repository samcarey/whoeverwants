#!/usr/bin/env node

/**
 * React State Debugging Utility
 * 
 * Specialized tool for debugging React state issues, localStorage, and component lifecycle.
 * Provides detailed React-specific debugging information.
 * 
 * Usage:
 *   node scripts/debug-react-state.js [poll-id] [action]
 * 
 * Examples:
 *   node scripts/debug-react-state.js poll-123 vote      # Debug voting process
 *   node scripts/debug-react-state.js poll-123 revisit   # Debug vote retrieval
 *   node scripts/debug-react-state.js                    # Debug current state
 */

const { chromium } = require('playwright');

async function debugReactState(pollId = '', action = '') {
  console.log('⚛️  React State Debugging Utility\n');
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Filter for React-specific console messages
  const reactLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    
    // Filter for relevant React debugging
    if (text.includes('useEffect') || 
        text.includes('useState') || 
        text.includes('Component') ||
        text.includes('vote') ||
        text.includes('Vote') ||
        text.includes('fetch') ||
        text.includes('localStorage') ||
        text.includes('Error')) {
      reactLogs.push({ type, text });
      console.log(`[${type.toUpperCase()}] ${text}`);
    }
  });
  
  try {
    let url = 'http://localhost:3001';
    if (pollId) {
      url = `http://localhost:3001/p/${pollId}`;
    }
    
    console.log(`📍 Debugging React state at: ${url}\n`);
    
    if (action === 'vote') {
      console.log('🗳️  Testing voting process...\n');
      
      // Clear localStorage first
      await page.goto(url);
      await page.evaluate(() => {
        localStorage.removeItem('votedPolls');
        localStorage.removeItem('pollVoteIds');
      });
      
      // Try to vote
      const voteResult = await page.evaluate(() => {
        const yesButton = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Yes');
        const submitButton = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Submit Vote'));
        
        if (yesButton && submitButton && !yesButton.disabled && !submitButton.disabled) {
          yesButton.click();
          setTimeout(() => submitButton.click(), 500);
          return { success: true, message: 'Vote initiated' };
        } else {
          return { success: false, message: 'Cannot vote (buttons disabled or not found)' };
        }
      });
      
      console.log('Vote attempt:', voteResult);
      
      if (voteResult.success) {
        // Wait for vote to complete
        await page.waitForSelector('h3:has-text("Vote Submitted!")', { timeout: 10000 });
        
        // Check localStorage after voting
        const postVoteState = await page.evaluate(() => ({
          votedPolls: JSON.parse(localStorage.getItem('votedPolls') || '{}'),
          pollVoteIds: JSON.parse(localStorage.getItem('pollVoteIds') || '{}')
        }));
        
        console.log('📦 localStorage after voting:', postVoteState);
      }
      
    } else if (action === 'revisit') {
      console.log('🔄 Testing vote retrieval process...\n');
      
      await page.goto(url);
      
      // Check if there's existing vote data
      const existingState = await page.evaluate(() => ({
        votedPolls: JSON.parse(localStorage.getItem('votedPolls') || '{}'),
        pollVoteIds: JSON.parse(localStorage.getItem('pollVoteIds') || '{}')
      }));
      
      console.log('📦 Existing localStorage:', existingState);
      
      // Wait for component to load and fetch data
      await page.waitForTimeout(5000);
      
      // Check final UI state
      const uiState = await page.evaluate(() => {
        const text = document.body.textContent;
        return {
          hasVoteSubmitted: text.includes('Vote Submitted!'),
          showsYourVote: text.includes('Your vote:'),
          showsYes: text.includes('Your vote:') && text.includes('Yes'),
          showsNo: text.includes('Your vote:') && text.includes('No'),
          hasVoteId: text.includes('Vote ID:')
        };
      });
      
      console.log('🎨 UI State:', uiState);
      
    } else {
      // Default: just visit and analyze state
      await page.goto(url);
      await page.waitForTimeout(3000);
      
      const currentState = await page.evaluate(() => ({
        url: window.location.href,
        localStorage: {
          votedPolls: localStorage.getItem('votedPolls'),
          pollVoteIds: localStorage.getItem('pollVoteIds'),
          createdPolls: localStorage.getItem('createdPolls')
        },
        pageContent: {
          hasVoteInterface: !!document.querySelector('button:has-text("Yes")'),
          hasVoteSubmitted: document.body.textContent.includes('Vote Submitted!'),
          hasErrors: document.body.textContent.includes('Error')
        }
      }));
      
      console.log('📊 Current React State:');
      console.log('   URL:', currentState.url);
      console.log('   Has vote interface:', currentState.pageContent.hasVoteInterface);
      console.log('   Has voted:', currentState.pageContent.hasVoteSubmitted);
      console.log('   Has errors:', currentState.pageContent.hasErrors);
      
      if (currentState.localStorage.votedPolls) {
        console.log('   Voted polls:', currentState.localStorage.votedPolls);
      }
      if (currentState.localStorage.pollVoteIds) {
        console.log('   Vote IDs:', currentState.localStorage.pollVoteIds);
      }
    }
    
    // Summary of React-specific logs
    if (reactLogs.length > 0) {
      console.log('\n⚛️  React Debug Messages:');
      reactLogs.forEach(log => {
        console.log(`   [${log.type}] ${log.text}`);
      });
    } else {
      console.log('\n📝 No React debug messages captured (add console.log to components for more details)');
    }
    
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  await browser.close();
  console.log('\n✅ React state debugging complete');
}

// Parse arguments
const pollId = process.argv[2] || '';
const action = process.argv[3] || '';

debugReactState(pollId, action).catch(console.error);