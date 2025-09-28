#!/usr/bin/env node

/**
 * Check what's actually stored in the polls table for the test poll
 */

const { createClient } = require('@supabase/supabase-js');

async function checkPollData() {
  console.log('🔍 Checking Poll Data in Database');
  console.log('=================================');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST || '';
  const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Get the most recent poll (from console debug test)
    const pollId = '2493f878-1ddc-48e1-b7c1-6708a0a55b25';

    console.log(`✅ Checking poll: ${pollId}`);

    const { data: poll, error } = await supabase
      .from('polls')
      .select('*')
      .eq('id', pollId)
      .single();

    if (error) {
      console.error('❌ Error fetching poll:', error);
      return false;
    }

    if (!poll) {
      console.log('❌ Poll not found');
      return false;
    }

    console.log('\n📊 Poll Data:');
    console.log(`   ID: ${poll.id}`);
    console.log(`   Title: "${poll.title}"`);
    console.log(`   Type: ${poll.poll_type}`);
    console.log(`   Options: ${JSON.stringify(poll.options)}`);
    console.log(`   Created: ${poll.created_at}`);
    console.log(`   Updated: ${poll.updated_at}`);

    // The key discovery
    if (poll.options) {
      console.log('\n🎯 FOUND THE ISSUE!');
      console.log(`   Poll.options contains: ${JSON.stringify(poll.options)}`);
      console.log('   This is where the "A" and "B" nominations are coming from!');

      if (Array.isArray(poll.options) && poll.options.includes('A') && poll.options.includes('B')) {
        console.log('   ✅ CONFIRMED: Poll was created with ["A", "B"] as default options');
        console.log('   This explains why they appear even before voting');
        return true;
      }
    } else {
      console.log('\n❓ Poll.options is null/undefined');
      console.log('   The nominations must be coming from somewhere else');
    }

    // Also check all recent polls to see if they all have this issue
    console.log('\n🔍 Checking recent polls for pattern...');
    const { data: recentPolls, error: recentError } = await supabase
      .from('polls')
      .select('id, title, poll_type, options, created_at')
      .eq('poll_type', 'nomination')
      .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()) // Last 2 hours
      .order('created_at', { ascending: false })
      .limit(10);

    if (recentError) {
      console.error('❌ Error fetching recent polls:', recentError);
    } else if (recentPolls) {
      console.log(`   Found ${recentPolls.length} recent nomination polls:`);
      recentPolls.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.title}: ${JSON.stringify(p.options)}`);
      });

      const pollsWithAB = recentPolls.filter(p =>
        Array.isArray(p.options) &&
        p.options.includes('A') &&
        p.options.includes('B')
      );

      if (pollsWithAB.length > 0) {
        console.log(`\n📍 PATTERN CONFIRMED: ${pollsWithAB.length}/${recentPolls.length} recent polls have ["A", "B"] options`);
        console.log('   This suggests the poll creation process is adding these as defaults');
      }
    }

    return true;

  } catch (error) {
    console.error('\n❌ Check failed with error:', error.message);
    return false;
  }
}

// Run the check
checkPollData()
  .then(success => {
    console.log('\n' + '='.repeat(50));
    console.log('🏁 Check Result:', success ? '✅ COMPLETED' : '❌ FAILED');
    console.log('='.repeat(50));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });