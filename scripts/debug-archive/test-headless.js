import puppeteer from 'puppeteer';

async function testPage(url, description) {
  console.log(`\n🧪 Testing: ${description}`);
  console.log(`📍 URL: ${url}`);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ]
  });

  try {
    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Track network requests
    let requests = 0;
    let responses = 0;
    let errors = [];
    
    page.on('request', (req) => {
      requests++;
      console.log(`📤 ${req.method()} ${req.url()}`);
    });
    
    page.on('response', (res) => {
      responses++;
      const status = res.status();
      const url = res.url();
      if (status >= 400) {
        errors.push(`❌ ${status} ${url}`);
      } else {
        console.log(`📥 ${status} ${url}`);
      }
    });
    
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error') {
        errors.push(`🚨 Console Error: ${text}`);
      } else if (type === 'warn') {
        console.log(`⚠️  Console Warning: ${text}`);
      } else {
        console.log(`💬 Console ${type}: ${text}`);
      }
    });
    
    page.on('pageerror', (err) => {
      errors.push(`💥 Page Error: ${err.message}`);
    });
    
    // Navigate to page
    console.log('🌐 Navigating...');
    await page.goto(url, { 
      waitUntil: ['networkidle0', 'domcontentloaded'],
      timeout: 30000 
    });
    
    // Wait for React hydration
    console.log('⏳ Waiting for hydration...');
    await page.waitForTimeout(3000);
    
    // Check page title
    const title = await page.title();
    console.log(`📄 Title: ${title}`);
    
    // Check if main elements are present
    const createPollButton = await page.$('a[href="/create-poll"]');
    console.log(`🔘 Create Poll Button: ${createPollButton ? '✅ Found' : '❌ Missing'}`);
    
    // Check for loading spinner
    const spinner = await page.$('svg.animate-spin');
    console.log(`⏳ Loading Spinner: ${spinner ? '✅ Found' : '❌ Missing'}`);
    
    // Wait a bit more and check for content
    await page.waitForTimeout(2000);
    
    // Check for polls content
    const pollsText = await page.evaluate(() => {
      const text = document.body.innerText;
      if (text.includes('No polls created yet')) return 'Empty State';
      if (text.includes('Polls')) return 'Polls Found';
      if (text.includes('Failed to load')) return 'Error State';
      if (text.includes('Loading')) return 'Still Loading';
      return 'Unknown State';
    });
    console.log(`📊 Content State: ${pollsText}`);
    
    // Check for hydration errors
    const hydrationErrors = await page.evaluate(() => {
      // Check for React hydration error indicators
      const errorElements = document.querySelectorAll('[data-reactroot], [data-reacterror]');
      return errorElements.length;
    });
    console.log(`🔄 Hydration Issues: ${hydrationErrors > 0 ? `❌ ${hydrationErrors} found` : '✅ None detected'}`);
    
    // Take screenshot
    const screenshotPath = `/tmp/test-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot saved: ${screenshotPath}`);
    
    // Get final page content length
    const content = await page.content();
    console.log(`📏 Page Content Length: ${content.length} chars`);
    
    // Summary
    console.log('\n📊 SUMMARY:');
    console.log(`   Requests: ${requests}`);
    console.log(`   Responses: ${responses}`);
    console.log(`   Errors: ${errors.length}`);
    if (errors.length > 0) {
      console.log('   Error Details:');
      errors.forEach(err => console.log(`     ${err}`));
    }
    
    return {
      success: errors.length === 0,
      title,
      hasCreateButton: !!createPollButton,
      contentState: pollsText,
      requests,
      responses,
      errors,
      screenshotPath
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

async function runTests() {
  console.log('🚀 Starting Headless Browser Tests');
  console.log('=' .repeat(50));
  
  const tests = [
    {
      url: 'http://localhost:3000',
      description: 'Local Development Server'
    },
    {
      url: 'https://decisionbot.a.pinggy.link',
      description: 'External Dev Tunnel'
    }
  ];
  
  const results = [];
  
  for (const test of tests) {
    try {
      const result = await testPage(test.url, test.description);
      results.push({ ...test, ...result });
    } catch (error) {
      console.log(`❌ Failed to test ${test.url}: ${error.message}`);
      results.push({ ...test, success: false, error: error.message });
    }
  }
  
  console.log('\n' + '=' .repeat(50));
  console.log('🏁 FINAL RESULTS');
  console.log('=' .repeat(50));
  
  results.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.description}`);
    console.log(`   URL: ${result.url}`);
    console.log(`   Status: ${result.success ? '✅ PASS' : '❌ FAIL'}`);
    if (result.title) console.log(`   Title: ${result.title}`);
    if (result.contentState) console.log(`   Content: ${result.contentState}`);
    if (result.error) console.log(`   Error: ${result.error}`);
  });
  
  const passCount = results.filter(r => r.success).length;
  console.log(`\n🎯 Overall: ${passCount}/${results.length} tests passed`);
}

runTests().catch(console.error);