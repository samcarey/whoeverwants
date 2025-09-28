const { chromium } = require('playwright');

async function testScrollBehavior() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 } // Desktop viewport
  });

  const page = await context.newPage();

  // Enable console logging
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  const testPages = [
    { name: 'Homepage', url: 'http://localhost:3000/' },
    { name: 'Create Poll', url: 'http://localhost:3000/create-poll/' },
    { name: 'Poll Page', url: 'http://localhost:3000/p/451f91ee-271b-4746-9182-b16dfaf6b8ab/' }
  ];

  console.log('=== DESKTOP SCROLL BEHAVIOR TEST ===\n');

  for (const testPage of testPages) {
    console.log(`\n📄 Testing: ${testPage.name}`);
    console.log(`URL: ${testPage.url}`);

    try {
      // Navigate to page
      await page.goto(testPage.url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      // Wait for React hydration and content loading
      await page.waitForTimeout(3000);

      // Wait for loading spinners to disappear (React hydration)
      try {
        await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 10000 });
        console.log('  ✅ React hydration completed (loading spinner gone)');
      } catch (e) {
        console.log('  ⚠️ Loading spinner still present or not found');
      }

      // Additional wait for content to stabilize
      await page.waitForTimeout(1000);

      // Get page dimensions and scroll info
      const scrollInfo = await page.evaluate(() => {
        return {
          // Document dimensions
          documentHeight: document.documentElement.scrollHeight,
          documentWidth: document.documentElement.scrollWidth,

          // Viewport dimensions
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,

          // Current scroll position
          scrollTop: window.scrollY || document.documentElement.scrollTop,
          scrollLeft: window.scrollX || document.documentElement.scrollLeft,

          // Body and HTML styles
          bodyOverflow: window.getComputedStyle(document.body).overflow,
          bodyOverflowY: window.getComputedStyle(document.body).overflowY,
          bodyHeight: window.getComputedStyle(document.body).height,
          htmlHeight: window.getComputedStyle(document.documentElement).height,

          // Check if page is scrollable
          canScrollVertically: document.documentElement.scrollHeight > window.innerHeight,
          canScrollHorizontally: document.documentElement.scrollWidth > window.innerWidth,

          // Get actual content height (visible elements)
          contentHeight: Math.max(
            document.body.scrollHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight,
            document.documentElement.scrollHeight,
            document.documentElement.offsetHeight
          )
        };
      });

      // Test scrolling behavior
      console.log('📐 Dimensions:');
      console.log(`  Document: ${scrollInfo.documentWidth} x ${scrollInfo.documentHeight}`);
      console.log(`  Viewport: ${scrollInfo.viewportWidth} x ${scrollInfo.viewportHeight}`);
      console.log(`  Content Height: ${scrollInfo.contentHeight}`);

      console.log('\n🎨 CSS Properties:');
      console.log(`  Body overflow: ${scrollInfo.bodyOverflow}`);
      console.log(`  Body overflow-y: ${scrollInfo.bodyOverflowY}`);
      console.log(`  Body height: ${scrollInfo.bodyHeight}`);
      console.log(`  HTML height: ${scrollInfo.htmlHeight}`);

      console.log('\n📊 Scroll Analysis:');
      console.log(`  Can scroll vertically: ${scrollInfo.canScrollVertically}`);
      console.log(`  Can scroll horizontally: ${scrollInfo.canScrollHorizontally}`);
      console.log(`  Current scroll position: ${scrollInfo.scrollTop}, ${scrollInfo.scrollLeft}`);

      // Calculate excess scroll space
      const excessVerticalSpace = scrollInfo.documentHeight - scrollInfo.viewportHeight;
      const excessHorizontalSpace = scrollInfo.documentWidth - scrollInfo.viewportWidth;

      console.log(`  Excess vertical space: ${excessVerticalSpace}px`);
      console.log(`  Excess horizontal space: ${excessHorizontalSpace}px`);

      // Test actual scrolling
      console.log('\n🔄 Testing scroll behavior:');

      // Try to scroll to bottom
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(500);

      const scrollAfterBottom = await page.evaluate(() => ({
        scrollTop: window.scrollY || document.documentElement.scrollTop,
        maxScrollTop: document.documentElement.scrollHeight - window.innerHeight
      }));

      console.log(`  After scroll to bottom: ${scrollAfterBottom.scrollTop}px`);
      console.log(`  Max possible scroll: ${scrollAfterBottom.maxScrollTop}px`);

      // Try to scroll past bottom (should not work if fixed)
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight + 1000));
      await page.waitForTimeout(500);

      const scrollAfterExcess = await page.evaluate(() => window.scrollY || document.documentElement.scrollTop);
      console.log(`  After trying to scroll past bottom: ${scrollAfterExcess}px`);

      // Reset scroll
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);

      // Analyze results
      console.log('\n✅ Analysis:');

      if (scrollInfo.bodyOverflowY === 'hidden' || scrollInfo.bodyOverflow === 'hidden') {
        console.log('  ✅ Body overflow is properly set to hidden');
      } else {
        console.log('  ⚠️ Body overflow is not hidden');
      }

      if (excessVerticalSpace <= 0) {
        console.log('  ✅ No excess vertical scroll space');
      } else if (excessVerticalSpace <= 50) {
        console.log('  ⚠️ Minor excess vertical scroll space (acceptable)');
      } else {
        console.log('  ❌ Significant excess vertical scroll space detected');
      }

      if (scrollAfterExcess <= scrollAfterBottom.maxScrollTop + 10) {
        console.log('  ✅ Cannot scroll beyond content bounds');
      } else {
        console.log('  ❌ Can still scroll beyond content bounds');
      }

      // Check for loading spinners or incomplete content
      const hasLoadingSpinner = await page.$('.loading, [data-loading="true"], .spinner');
      if (hasLoadingSpinner) {
        console.log('  ⚠️ Page may still be loading (spinner detected)');
      } else {
        console.log('  ✅ No loading indicators detected');
      }

      // Take a screenshot for visual verification
      await page.screenshot({
        path: `/home/sccarey/whoeverwants/test-results/scroll-test-${testPage.name.toLowerCase().replace(/\s+/g, '-')}.png`,
        fullPage: false // Only capture viewport, not full scrollable area
      });

      console.log(`  📸 Screenshot saved for ${testPage.name}`);

    } catch (error) {
      console.log(`  ❌ Error testing ${testPage.name}: ${error.message}`);
    }

    console.log('\n' + '='.repeat(80));
  }

  await browser.close();
  console.log('\n🎉 Testing complete! Check screenshots in test-results/ folder.');
}

// Run the test
testScrollBehavior().catch(console.error);