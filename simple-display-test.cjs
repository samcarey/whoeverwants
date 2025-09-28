#!/usr/bin/env node

/**
 * Simple test for the display bug
 */

const { chromium } = require('playwright');

async function simpleDisplayTest() {
  console.log('🎯 Simple Display Bug Test');
  console.log('===========================');

  const pollId = '12006c39-055b-4fea-8afd-dc061efbf891'; // Has ["FirstNom","SecondNom"]

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log(`\n🌐 Loading poll: ${pollId}`);
    console.log('   Database has: ["FirstNom","SecondNom"]');
    console.log('   Expected: Both nominations should show');

    await page.goto(`http://localhost:3000/p/${pollId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const results = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasFirstNom: text.includes('FirstNom'),
        hasSecondNom: text.includes('SecondNom'),
        pageText: text
      };
    });

    console.log(`\n📊 Results:`);
    console.log(`   "FirstNom" visible: ${results.hasFirstNom}`);
    console.log(`   "SecondNom" visible: ${results.hasSecondNom}`);

    await page.screenshot({ path: 'simple-display-test.png' });
    console.log(`   📸 Screenshot saved`);

    await browser.close();

    if (!results.hasFirstNom && results.hasSecondNom) {
      console.log('\n🎯 BUG CONFIRMED: Only SecondNom shows (user\'s exact report)');
      return false;
    } else if (results.hasFirstNom && results.hasSecondNom) {
      console.log('\n✅ NO BUG: Both nominations show correctly');
      return true;
    } else if (results.hasFirstNom && !results.hasSecondNom) {
      console.log('\n⚠️ DIFFERENT BUG: Only FirstNom shows');
      return false;
    } else {
      console.log('\n❌ DISPLAY ISSUE: Neither nomination shows');
      console.log(`   Page text: ${results.pageText.slice(0, 200)}`);
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    return false;
  }
}

simpleDisplayTest()
  .then(result => {
    console.log('\n' + '='.repeat(40));
    console.log(result ? '✅ WORKING' : '❌ BUG FOUND');
    console.log('='.repeat(40));
  });