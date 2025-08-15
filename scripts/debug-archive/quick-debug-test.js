import { chromium } from 'playwright';

async function quickDebugTest() {
  console.log('🔍 Quick Debug Test - Check for ANY debug traces');
  
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Capture ALL console messages
    const allConsoleMessages = [];
    page.on('console', msg => {
      allConsoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });
    
    // Capture ALL errors
    const allErrors = [];
    page.on('pageerror', error => {
      allErrors.push(error.message);
    });
    
    console.log('Loading homepage...');
    await page.goto('https://whoeverwants.com', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000);
    
    // Check page title to confirm we're on the right page
    const title = await page.title();
    console.log(`Page title: "${title}"`);
    
    // Look for ANY mention of debug in the page content
    const pageContent = await page.content();
    const hasDebugInContent = pageContent.includes('🐛 DEBUG') || pageContent.includes('DEBUG INFO');
    console.log(`Has debug content: ${hasDebugInContent}`);
    
    // Check component name in page source
    const hasHomeDebugComponent = pageContent.includes('HomeDebug');
    console.log(`Has HomeDebug component: ${hasHomeDebugComponent}`);
    
    // Check for any error messages on page
    const errorElements = await page.locator('div.bg-red-100, div.bg-red-900, .error, [class*="error"]').count();
    console.log(`Error elements found: ${errorElements}`);
    
    if (errorElements > 0) {
      const errorText = await page.locator('div.bg-red-100, div.bg-red-900, .error, [class*="error"]').first().textContent();
      console.log(`Error text: "${errorText}"`);
    }
    
    // Check what's actually displayed
    const mainContent = await page.locator('div.max-w-4xl, main, .container').first().textContent();
    console.log(`Main content preview: "${mainContent?.substring(0, 200)}..."`);
    
    console.log('\n📱 Console Messages:');
    allConsoleMessages.forEach(msg => console.log(`  ${msg}`));
    
    console.log('\n🐛 JavaScript Errors:');
    allErrors.forEach(error => console.log(`  ${error}`));
    
    return { hasDebugInContent, hasHomeDebugComponent, errorElements, allConsoleMessages, allErrors };
    
  } catch (error) {
    console.log(`Test failed: ${error.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

quickDebugTest();