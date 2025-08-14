import { chromium } from 'playwright';

async function compareCreatePollPages() {
  console.log('🚀 Comparing Create Poll Pages: Local vs External');
  console.log('=' .repeat(60));
  
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    const results = [];
    
    // Test both URLs
    const testUrls = [
      { name: 'Local (localhost:3000)', url: 'http://localhost:3000/create-poll' },
      { name: 'External (decisionbot.a.pinggy.link)', url: 'https://decisionbot.a.pinggy.link/create-poll' }
    ];
    
    for (const test of testUrls) {
      console.log(`\n🧪 Testing: ${test.name}`);
      console.log(`📍 URL: ${test.url}`);
      
      const networkErrors = [];
      const jsErrors = [];
      
      // Track errors
      page.on('response', (response) => {
        if (response.status() >= 400) {
          networkErrors.push(`${response.status()} ${response.url()}`);
        }
      });
      
      page.on('pageerror', (err) => {
        jsErrors.push(err.message);
      });
      
      try {
        await page.goto(test.url, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);
        
        // Check for title input
        const titleInput = await page.locator('input[type="text"]').first();
        const titleInputVisible = await titleInput.isVisible();
        
        // Check for submit button
        const submitButton = await page.locator('button:has-text("Submit")').first();
        const submitButtonExists = await submitButton.count() > 0;
        const submitButtonDisabled = submitButtonExists ? await submitButton.isDisabled() : true;
        
        // Try to fill title
        let titleFillSuccess = false;
        if (titleInputVisible) {
          await titleInput.fill('Test Title');
          const value = await titleInput.inputValue();
          titleFillSuccess = value === 'Test Title';
          
          // Check submit button again after filling
          if (submitButtonExists) {
            await page.waitForTimeout(500);
            const stillDisabled = await submitButton.isDisabled();
            console.log(`🔘 Submit button: ${stillDisabled ? 'DISABLED' : 'ENABLED'} after filling title`);
          }
        }
        
        // Check JavaScript loading
        const hasJavaScript = await page.evaluate(() => {
          return typeof window !== 'undefined' && window.React !== undefined;
        });
        
        results.push({
          name: test.name,
          url: test.url,
          networkErrors: networkErrors.length,
          jsErrors: jsErrors.length,
          titleInputVisible,
          titleFillSuccess,
          submitButtonExists,
          submitButtonDisabled,
          hasJavaScript
        });
        
        console.log(`   ✅ Title input visible: ${titleInputVisible}`);
        console.log(`   ✅ Title fill success: ${titleFillSuccess}`);
        console.log(`   ✅ Submit button exists: ${submitButtonExists}`);
        console.log(`   🔘 Submit button disabled: ${submitButtonDisabled}`);
        console.log(`   ⚛️  JavaScript loaded: ${hasJavaScript}`);
        console.log(`   🚨 Network errors: ${networkErrors.length}`);
        console.log(`   💥 JS errors: ${jsErrors.length}`);
        
        if (networkErrors.length > 0) {
          console.log('   📋 Network errors:');
          networkErrors.forEach(err => console.log(`      - ${err}`));
        }
        
      } catch (error) {
        console.log(`   ❌ Failed to test: ${error.message}`);
        results.push({
          name: test.name,
          url: test.url,
          error: error.message
        });
      }
      
      // Clear listeners for next test
      page.removeAllListeners('response');
      page.removeAllListeners('pageerror');
    }
    
    // Compare results
    console.log('\n' + '=' .repeat(60));
    console.log('📊 COMPARISON RESULTS');
    console.log('=' .repeat(60));
    
    if (results.length === 2) {
      const [local, external] = results;
      
      console.log(`\nSubmit Button Status:`);
      console.log(`   Local: ${local.submitButtonDisabled ? 'DISABLED' : 'ENABLED'}`);
      console.log(`   External: ${external.submitButtonDisabled ? 'DISABLED' : 'ENABLED'}`);
      
      console.log(`\nJavaScript Loading:`);
      console.log(`   Local: ${local.hasJavaScript ? 'LOADED' : 'FAILED'}`);
      console.log(`   External: ${external.hasJavaScript ? 'LOADED' : 'FAILED'}`);
      
      console.log(`\nNetwork Errors:`);
      console.log(`   Local: ${local.networkErrors}`);
      console.log(`   External: ${external.networkErrors}`);
      
      // Diagnosis
      console.log('\n🔍 DIAGNOSIS:');
      if (external.submitButtonDisabled && !local.submitButtonDisabled) {
        console.log('   ❌ External tunnel has disabled submit button while local works');
        console.log('   🔧 Root cause: JavaScript files not loading from external tunnel');
      }
      
      if (external.networkErrors > local.networkErrors) {
        console.log('   ❌ External tunnel has more network errors');
        console.log('   🔧 Tunnel may not be proxying static assets correctly');
      }
    }
    
    return results;
    
  } finally {
    await browser.close();
  }
}

compareCreatePollPages().catch(console.error);