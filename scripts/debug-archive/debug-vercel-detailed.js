import { chromium } from 'playwright';

async function debugVercelIssues() {
  console.log('🔍 Detailed Vercel Debugging');
  console.log('=' .repeat(40));
  
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Capture all console messages
    const consoleMessages = [];
    page.on('console', msg => {
      consoleMessages.push(`${msg.type()}: ${msg.text()}`);
    });
    
    // Capture all JavaScript errors
    const jsErrors = [];
    page.on('pageerror', error => {
      jsErrors.push(error.message);
    });
    
    console.log('🌐 Loading Vercel homepage with detailed logging...');
    await page.goto('https://whoeverwants.com', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(5000); // Extended wait for React to fully load
    
    // Check what's actually in the page content
    const pageContent = await page.content();
    console.log('\n📄 Page content analysis:');
    console.log(`   Page title: "${await page.title()}"`);
    console.log(`   Content includes "Open Polls": ${pageContent.includes('Open Polls')}`);
    console.log(`   Content includes "Closed Polls": ${pageContent.includes('Closed Polls')}`);
    console.log(`   Content includes "Create Poll": ${pageContent.includes('Create Poll')}`);
    console.log(`   Content includes "No polls created": ${pageContent.includes('No polls created')}`);
    console.log(`   Content includes "Loading": ${pageContent.includes('Loading')}`);
    console.log(`   Content includes error text: ${pageContent.includes('error') || pageContent.includes('Error')}`);
    
    // Check if main div is present
    const mainContent = await page.locator('div.max-w-4xl').textContent();
    console.log(`\n📦 Main content div text: "${mainContent?.substring(0, 200)}..."`);
    
    // Check for loading states
    const hasLoadingSpinner = await page.locator('svg.animate-spin').isVisible();
    console.log(`   Loading spinner visible: ${hasLoadingSpinner}`);
    
    // Check for specific error messages
    const errorDivs = await page.locator('div.bg-red-100, div.bg-red-900').count();
    console.log(`   Error message divs: ${errorDivs}`);
    
    if (errorDivs > 0) {
      const errorText = await page.locator('div.bg-red-100, div.bg-red-900').textContent();
      console.log(`   Error message: "${errorText}"`);
    }
    
    // Check network requests
    console.log('\n🌐 Network activity:');
    const responses = [];
    page.on('response', response => {
      if (response.url().includes('supabase') || response.url().includes('api')) {
        responses.push(`${response.status()} - ${response.url()}`);
      }
    });
    
    // Reload to capture network
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    console.log('   Supabase/API requests:');
    responses.forEach(resp => console.log(`     ${resp}`));
    
    // Console messages
    console.log('\n💬 Console messages:');
    consoleMessages.forEach(msg => console.log(`   ${msg}`));
    
    // JavaScript errors
    console.log('\n🐛 JavaScript errors:');
    jsErrors.forEach(error => console.log(`   ${error}`));
    
    // Check if polls data is actually loading
    const pollLinks = await page.locator('a[href*="/p/"]').count();
    console.log(`\n📊 Poll data:`);
    console.log(`   Poll links found: ${pollLinks}`);
    
    // Try to trigger any loading states
    console.log('\n🔄 Triggering reload to see load behavior...');
    await page.reload();
    await page.waitForTimeout(1000);
    
    const hasSpinnerAfterReload = await page.locator('svg.animate-spin').isVisible();
    console.log(`   Loading spinner after reload: ${hasSpinnerAfterReload}`);
    
    await page.waitForTimeout(4000);
    
    const finalPollsVisible = await page.locator('text=Open Polls').isVisible();
    const finalClosedVisible = await page.locator('text=Closed Polls').isVisible();
    console.log(`   Final "Open Polls" visible: ${finalPollsVisible}`);
    console.log(`   Final "Closed Polls" visible: ${finalClosedVisible}`);
    
    return { jsErrors, consoleMessages, responses };
    
  } catch (error) {
    console.log(`❌ Debug failed: ${error.message}`);
    return null;
  } finally {
    await browser.close();
  }
}

debugVercelIssues().then(result => {
  console.log('\n🏁 Debug Complete');
  if (result && result.jsErrors.length === 0) {
    console.log('✅ No JavaScript errors detected');
  } else if (result) {
    console.log(`❌ Found ${result.jsErrors.length} JavaScript errors`);
  }
});