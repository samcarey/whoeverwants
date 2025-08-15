#!/usr/bin/env node

/**
 * Browser Console Debugging Utility
 * 
 * Captures browser console output using Playwright to debug React applications.
 * Use this to debug client-side React state, component lifecycle, and database fetch errors.
 * 
 * Usage:
 *   node scripts/debug-console.js [poll-id-or-path]
 * 
 * Examples:
 *   node scripts/debug-console.js                                    # Debug homepage
 *   node scripts/debug-console.js /create-poll                       # Debug create poll page
 *   node scripts/debug-console.js f1eb5036-fb77-4baa-9f23-a2774c576c5b  # Debug specific poll
 *   node scripts/debug-console.js /p/poll-id                         # Debug poll page
 */

const { chromium } = require('playwright');

async function debugConsole(target = '') {
  console.log('🔍 Browser Console Debugging Utility\n');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // For server environments
  });
  const page = await browser.newPage();
  
  // Capture all console messages
  const consoleLogs = [];
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    consoleLogs.push({ type, text, timestamp: new Date().toISOString() });
    
    // Color-code console output
    const colors = {
      error: '\x1b[31m',    // Red
      warn: '\x1b[33m',     // Yellow
      info: '\x1b[36m',     // Cyan
      log: '\x1b[37m',      // White
      debug: '\x1b[90m'     // Gray
    };
    const color = colors[type] || '\x1b[37m';
    const reset = '\x1b[0m';
    
    console.log(`${color}[${type.toUpperCase()}]${reset} ${text}`);
  });
  
  // Capture page errors
  page.on('pageerror', error => {
    console.log(`\x1b[31m[PAGE ERROR]\x1b[0m ${error.message}`);
    consoleLogs.push({ type: 'pageerror', text: error.message, timestamp: new Date().toISOString() });
  });
  
  // Capture network errors
  page.on('response', response => {
    if (!response.ok()) {
      const msg = `Network Error: ${response.status()} ${response.url()}`;
      console.log(`\x1b[31m[NETWORK]\x1b[0m ${msg}`);
      consoleLogs.push({ type: 'network', text: msg, timestamp: new Date().toISOString() });
    }
  });
  
  try {
    // Determine URL to visit
    let url;
    if (!target) {
      url = 'http://localhost:3001';
    } else if (target.startsWith('/')) {
      url = `http://localhost:3001${target}`;
    } else if (target.includes('-')) {
      // Looks like a UUID poll ID
      url = `http://localhost:3001/p/${target}`;
    } else {
      url = `http://localhost:3001${target}`;
    }
    
    console.log(`📍 Visiting: ${url}\n`);
    console.log('==== CONSOLE OUTPUT START ====\n');
    
    // Visit the page
    await page.goto(url, { waitUntil: 'networkidle' });
    
    // Wait for React to load and any async operations
    await page.waitForTimeout(5000);
    
    console.log('\n==== CONSOLE OUTPUT END ====\n');
    
    // Analyze console logs
    const errorLogs = consoleLogs.filter(log => log.type === 'error' || log.type === 'pageerror');
    const warningLogs = consoleLogs.filter(log => log.type === 'warn');
    const networkErrors = consoleLogs.filter(log => log.type === 'network');
    
    console.log('📊 SUMMARY:');
    console.log(`   Total console messages: ${consoleLogs.length}`);
    console.log(`   Errors: ${errorLogs.length}`);
    console.log(`   Warnings: ${warningLogs.length}`);
    console.log(`   Network errors: ${networkErrors.length}`);
    
    if (errorLogs.length > 0) {
      console.log('\n❌ ERRORS FOUND:');
      errorLogs.forEach(log => {
        console.log(`   ${log.text}`);
      });
    }
    
    if (warningLogs.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      warningLogs.forEach(log => {
        console.log(`   ${log.text}`);
      });
    }
    
    // Check page state
    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        hasReactErrors: document.body.textContent.includes('Application error'),
        hasLoadingSpinner: !!document.querySelector('.animate-spin'),
        localStorage: {
          votedPolls: localStorage.getItem('votedPolls'),
          pollVoteIds: localStorage.getItem('pollVoteIds'),
          createdPolls: localStorage.getItem('createdPolls')
        }
      };
    });
    
    console.log('\n📱 PAGE STATE:');
    console.log(`   Title: ${pageInfo.title}`);
    console.log(`   URL: ${pageInfo.url}`);
    console.log(`   React errors: ${pageInfo.hasReactErrors}`);
    console.log(`   Loading spinner: ${pageInfo.hasLoadingSpinner}`);
    
    if (pageInfo.localStorage.votedPolls || pageInfo.localStorage.pollVoteIds) {
      console.log('\n💾 LOCALSTORAGE:');
      if (pageInfo.localStorage.votedPolls) {
        console.log(`   Voted polls: ${pageInfo.localStorage.votedPolls}`);
      }
      if (pageInfo.localStorage.pollVoteIds) {
        console.log(`   Vote IDs: ${pageInfo.localStorage.pollVoteIds}`);
      }
    }
    
  } catch (error) {
    console.log(`\n❌ Browser automation error: ${error.message}`);
  }
  
  await browser.close();
  console.log('\n✅ Browser console debugging complete');
}

// Parse command line arguments
const target = process.argv[2] || '';

// Run the debugger
debugConsole(target).catch(error => {
  console.error('❌ Script failed:', error.message);
  process.exit(1);
});