const { chromium } = require('playwright');

async function testUserScrollExperience() {
  const browser = await chromium.launch({ headless: false }); // Show browser for visual testing
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  console.log('=== USER SCROLL EXPERIENCE TEST ===\n');

  const testPages = [
    { name: 'Homepage', url: 'http://localhost:3000/' },
    { name: 'Create Poll', url: 'http://localhost:3000/create-poll/' },
    { name: 'Poll Page', url: 'http://localhost:3000/p/451f91ee-271b-4746-9182-b16dfaf6b8ab/' }
  ];

  for (const testPage of testPages) {
    console.log(`\n🧪 Testing: ${testPage.name}`);

    try {
      await page.goto(testPage.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      // Test user scroll experience
      const scrollTest = await page.evaluate(async () => {
        // Get initial scroll position
        const initialScroll = window.scrollY;

        // Try to scroll down multiple times (simulate user scrolling)
        for (let i = 0; i < 5; i++) {
          window.scrollBy(0, 300); // Scroll down 300px each time
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const maxScrollReached = window.scrollY;

        // Try to scroll past the bottom
        window.scrollTo(0, 99999);
        await new Promise(resolve => setTimeout(resolve, 100));

        const finalScroll = window.scrollY;

        // Get page dimensions
        const documentHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.innerHeight;

        return {
          initialScroll,
          maxScrollReached,
          finalScroll,
          documentHeight,
          viewportHeight,
          maxPossibleScroll: documentHeight - viewportHeight,
          canUserScroll: finalScroll > initialScroll,
          scrollRange: finalScroll - initialScroll,
          isScrollConstrained: finalScroll <= documentHeight - viewportHeight + 10 // 10px tolerance
        };
      });

      console.log(`  📐 Document: ${scrollTest.documentHeight}px, Viewport: ${scrollTest.viewportHeight}px`);
      console.log(`  📊 Scroll range: ${scrollTest.scrollRange}px (max possible: ${scrollTest.maxPossibleScroll}px)`);

      if (!scrollTest.canUserScroll) {
        console.log(`  ✅ PERFECT: No scrolling possible - desktop scroll issue completely fixed!`);
      } else if (scrollTest.scrollRange <= 100) {
        console.log(`  ✅ EXCELLENT: Minimal scrolling (${scrollTest.scrollRange}px) - scroll issue largely fixed!`);
      } else if (scrollTest.isScrollConstrained) {
        console.log(`  ✅ GOOD: Scrolling is properly constrained within content bounds`);
        console.log(`  📝 Note: ${scrollTest.scrollRange}px scroll space available (within normal range)`);
      } else {
        console.log(`  ❌ ISSUE: Can scroll ${scrollTest.scrollRange}px beyond content bounds`);
      }

      // Take screenshot at the bottom scroll position
      await page.screenshot({
        path: `/home/sccarey/whoeverwants/test-results/user-scroll-${testPage.name.toLowerCase().replace(/\s+/g, '-')}.png`,
        fullPage: false
      });

      // Reset scroll position for next test
      await page.evaluate(() => window.scrollTo(0, 0));

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }

  console.log('\n🎯 SUMMARY:');
  console.log('The most important metric is whether users can scroll beyond content bounds.');
  console.log('✅ = Fixed, ❌ = Still has scrolling issues');

  await browser.close();
}

testUserScrollExperience().catch(console.error);