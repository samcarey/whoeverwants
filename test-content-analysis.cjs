const { chromium } = require('playwright');

async function analyzeContentHeight() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  console.log('=== CONTENT HEIGHT ANALYSIS ===\n');

  try {
    await page.goto('http://localhost:3000/create-poll/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const contentInfo = await page.evaluate(() => {
      const scalingContainer = document.querySelector('.responsive-scaling-container');
      const body = document.body;
      const html = document.documentElement;

      return {
        // Viewport info
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,

        // Document dimensions
        documentWidth: html.scrollWidth,
        documentHeight: html.scrollHeight,
        documentClientHeight: html.clientHeight,

        // Body dimensions
        bodyScrollHeight: body.scrollHeight,
        bodyClientHeight: body.clientHeight,
        bodyOffsetHeight: body.offsetHeight,

        // Scaling container info
        scalingContainer: scalingContainer ? {
          width: scalingContainer.scrollWidth,
          height: scalingContainer.scrollHeight,
          clientHeight: scalingContainer.clientHeight,
          offsetHeight: scalingContainer.offsetHeight,
          transform: window.getComputedStyle(scalingContainer).transform,
          transformOrigin: window.getComputedStyle(scalingContainer).transformOrigin,
          actualWidth: window.getComputedStyle(scalingContainer).width,
        } : null,

        // CSS properties
        htmlHeight: window.getComputedStyle(html).height,
        bodyHeight: window.getComputedStyle(body).height,

        // Check if scaling is applied
        isDesktop1024: window.innerWidth >= 1024 && window.innerWidth < 1280,
        isDesktop1280: window.innerWidth >= 1280,
      };
    });

    console.log('📐 Viewport & Document:');
    console.log(`  Viewport: ${contentInfo.viewportWidth} x ${contentInfo.viewportHeight}`);
    console.log(`  Document: ${contentInfo.documentWidth} x ${contentInfo.documentHeight}`);
    console.log(`  Document client height: ${contentInfo.documentClientHeight}`);
    console.log('');

    console.log('🎨 CSS Heights:');
    console.log(`  html height CSS: ${contentInfo.htmlHeight}`);
    console.log(`  body height CSS: ${contentInfo.bodyHeight}`);
    console.log('');

    console.log('📦 Body Measurements:');
    console.log(`  body scrollHeight: ${contentInfo.bodyScrollHeight}`);
    console.log(`  body clientHeight: ${contentInfo.bodyClientHeight}`);
    console.log(`  body offsetHeight: ${contentInfo.bodyOffsetHeight}`);
    console.log('');

    if (contentInfo.scalingContainer) {
      console.log('🔍 Scaling Container:');
      console.log(`  Dimensions: ${contentInfo.scalingContainer.width} x ${contentInfo.scalingContainer.height}`);
      console.log(`  clientHeight: ${contentInfo.scalingContainer.clientHeight}`);
      console.log(`  offsetHeight: ${contentInfo.scalingContainer.offsetHeight}`);
      console.log(`  transform: ${contentInfo.scalingContainer.transform}`);
      console.log(`  transformOrigin: ${contentInfo.scalingContainer.transformOrigin}`);
      console.log(`  CSS width: ${contentInfo.scalingContainer.actualWidth}`);
      console.log('');
    }

    console.log('💻 Responsive Scaling:');
    console.log(`  Desktop 1024-1279px (1.5x scale): ${contentInfo.isDesktop1024}`);
    console.log(`  Desktop 1280px+ (2x scale): ${contentInfo.isDesktop1280}`);
    console.log('');

    console.log('📊 Analysis:');

    const excessHeight = contentInfo.documentHeight - contentInfo.viewportHeight;
    console.log(`  Excess document height: ${excessHeight}px`);

    if (excessHeight > 0) {
      console.log(`  ⚠️ Document is ${excessHeight}px taller than viewport`);

      if (contentInfo.scalingContainer && contentInfo.isDesktop1280) {
        const scaledHeight = contentInfo.scalingContainer.clientHeight * 2; // 2x scale
        console.log(`  Scaled content height (2x): ${scaledHeight}px`);

        if (scaledHeight > contentInfo.viewportHeight) {
          console.log(`  ❌ Scaled content (${scaledHeight}px) exceeds viewport (${contentInfo.viewportHeight}px)`);
          console.log(`  💡 This might be causing the excess scroll space`);
        }
      } else if (contentInfo.scalingContainer && contentInfo.isDesktop1024) {
        const scaledHeight = contentInfo.scalingContainer.clientHeight * 1.5; // 1.5x scale
        console.log(`  Scaled content height (1.5x): ${scaledHeight}px`);

        if (scaledHeight > contentInfo.viewportHeight) {
          console.log(`  ❌ Scaled content (${scaledHeight}px) exceeds viewport (${contentInfo.viewportHeight}px)`);
        }
      }
    }

    if (contentInfo.htmlHeight === '100%' && contentInfo.bodyHeight === '100%') {
      console.log(`  ✅ HTML and body properly set to 100%`);
    } else {
      console.log(`  ⚠️ HTML/body height may not be properly constrained`);
    }

  } catch (error) {
    console.log('❌ Error:', error.message);
  }

  await browser.close();
}

analyzeContentHeight().catch(console.error);