import { chromium } from 'playwright';

async function debugCreatePoll() {
  console.log('🚀 Starting Create Poll Debug with Playwright');
  console.log('=' .repeat(60));
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security'
    ]
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });

    const page = await context.newPage();
    
    // Track console messages and errors
    const consoleMessages = [];
    const networkErrors = [];
    const jsErrors = [];

    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      consoleMessages.push({ type, text });
      if (type === 'error') {
        console.log(`🚨 Console Error: ${text}`);
      } else if (type === 'warn') {
        console.log(`⚠️  Console Warning: ${text}`);
      }
    });

    page.on('pageerror', (err) => {
      const error = `💥 Page Error: ${err.message}`;
      jsErrors.push(error);
      console.log(error);
    });

    page.on('response', (response) => {
      if (response.status() >= 400) {
        const error = `❌ Network Error: ${response.status()} ${response.url()}`;
        networkErrors.push(error);
        console.log(error);
      }
    });

    // Test both localhost and external tunnel
    const testUrls = [
      'http://localhost:3000/create-poll',
      'https://decisionbot.a.pinggy.link/create-poll'
    ];
    
    for (const testUrl of testUrls) {
      console.log(`\n🌐 Testing: ${testUrl}`);
      
      // Navigate to create-poll page
      console.log('🌐 Navigating to create-poll page...');
      await page.goto(testUrl, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

    // Wait for page to fully load
    await page.waitForTimeout(2000);

    console.log('📄 Page loaded, analyzing form elements...');

    // Check page title and basic elements
    const title = await page.title();
    console.log(`📋 Page Title: "${title}"`);

    // Take screenshot of initial state
    await page.screenshot({ path: '/tmp/create-poll-initial.png', fullPage: true });
    console.log('📸 Initial screenshot saved: /tmp/create-poll-initial.png');

    // Check for form elements
    const titleInput = await page.locator('input[type="text"]').first();
    const titleInputCount = await page.locator('input[type="text"]').count();
    console.log(`🔍 Found ${titleInputCount} text input(s)`);

    // Check for submit button
    const submitButtons = await page.locator('button[type="submit"], button:has-text("Create")').all();
    console.log(`🔘 Found ${submitButtons.length} submit button(s)`);

    if (submitButtons.length > 0) {
      for (let i = 0; i < submitButtons.length; i++) {
        const buttonText = await submitButtons[i].textContent();
        const isDisabled = await submitButtons[i].isDisabled();
        console.log(`   Button ${i + 1}: "${buttonText}" - ${isDisabled ? 'DISABLED' : 'ENABLED'}`);
      }
    }

    // Try to fill out the form
    console.log('\n📝 Testing form interaction...');
    
    if (await titleInput.isVisible()) {
      console.log('✅ Title input is visible, attempting to fill...');
      
      // Clear and fill title
      await titleInput.clear();
      await titleInput.fill('Test Poll Title');
      
      // Verify the value was set
      const titleValue = await titleInput.inputValue();
      console.log(`📝 Title input value: "${titleValue}"`);
      
      // Check if there are any validation messages
      const validationMessages = await page.locator('.error, .invalid, [role="alert"]').all();
      if (validationMessages.length > 0) {
        console.log('⚠️  Found validation messages:');
        for (const msg of validationMessages) {
          const text = await msg.textContent();
          console.log(`   - ${text}`);
        }
      }

      // Take screenshot after filling title
      await page.screenshot({ path: '/tmp/create-poll-filled.png', fullPage: true });
      console.log('📸 Post-fill screenshot saved: /tmp/create-poll-filled.png');

      // Check submit button state again
      if (submitButtons.length > 0) {
        const firstSubmitButton = submitButtons[0];
        const isDisabledAfterFill = await firstSubmitButton.isDisabled();
        console.log(`🔘 Submit button after filling: ${isDisabledAfterFill ? 'DISABLED' : 'ENABLED'}`);

        // Try to click submit button
        console.log('🖱️  Attempting to click submit button...');
        try {
          await firstSubmitButton.click();
          console.log('✅ Submit button clicked successfully');
          
          // Wait a bit to see what happens
          await page.waitForTimeout(2000);
          
          // Check for any new messages or changes
          const newValidationMessages = await page.locator('.error, .invalid, [role="alert"]').all();
          if (newValidationMessages.length > 0) {
            console.log('🚨 Validation messages after submit:');
            for (const msg of newValidationMessages) {
              const text = await msg.textContent();
              console.log(`   - ${text}`);
            }
          }

          // Check if we're still on the same page or navigated
          const currentUrl = page.url();
          console.log(`📍 Current URL after submit: ${currentUrl}`);

          // Take screenshot after submit attempt
          await page.screenshot({ path: '/tmp/create-poll-after-submit.png', fullPage: true });
          console.log('📸 Post-submit screenshot saved: /tmp/create-poll-after-submit.png');

        } catch (error) {
          console.log(`❌ Failed to click submit button: ${error.message}`);
        }
      } else {
        console.log('⚠️  No submit buttons found - looking for other clickable elements...');
        const allButtons = await page.locator('button').all();
        for (let i = 0; i < allButtons.length; i++) {
          const buttonText = await allButtons[i].textContent();
          const isDisabled = await allButtons[i].isDisabled();
          console.log(`   Button ${i + 1}: "${buttonText}" - ${isDisabled ? 'DISABLED' : 'ENABLED'}`);
        }
      }

    } else {
      console.log('❌ Title input not found or not visible');
    }

    // Get the page's HTML content for analysis
    const content = await page.content();
    
    // Look for form-related elements in the HTML
    console.log('\n🔍 Analyzing page structure...');
    
    const hasForm = content.includes('<form');
    const hasRequiredFields = content.includes('required');
    const hasValidation = content.includes('validation') || content.includes('error');
    
    console.log(`📋 Has form element: ${hasForm ? '✅' : '❌'}`);
    console.log(`⚡ Has required fields: ${hasRequiredFields ? '✅' : '❌'}`);
    console.log(`🔍 Has validation logic: ${hasValidation ? '✅' : '❌'}`);

    // Extract any React component state information from the page
    const reactState = await page.evaluate(() => {
      // Try to find React component state
      const reactElements = document.querySelectorAll('[data-react*=""], [data-reactroot]');
      return {
        reactElementsFound: reactElements.length,
        hasReactRoot: !!document.querySelector('[data-reactroot]'),
        formElements: document.querySelectorAll('form').length,
        inputElements: document.querySelectorAll('input').length,
        buttonElements: document.querySelectorAll('button').length
      };
    });

    console.log('\n⚛️  React Analysis:');
    console.log(`   React elements: ${reactState.reactElementsFound}`);
    console.log(`   Has React root: ${reactState.hasReactRoot}`);
    console.log(`   Form elements: ${reactState.formElements}`);
    console.log(`   Input elements: ${reactState.inputElements}`);
    console.log(`   Button elements: ${reactState.buttonElements}`);

    // Summary
    console.log('\n📊 SUMMARY:');
    console.log(`   Console errors: ${consoleMessages.filter(m => m.type === 'error').length}`);
    console.log(`   Network errors: ${networkErrors.length}`);
    console.log(`   JavaScript errors: ${jsErrors.length}`);
    
    if (consoleMessages.filter(m => m.type === 'error').length > 0) {
      console.log('\n🚨 Console Errors Details:');
      consoleMessages.filter(m => m.type === 'error').forEach((msg, i) => {
        console.log(`   ${i + 1}. ${msg.text}`);
      });
    }

    return {
      success: jsErrors.length === 0 && networkErrors.length === 0,
      errors: [...jsErrors, ...networkErrors],
      consoleErrors: consoleMessages.filter(m => m.type === 'error')
    };

  } catch (error) {
    console.log(`💥 Test Failed: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  } finally {
    await browser.close();
  }
}

// Run the debug
debugCreatePoll().catch(console.error);