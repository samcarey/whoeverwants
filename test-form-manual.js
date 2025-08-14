import { chromium } from 'playwright';

async function testCreatePollForm() {
  console.log('🧪 Testing Create Poll Form - Post-Fix Verification');
  console.log('=' .repeat(50));
  
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log('🌐 Navigating to create-poll...');
    await page.goto('http://localhost:3000/create-poll', { waitUntil: 'networkidle' });
    
    console.log('🔍 Checking initial state...');
    
    // Check for the error message initially present
    const initialError = await page.locator('text=Please enter a poll title').isVisible();
    console.log(`   Initial error message: ${initialError ? '✅ Visible' : '❌ Missing'}`);
    
    // Check submit button initial state
    const submitButton = page.locator('button:has-text("Submit")');
    const initiallyDisabled = await submitButton.isDisabled();
    console.log(`   Submit button initially: ${initiallyDisabled ? '✅ Disabled' : '❌ Enabled'}`);
    
    // Fill in the title
    console.log('📝 Filling in the title...');
    const titleInput = page.locator('input[id="title"]');
    await titleInput.fill('My Test Poll');
    
    // Wait a moment for React to process the change
    await page.waitForTimeout(1000);
    
    // Check if error message disappeared
    const errorAfterFill = await page.locator('text=Please enter a poll title').isVisible();
    console.log(`   Error after filling: ${errorAfterFill ? '❌ Still visible' : '✅ Disappeared'}`);
    
    // Check submit button state after filling
    const enabledAfterFill = !(await submitButton.isDisabled());
    console.log(`   Submit button after fill: ${enabledAfterFill ? '✅ Enabled' : '❌ Still disabled'}`);
    
    // Check if JavaScript is working by evaluating React
    const reactLoaded = await page.evaluate(() => {
      return typeof window !== 'undefined' && 
             window.__NEXT_DATA__ !== undefined &&
             document.querySelector('[data-reactroot]') !== null;
    });
    console.log(`   React hydration: ${reactLoaded ? '✅ Working' : '❌ Failed'}`);
    
    // Final status
    console.log('\n🎯 FINAL RESULTS:');
    const success = !errorAfterFill && enabledAfterFill && reactLoaded;
    
    if (success) {
      console.log('   🎉 SUCCESS! Form is working correctly');
      console.log('   ✅ Error message clears when title is entered');
      console.log('   ✅ Submit button enables when form is valid');
      console.log('   ✅ React hydration is working');
    } else {
      console.log('   ❌ ISSUES DETECTED:');
      if (errorAfterFill) console.log('     - Error message not clearing');
      if (!enabledAfterFill) console.log('     - Submit button not enabling');
      if (!reactLoaded) console.log('     - React hydration failing');
    }
    
    return success;
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

testCreatePollForm().then(success => {
  console.log(`\n🏁 Overall result: ${success ? 'PASS' : 'FAIL'}`);
  process.exit(success ? 0 : 1);
});