#!/usr/bin/env node

/**
 * Test the specific poll that has multiple nominations to see if only 2nd shows
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

async function testDisplayBug() {
  console.log('🎯 Testing Display Bug on Known Multi-Nomination Poll');
  console.log('=====================================================');

  const pollId = '12006c39-055b-4fea-8afd-dc061efbf891'; // Has ["FirstNom","SecondNom"]

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // First, confirm database state
    console.log('\n📊 Database State:');

    const { data: votes } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', pollId);

    const multiVote = votes.find(v => v.nominations && v.nominations.length > 1);
    if (multiVote) {
      console.log(`   ✅ Found multi-nomination vote: ${JSON.stringify(multiVote.nominations)}`);
      console.log(`   Expected UI: Should show both "FirstNom" AND "SecondNom"`);
    } else {
      console.log(`   ❌ No multi-nomination vote found`);
      return false;
    }

    // Test UI display
    console.log('\n🌐 Testing UI Display:');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`http://localhost:3000/p/${pollId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const uiResults = await page.evaluate(() => {
      const text = document.body.innerText;

      // Look specifically for the nomination names (avoid false positives)
      const hasFirstNom = text.includes('FirstNom');
      const hasSecondNom = text.includes('SecondNom');

      // Get the nominations section specifically
      const nominationsSection = document.querySelector('*:contains("All Nominations"), *:contains("Nominations"), [class*="nomination"]');
      const nominationsText = nominationsSection ? nominationsSection.textContent : 'No nominations section found';

      // Also check for results/vote counts
      const voteCountElements = Array.from(document.querySelectorAll('*')).filter(el =>
        el.textContent && el.textContent.includes('vote')
      );

      return {
        hasFirstNom,
        hasSecondNom,
        fullText: text,
        nominationsText,
        voteCountsFound: voteCountElements.length,
        voteCountTexts: voteCountElements.slice(0, 3).map(el => el.textContent)
      };
    });

    console.log(`   "FirstNom" visible: ${uiResults.hasFirstNom}`);
    console.log(`   "SecondNom" visible: ${uiResults.hasSecondNom}`);
    console.log(`   Vote counts found: ${uiResults.voteCountsFound}`);

    if (uiResults.voteCountTexts.length > 0) {
      console.log(`   Vote count examples: ${uiResults.voteCountTexts.join(', ')}`);
    }

    await page.screenshot({ path: 'display-bug-test.png' });
    console.log(`   📸 Screenshot: display-bug-test.png`);

    await browser.close();

    // Analysis
    console.log('\n🔍 BUG ANALYSIS:');

    const bothVisible = uiResults.hasFirstNom && uiResults.hasSecondNom;
    const onlySecondVisible = !uiResults.hasFirstNom && uiResults.hasSecondNom;
    const onlyFirstVisible = uiResults.hasFirstNom && !uiResults.hasSecondNom;
    const neitherVisible = !uiResults.hasFirstNom && !uiResults.hasSecondNom;

    console.log(`   Database has: ["FirstNom","SecondNom"]`);
    console.log(`   UI shows both: ${bothVisible}`);
    console.log(`   UI shows only FirstNom: ${onlyFirstVisible}`);
    console.log(`   UI shows only SecondNom: ${onlySecondVisible}`);
    console.log(`   UI shows neither: ${neitherVisible}`);

    if (onlySecondVisible) {
      console.log('\n🎯 BUG CONFIRMED: Only 2nd nomination shows!');
      console.log('   This matches the user\'s report exactly.');
      return false;
    } else if (bothVisible) {
      console.log('\n✅ NO BUG: Both nominations display correctly');
      return true;
    } else if (onlyFirstVisible) {
      console.log('\n⚠️ DIFFERENT BUG: Only 1st nomination shows (opposite of reported)');
      return false;
    } else {
      console.log('\n❌ DISPLAY ISSUE: Neither nomination shows');
      console.log(`   Page text sample: ${uiResults.fullText.slice(0, 300)}`);
      return false;
    }

  } catch (error) {
    console.error('\n💥 Test failed:', error.message);
    return false;
  }
}

testDisplayBug()
  .then(result => {
    console.log('\n' + '='.repeat(60));
    console.log('🏁 DISPLAY BUG TEST:', result ? '✅ NO BUG FOUND' : '❌ BUG CONFIRMED');
    console.log('='.repeat(60));
  });