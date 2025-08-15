// Test complete user flow: create poll, view poll, check homepage
const puppeteer = require('puppeteer');

async function testUserFlow() {
  console.log('🚀 Testing Complete User Flow');
  console.log('===============================');
  
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  try {
    const page = await browser.newPage();
    
    // Capture console logs
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error' || text.includes('🔍 HOMEPAGE DEBUG')) {
        console.log(`[BROWSER ${type.toUpperCase()}] ${text}`);
      }
    });
    
    // Step 1: Load homepage - should show 0 polls
    console.log('\n📍 Step 1: Loading homepage...');
    await page.goto('http://localhost:3001', { waitUntil: 'networkidle2' });
    
    // Check for "No polls created yet" message
    const noPollsMessage = await page.$('text=No polls created yet');
    console.log(`Empty state message present: ${!!noPollsMessage}`);
    
    // Step 2: Create a poll
    console.log('\n📝 Step 2: Creating a poll...');
    await page.goto('http://localhost:3001/create-poll', { waitUntil: 'networkidle2' });
    
    // Fill poll form
    await page.type('input[placeholder*="poll title"]', 'Test Access Control Poll');
    await page.type('input[placeholder*="first option"]', 'Option A');
    
    // Add second option
    const addButton = await page.$('button:has-text("Add Option")');
    if (addButton) await addButton.click();
    await page.waitForTimeout(500);
    await page.type('input[placeholder*="second option"]', 'Option B');
    
    // Submit the poll
    await page.click('button:has-text("Create Poll")');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
    
    const currentUrl = page.url();
    console.log(`Poll created, redirected to: ${currentUrl}`);
    
    // Step 3: Go back to homepage - should now show 1 poll
    console.log('\n🏠 Step 3: Returning to homepage...');
    await page.goto('http://localhost:3001', { waitUntil: 'networkidle2' });
    
    // Wait for polls to load
    await page.waitForTimeout(2000);
    
    // Check for poll presence
    const pollTitle = await page.$('text=Test Access Control Poll');
    console.log(`Created poll visible on homepage: ${!!pollTitle}`);
    
    // Step 4: Open new incognito window (simulates different user)
    console.log('\n🕵️ Step 4: Testing as different user (incognito)...');
    const incognitoContext = await browser.createIncognitoBrowserContext();
    const incognitoPage = await incognitoContext.newPage();
    
    incognitoPage.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (text.includes('🔍 HOMEPAGE DEBUG')) {
        console.log(`[INCOGNITO ${type.toUpperCase()}] ${text}`);
      }
    });
    
    await incognitoPage.goto('http://localhost:3001', { waitUntil: 'networkidle2' });
    await incognitoPage.waitForTimeout(2000);
    
    // Check that poll is NOT visible to different user
    const pollTitleIncognito = await incognitoPage.$('text=Test Access Control Poll');
    console.log(`Poll visible to different user: ${!!pollTitleIncognito}`);
    
    // Step 5: Access poll directly via URL (should add to incognito user's access)
    console.log('\n🔗 Step 5: Accessing poll directly via URL...');
    const pollId = currentUrl.split('/p/')[1]?.split('?')[0];
    if (pollId) {
      await incognitoPage.goto(`http://localhost:3001/p/${pollId}`, { waitUntil: 'networkidle2' });
      await incognitoPage.waitForTimeout(2000);
      
      // Check poll loaded successfully
      const pollContent = await incognitoPage.$('text=Test Access Control Poll');
      console.log(`Poll accessible via direct URL: ${!!pollContent}`);
      
      // Step 6: Go back to homepage - should now show 1 poll for incognito user too
      console.log('\n🏠 Step 6: Incognito user returning to homepage after viewing poll...');
      await incognitoPage.goto('http://localhost:3001', { waitUntil: 'networkidle2' });
      await incognitoPage.waitForTimeout(2000);
      
      const pollTitleAfterViewing = await incognitoPage.$('text=Test Access Control Poll');
      console.log(`Poll now visible after viewing: ${!!pollTitleAfterViewing}`);
    }
    
    await incognitoContext.close();
    
    console.log('\n✅ User Flow Test Complete!');
    console.log('============================');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

// Run the test
testUserFlow();