const puppeteer = require('puppeteer');

async function testPullToRefresh() {
  const browser = await puppeteer.launch({
    headless: false,
    devtools: true,
    defaultViewport: { width: 375, height: 812 } // iPhone dimensions
  });

  try {
    const page = await browser.newPage();

    // Emulate mobile device
    await page.emulate({
      name: 'iPhone 12',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 375, height: 812, isMobile: true, hasTouch: true }
    });

    console.log('Testing pull-to-refresh on different pages...\n');

    // Test pages
    const testPages = [
      { url: 'http://localhost:3000', name: 'Homepage' },
      { url: 'http://localhost:3000/create-poll/', name: 'Create Poll' },
      { url: 'http://localhost:3000/profile/', name: 'Profile' }
    ];

    for (const testPage of testPages) {
      console.log(`🔍 Testing ${testPage.name} (${testPage.url})`);

      await page.goto(testPage.url, { waitUntil: 'networkidle0' });
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check if pull-to-refresh indicator exists in template
      const pullIndicatorExists = await page.evaluate(() => {
        // Look for the pull-to-refresh indicator structure
        const indicators = document.querySelectorAll('div[class*="fixed"][class*="top-0"]');
        for (const indicator of indicators) {
          const svg = indicator.querySelector('svg[viewBox="0 0 24 24"]');
          if (svg && svg.querySelector('path[d*="M4 4v5h.582m15.356 2A8.001"]')) {
            return true;
          }
        }
        return false;
      });

      // Simulate pull-to-refresh gesture
      console.log(`  📱 Simulating pull gesture...`);

      // Get the scroll container
      const scrollContainer = await page.$('.safari-scroll-container');
      if (scrollContainer) {
        // Scroll to top first
        await page.evaluate((container) => {
          container.scrollTop = 0;
        }, scrollContainer);

        // Simulate touch events for pull-to-refresh
        const box = await scrollContainer.boundingBox();
        const startX = box.x + box.width / 2;
        const startY = box.y + 50;

        // Touch start
        await page.touchscreen.touchStart(startX, startY);

        // Touch move down (simulate pull)
        for (let i = 0; i < 5; i++) {
          await page.touchscreen.touchMove(startX, startY + (i * 20));
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Check if pull indicator appears during pull
        const indicatorDuringPull = await page.evaluate(() => {
          const indicators = document.querySelectorAll('div[class*="fixed"][class*="top-0"]');
          for (const indicator of indicators) {
            if (getComputedStyle(indicator).opacity !== '0') {
              return true;
            }
          }
          return false;
        });

        console.log(`  📊 Pull indicator appears: ${indicatorDuringPull ? '✅' : '❌'}`);

        // Touch end (trigger refresh)
        await page.touchscreen.touchEnd();

        console.log(`  🔄 Pull-to-refresh gesture completed`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        console.log(`  ❌ Could not find scroll container`);
      }

      console.log(`  ✅ ${testPage.name} test completed\n`);
    }

    console.log('🎉 Pull-to-refresh testing completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

testPullToRefresh().catch(console.error);