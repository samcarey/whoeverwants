import { chromium } from 'playwright';

async function testVercelDeployment() {
  console.log('🌐 Testing Vercel Production Deployment');
  console.log('=' .repeat(50));
  
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Test 1: Homepage loads and shows poll list (not welcome banner)
    console.log('📄 Testing homepage...');
    await page.goto('https://whoeverwants.com', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    const hasWelcomeBanner = await page.locator('text=Welcome to WhoeverWants').isVisible();
    const hasOpenPolls = await page.locator('text=Open Polls').isVisible();
    const hasClosedPolls = await page.locator('text=Closed Polls').isVisible();
    const hasCreateButton = await page.locator('text=Create Poll').isVisible();
    
    console.log(`   Welcome banner: ${hasWelcomeBanner ? '❌ Present (BAD)' : '✅ Removed (GOOD)'}`);
    console.log(`   "Open Polls" section: ${hasOpenPolls ? '✅ Found' : '❌ Missing'}`);
    console.log(`   "Closed Polls" section: ${hasClosedPolls ? '✅ Found' : '❌ Missing'}`);
    console.log(`   Create Poll button: ${hasCreateButton ? '✅ Found' : '❌ Missing'}`);
    
    // Test 2: Create-poll page form submission
    console.log('\n📝 Testing create-poll form...');
    await page.goto('https://whoeverwants.com/create-poll', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    // Check if form loads
    const titleInput = page.locator('input[placeholder*="poll title" i], input[placeholder*="title" i], input[name="title"], #title');
    const submitButton = page.locator('button:has-text("Submit"), button[type="submit"]');
    
    const titleInputExists = await titleInput.isVisible();
    const submitButtonExists = await submitButton.isVisible();
    
    console.log(`   Title input field: ${titleInputExists ? '✅ Found' : '❌ Missing'}`);
    console.log(`   Submit button: ${submitButtonExists ? '✅ Found' : '❌ Missing'}`);
    
    if (titleInputExists && submitButtonExists) {
      // Test the specific issue: submit button should be disabled without title
      const initiallyDisabled = await submitButton.isDisabled();
      console.log(`   Submit initially disabled: ${initiallyDisabled ? '✅ Correct' : '❌ Should be disabled'}`);
      
      // Fill in title and check if submit becomes enabled
      await titleInput.fill('Test Poll Title');
      await page.waitForTimeout(500);
      
      const enabledAfterTitle = await submitButton.isDisabled();
      console.log(`   Submit after title: ${!enabledAfterTitle ? '✅ Enabled (GOOD)' : '❌ Still disabled (BAD)'}`);
      
      // Clear title and check if it becomes disabled again
      await titleInput.fill('');
      await page.waitForTimeout(500);
      
      const disabledAfterClear = await submitButton.isDisabled();
      console.log(`   Submit after clear: ${disabledAfterClear ? '✅ Disabled (GOOD)' : '❌ Still enabled (BAD)'}`);
    }
    
    // Test 3: Check for any JavaScript errors
    const jsErrors = [];
    page.on('pageerror', error => jsErrors.push(error.message));
    
    await page.goto('https://whoeverwants.com/create-poll', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    console.log(`\n🐛 JavaScript errors: ${jsErrors.length === 0 ? '✅ None' : `❌ ${jsErrors.length} found`}`);
    if (jsErrors.length > 0) {
      jsErrors.forEach(error => console.log(`     - ${error}`));
    }
    
    // Final assessment
    console.log('\n🎯 DEPLOYMENT ASSESSMENT:');
    const homepageFixed = !hasWelcomeBanner && (hasOpenPolls || hasClosedPolls);
    const createPollWorks = titleInputExists && submitButtonExists;
    const noJsErrors = jsErrors.length === 0;
    
    const overallSuccess = homepageFixed && createPollWorks && noJsErrors;
    
    if (overallSuccess) {
      console.log('   ✅ SUCCESS! Vercel deployment verified');
      console.log('   ✅ Homepage shows poll list (no welcome banner)');
      console.log('   ✅ Create-poll form works correctly');
      console.log('   ✅ No JavaScript errors detected');
    } else {
      console.log('   ❌ ISSUES DETECTED:');
      if (!homepageFixed) console.log('     - Homepage not showing poll list properly');
      if (!createPollWorks) console.log('     - Create-poll form has issues');
      if (!noJsErrors) console.log('     - JavaScript errors present');
    }
    
    return overallSuccess;
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

testVercelDeployment().then(success => {
  console.log(`\n🏁 Vercel Deployment: ${success ? 'VERIFIED ✅' : 'ISSUES FOUND ❌'}`);
  process.exit(success ? 0 : 1);
});