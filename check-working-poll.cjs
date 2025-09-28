#!/usr/bin/env node

/**
 * Check the working poll that successfully has both nominations
 * to see if there's a display issue
 */

const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');

async function checkWorkingPoll() {
  console.log('🔍 Checking Known Working Poll');
  console.log('===============================');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, serviceKey);

  // This poll successfully went through the workflow: A -> [B, A]
  const workingPollId = 'd7c5a531-4179-408e-a367-57fd0dbbc545';

  try {
    // Check database state
    console.log(`\n📊 Database State for ${workingPollId}:`);

    const { data: votes } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', workingPollId)
      .order('updated_at', { ascending: false });

    console.log(`   Votes: ${votes.length}`);
    if (votes.length > 0) {
      const vote = votes[0];
      console.log(`   Nominations: ${JSON.stringify(vote.nominations)}`);
      console.log(`   Expected: Should show both nominations`);
    }

    // Check UI display
    console.log(`\n🌐 UI Display Check:`);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`http://localhost:3000/p/${workingPollId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const uiState = await page.evaluate(() => {
      const text = document.body.innerText;

      // Look for each nomination specifically
      const hasA = text.includes('A');
      const hasB = text.includes('B');

      // Also look for any results/vote counts
      const resultsSection = document.querySelector('[class*="results"], [class*="Results"]');
      const hasResults = !!resultsSection;

      // Get all text content to analyze
      const allText = text;

      return {
        hasA,
        hasB,
        hasResults,
        allText: allText.slice(0, 1000),
        resultsHTML: resultsSection ? resultsSection.outerHTML.slice(0, 500) : 'No results section'
      };
    });

    console.log(`   Contains "A": ${uiState.hasA}`);
    console.log(`   Contains "B": ${uiState.hasB}`);
    console.log(`   Has results section: ${uiState.hasResults}`);

    await page.screenshot({ path: 'working-poll-check.png' });
    console.log(`   📸 Screenshot saved: working-poll-check.png`);

    await browser.close();

    // Analysis
    console.log(`\n🎯 BUG ANALYSIS:`);

    const dbHasBoth = votes.length > 0 && votes[0].nominations && votes[0].nominations.length >= 2;
    const uiShowsBoth = uiState.hasA && uiState.hasB;
    const uiShowsOnlySecond = !uiState.hasA && uiState.hasB;

    console.log(`   Database has both: ${dbHasBoth}`);
    console.log(`   UI shows both: ${uiShowsBoth}`);
    console.log(`   UI shows only 2nd: ${uiShowsOnlySecond}`);

    if (dbHasBoth && uiShowsOnlySecond) {
      console.log(`\n🎯 BUG CONFIRMED: Database has both nominations but UI only shows the 2nd one!`);
      console.log(`   Database: ${JSON.stringify(votes[0].nominations)}`);
      console.log(`   UI: Only shows "B", missing "A"`);
      return false;
    } else if (dbHasBoth && uiShowsBoth) {
      console.log(`\n✅ NO BUG: Both nominations showing correctly`);
      return true;
    } else {
      console.log(`\n❓ UNCLEAR: Need to investigate further`);
      console.log(`   Page text: ${uiState.allText}`);
      return null;
    }

  } catch (error) {
    console.error('Check failed:', error.message);
    return false;
  }
}

checkWorkingPoll()
  .then(result => {
    console.log('\n' + '='.repeat(50));
    if (result === true) {
      console.log('📊 RESULT: ✅ NO BUG - Both nominations display correctly');
    } else if (result === false) {
      console.log('📊 RESULT: ❌ BUG CONFIRMED - Only 2nd nomination shows');
    } else {
      console.log('📊 RESULT: ❓ UNCLEAR - Further investigation needed');
    }
    console.log('='.repeat(50));
  });