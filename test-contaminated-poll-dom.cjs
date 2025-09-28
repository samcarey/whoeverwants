#!/usr/bin/env node

/**
 * Test that inspects the DOM of the poll that shows contamination
 */

const { chromium } = require('playwright');

async function inspectContaminatedPollDOM() {
  console.log('🔍 Inspecting Contaminated Poll DOM');
  console.log('===================================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Go directly to the contaminated poll from the simple test
    const contaminatedPollId = '72fab48b-876c-4323-a816-b16123c4043d';
    const pollUrl = `http://localhost:3000/p/${contaminatedPollId}/`;

    console.log(`✅ Visiting contaminated poll: ${pollUrl}`);

    await page.goto(pollUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for page to load
    await page.waitForTimeout(5000);
    await page.waitForFunction(() => document.querySelectorAll('input').length > 0, { timeout: 10000 });

    // Check what's visible using the same method as the simple test
    const hasA = await page.isVisible('text=A');
    const hasB = await page.isVisible('text=B');

    console.log(`\n🔍 Playwright visibility check:`);
    console.log(`   Shows A: ${hasA}`);
    console.log(`   Shows B: ${hasB}`);

    if (hasA || hasB) {
      console.log('\n🎯 CONTAMINATION CONFIRMED! Now inspecting where A and B appear...');

      // Find all elements containing "A" or "B"
      const allElementsWithAOrB = await page.evaluate(() => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );

        const results = [];
        let node;
        while (node = walker.nextNode()) {
          const text = node.textContent ? node.textContent.trim() : '';
          if (text.includes('A') || text.includes('B')) {
            const element = node.parentElement;
            results.push({
              text: text,
              fullText: element?.textContent?.slice(0, 200),
              tagName: element?.tagName,
              className: element?.className,
              id: element?.id,
              xpath: getXPath(element)
            });
          }
        }

        function getXPath(element) {
          if (!element) return '';
          if (element.id) return `//*[@id="${element.id}"]`;

          let path = '';
          while (element && element.nodeType === Node.ELEMENT_NODE) {
            let selector = element.nodeName.toLowerCase();
            if (element.className) {
              selector += `[@class="${element.className}"]`;
            }
            path = '/' + selector + path;
            element = element.parentNode;
          }
          return path;
        }

        return results;
      });

      console.log(`\n📋 Found ${allElementsWithAOrB.length} elements containing A or B:`);
      allElementsWithAOrB.forEach((el, i) => {
        console.log(`\n   ${i + 1}. Text: "${el.text}"`);
        console.log(`      Full text: "${el.fullText}"`);
        console.log(`      Tag: ${el.tagName}, Class: "${el.className}"`);
        console.log(`      XPath: ${el.xpath}`);
      });

      // Also check if there are any results components showing
      const hasResultsSection = await page.isVisible('[class*="result"], [class*="nomination"], [class*="vote"]');
      console.log(`\n🔍 Results section visible: ${hasResultsSection}`);

      // Check for specific nomination display components
      const nominationElements = await page.locator('div, span, p').all();
      let nominationDisplays = [];

      for (let el of nominationElements.slice(0, 50)) { // Check first 50 elements
        try {
          const text = await el.textContent();
          if (text && (text.trim() === 'A' || text.trim() === 'B')) {
            const classes = await el.getAttribute('class');
            nominationDisplays.push({
              text: text.trim(),
              classes: classes || 'no-class',
              tagName: await el.evaluate(node => node.tagName)
            });
          }
        } catch (e) {
          // Skip elements that can't be accessed
        }
      }

      if (nominationDisplays.length > 0) {
        console.log(`\n🎯 EXACT A/B ELEMENTS FOUND:`);
        nominationDisplays.forEach((item, i) => {
          console.log(`   ${i + 1}. "${item.text}" in ${item.tagName} with classes: "${item.classes}"`);
        });
      }

    } else {
      console.log('\n❓ NO CONTAMINATION: Poll shows clean (no A or B)');
      console.log('   This suggests the contamination was resolved or is intermittent');
    }

    // Save screenshot and HTML for comparison
    await page.screenshot({ path: 'contaminated-poll-screenshot.png' });
    const html = await page.content();
    require('fs').writeFileSync('contaminated-poll-page.html', html);

    console.log('\n📄 Files saved:');
    console.log('   - contaminated-poll-screenshot.png');
    console.log('   - contaminated-poll-page.html');

    return hasA || hasB;

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'contaminated-poll-error.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
inspectContaminatedPollDOM()
  .then(foundContamination => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 Contamination Found:', foundContamination ? '✅ YES' : '❌ NO');
    console.log('='.repeat(50));
    process.exit(foundContamination ? 1 : 0); // Exit 1 if contamination found
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });