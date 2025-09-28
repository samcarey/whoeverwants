const { chromium } = require('playwright');

async function testScrollFixDirectly() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 } // Desktop viewport
  });

  const page = await context.newPage();

  console.log('=== SCROLL FIX VERIFICATION ===\n');

  try {
    await page.goto('http://localhost:3000/create-poll/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(3000);

    // Get detailed CSS information about all relevant elements
    const scrollInfo = await page.evaluate(() => {
      const body = document.body;
      const scrollContainer = document.querySelector('.safari-scroll-container');

      return {
        // Body styles
        body: {
          overflow: window.getComputedStyle(body).overflow,
          overflowY: window.getComputedStyle(body).overflowY,
          height: window.getComputedStyle(body).height,
        },

        // Scroll container styles
        scrollContainer: scrollContainer ? {
          overflow: window.getComputedStyle(scrollContainer).overflow,
          overflowY: window.getComputedStyle(scrollContainer).overflowY,
          className: scrollContainer.className,
          clientHeight: scrollContainer.clientHeight,
          scrollHeight: scrollContainer.scrollHeight,
        } : null,

        // Document information
        document: {
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
          canScrollDoc: document.documentElement.scrollHeight > window.innerHeight,
        },

        // Check if we're on desktop
        isDesktop: window.innerWidth >= 1024,

        // Check what CSS support queries match
        supports: {
          webkitTouchCallout: CSS.supports('-webkit-touch-callout', 'none'),
          hoverHover: CSS.supports('(hover: hover)'),
          combinedIOS: CSS.supports('(-webkit-touch-callout: none) and (not (hover: hover))'),
        }
      };
    });

    console.log('📊 CSS Analysis:');
    console.log('  Is Desktop (width >= 1024):', scrollInfo.isDesktop);
    console.log('  CSS.supports(-webkit-touch-callout: none):', scrollInfo.supports.webkitTouchCallout);
    console.log('  CSS.supports(hover: hover):', scrollInfo.supports.hoverHover);
    console.log('  CSS.supports(iOS combo):', scrollInfo.supports.combinedIOS);
    console.log('');

    console.log('🎨 Body styles:');
    console.log('  overflow:', scrollInfo.body.overflow);
    console.log('  overflow-y:', scrollInfo.body.overflowY);
    console.log('  height:', scrollInfo.body.height);
    console.log('');

    if (scrollInfo.scrollContainer) {
      console.log('📦 Scroll container (.safari-scroll-container):');
      console.log('  overflow:', scrollInfo.scrollContainer.overflow);
      console.log('  overflow-y:', scrollInfo.scrollContainer.overflowY);
      console.log('  className:', scrollInfo.scrollContainer.className);
      console.log('  clientHeight:', scrollInfo.scrollContainer.clientHeight + 'px');
      console.log('  scrollHeight:', scrollInfo.scrollContainer.scrollHeight + 'px');
      console.log('  canScroll:', scrollInfo.scrollContainer.scrollHeight > scrollInfo.scrollContainer.clientHeight);
    } else {
      console.log('❌ No scroll container found');
    }
    console.log('');

    console.log('📋 Document:');
    console.log('  scrollHeight:', scrollInfo.document.scrollHeight + 'px');
    console.log('  viewportHeight:', scrollInfo.document.viewportHeight + 'px');
    console.log('  canScrollDocument:', scrollInfo.document.canScrollDoc);
    console.log('');

    console.log('✅ Analysis:');

    // Expected behavior on desktop
    if (scrollInfo.isDesktop) {
      if (scrollInfo.body.overflow === 'hidden') {
        console.log('  ✅ Body overflow correctly set to hidden on desktop');
      } else {
        console.log('  ❌ Body overflow should be hidden on desktop, got:', scrollInfo.body.overflow);
      }

      if (scrollInfo.scrollContainer && scrollInfo.scrollContainer.overflow === 'hidden') {
        console.log('  ✅ Scroll container overflow correctly set to hidden on desktop');
      } else if (scrollInfo.scrollContainer) {
        console.log('  ❌ Scroll container overflow should be hidden on desktop, got:', scrollInfo.scrollContainer.overflow);
      }

      const shouldPreventDocumentScroll = scrollInfo.body.overflow === 'hidden' &&
                                         scrollInfo.scrollContainer &&
                                         scrollInfo.scrollContainer.overflow === 'hidden';

      if (shouldPreventDocumentScroll && !scrollInfo.document.canScrollDoc) {
        console.log('  ✅ Document scrolling properly prevented');
      } else if (shouldPreventDocumentScroll) {
        console.log('  ⚠️ CSS looks correct but document can still scroll - may need viewport height fix');
      } else {
        console.log('  ❌ Document scrolling not properly prevented');
      }
    }

    // Take screenshot for visual confirmation
    await page.screenshot({
      path: '/home/sccarey/whoeverwants/test-results/scroll-fix-verification.png',
      fullPage: false
    });
    console.log('  📸 Screenshot saved for visual verification');

  } catch (error) {
    console.log('❌ Error:', error.message);
  }

  await browser.close();
}

testScrollFixDirectly().catch(console.error);