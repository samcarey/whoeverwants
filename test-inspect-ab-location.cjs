#!/usr/bin/env node

/**
 * Test to inspect exactly where A and B appear in the DOM
 */

const { chromium } = require('playwright');

async function inspectABLocation() {
  console.log('🔍 Inspecting A and B Location in DOM');
  console.log('=====================================');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Create poll
    console.log('\n✅ Creating nomination poll...');
    await page.goto('http://localhost:3000/create-poll', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(2000);
    await page.fill('input#title', 'DOM Inspection Test');
    await page.click('button:has-text("Suggestions")');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Submit")');

    await page.waitForSelector('text=Create Poll', { timeout: 5000 });
    await page.click('button:has-text("Create Poll")');

    await page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 10000 });
    const pollUrl = page.url();
    console.log(`   Poll created: ${pollUrl}`);

    // Wait for page to load
    await page.waitForTimeout(5000);
    await page.waitForFunction(() => document.querySelectorAll('input').length > 0, { timeout: 10000 });

    // Find all elements containing "A"
    console.log('\n🔍 Elements containing "A":');
    const elementsWithA = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      const results = [];
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.trim() === 'A') {
          const element = node.parentElement;
          results.push({
            text: node.textContent,
            tagName: element?.tagName,
            className: element?.className,
            id: element?.id,
            parentText: element?.textContent?.slice(0, 100),
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

    elementsWithA.forEach((el, i) => {
      console.log(`   ${i + 1}. Tag: ${el.tagName}, Class: "${el.className}"`);
      console.log(`      ID: "${el.id}"`);
      console.log(`      Parent text: "${el.parentText}"`);
      console.log(`      XPath: ${el.xpath}`);
      console.log('');
    });

    // Find all elements containing "B"
    console.log('\n🔍 Elements containing "B":');
    const elementsWithB = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      const results = [];
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent && node.textContent.trim() === 'B') {
          const element = node.parentElement;
          results.push({
            text: node.textContent,
            tagName: element?.tagName,
            className: element?.className,
            id: element?.id,
            parentText: element?.textContent?.slice(0, 100),
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

    elementsWithB.forEach((el, i) => {
      console.log(`   ${i + 1}. Tag: ${el.tagName}, Class: "${el.className}"`);
      console.log(`      ID: "${el.id}"`);
      console.log(`      Parent text: "${el.parentText}"`);
      console.log(`      XPath: ${el.xpath}`);
      console.log('');
    });

    // Get a screenshot to see the actual page
    await page.screenshot({ path: 'dom-inspection-ab.png' });
    console.log('\n📸 Screenshot saved: dom-inspection-ab.png');

    // Also get the full page HTML to examine
    const html = await page.content();
    require('fs').writeFileSync('dom-inspection-page.html', html);
    console.log('📄 Page HTML saved: dom-inspection-page.html');

    // Analysis
    const totalAElements = elementsWithA.length;
    const totalBElements = elementsWithB.length;

    console.log('\n📊 Analysis:');
    console.log(`   Found ${totalAElements} elements with text "A"`);
    console.log(`   Found ${totalBElements} elements with text "B"`);

    if (totalAElements > 0 || totalBElements > 0) {
      console.log('\n🎯 SOURCE IDENTIFIED:');
      console.log('   The "A" and "B" texts are appearing in the DOM');
      console.log('   Check the XPaths and parent text above to see their context');
      console.log('   This will help identify if they are nominations, UI elements, or something else');
    } else {
      console.log('\n❓ NO EXACT MATCHES:');
      console.log('   No elements with exact text "A" or "B" found');
      console.log('   The test might be detecting partial matches or different text');
    }

    return true;

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    await page.screenshot({ path: 'dom-inspection-error.png' });
    return false;

  } finally {
    await browser.close();
  }
}

// Run the test
inspectABLocation()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 DOM Inspection Result:', success ? '✅ COMPLETED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });