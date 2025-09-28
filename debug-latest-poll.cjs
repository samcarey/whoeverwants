#!/usr/bin/env node

/**
 * Debug the latest poll to see database state and UI state
 */

const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');

async function debugLatestPoll() {
  console.log('🔍 Debugging Latest Poll State');
  console.log('===============================');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Get the most recent poll
    const { data: polls } = await supabase
      .from('polls')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!polls || polls.length === 0) {
      console.log('❌ No polls found');
      return;
    }

    const poll = polls[0];
    console.log(`\n📊 Latest Poll: ${poll.id}`);
    console.log(`   Title: ${poll.title}`);
    console.log(`   Type: ${poll.poll_type}`);

    // Check votes for this poll
    const { data: votes } = await supabase
      .from('votes')
      .select('*')
      .eq('poll_id', poll.id)
      .order('created_at', { ascending: false });

    console.log(`\n🗳️ Votes for this poll: ${votes.length}`);
    votes.forEach((vote, i) => {
      console.log(`   Vote ${i + 1}:`);
      console.log(`     ID: ${vote.id}`);
      console.log(`     Nominations: ${JSON.stringify(vote.nominations)}`);
      console.log(`     Is abstain: ${vote.is_abstain}`);
      console.log(`     Voter: ${vote.voter_name}`);
      console.log(`     Created: ${vote.created_at}`);
      console.log(`     Updated: ${vote.updated_at}`);
    });

    // Now check what the UI shows
    console.log(`\n🌐 Checking UI for poll: ${poll.id}`);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`http://localhost:3000/p/${poll.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const pageContent = await page.evaluate(() => {
      return {
        title: document.title,
        bodyText: document.body.innerText,
        hasFirstChoice: document.body.innerText.includes('FirstChoice'),
        hasSecondChoice: document.body.innerText.includes('SecondChoice'),
        hasResults: document.body.innerText.includes('Result') || document.body.innerText.includes('Vote'),
        html: document.documentElement.outerHTML.slice(0, 2000) // First 2000 chars
      };
    });

    console.log(`\n📱 UI State:`);
    console.log(`   Page title: ${pageContent.title}`);
    console.log(`   Has "FirstChoice": ${pageContent.hasFirstChoice}`);
    console.log(`   Has "SecondChoice": ${pageContent.hasSecondChoice}`);
    console.log(`   Has results section: ${pageContent.hasResults}`);

    console.log(`\n📄 Page body text (first 500 chars):`);
    console.log(pageContent.bodyText.slice(0, 500));

    await page.screenshot({ path: 'debug-latest-poll.png' });
    console.log(`\n📸 Screenshot saved: debug-latest-poll.png`);

    await browser.close();

    // Analysis
    console.log(`\n🔍 ANALYSIS:`);
    const hasDbVotes = votes.length > 0;
    const hasValidNominations = votes.some(v => v.nominations && v.nominations.length > 0);
    console.log(`   Database has votes: ${hasDbVotes}`);
    console.log(`   Database has valid nominations: ${hasValidNominations}`);
    console.log(`   UI shows nominations: ${pageContent.hasFirstChoice || pageContent.hasSecondChoice}`);

    if (hasDbVotes && !pageContent.hasFirstChoice) {
      console.log(`\n⚠️ ISSUE IDENTIFIED: Database has votes but UI doesn't show nominations`);
      console.log(`   This suggests a frontend display problem`);
    }

  } catch (error) {
    console.error('Debug failed:', error.message);
  }
}

debugLatestPoll();