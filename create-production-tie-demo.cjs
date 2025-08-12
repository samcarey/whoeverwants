const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Use PRODUCTION database
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_PRODUCTION,
  process.env.SUPABASE_ACCESS_TOKEN_PRODUCTION
);

async function createTieBreakingDemo() {
  try {
    console.log('🎯 Creating Tie-Breaking Demo Poll on PRODUCTION...');
    
    // Create poll with strategic candidate names
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert([{
        title: 'Tie-Breaking Demo: How Borda Count Works',
        poll_type: 'ranked_choice',
        options: [
          'Apple Cafe',
          'Banana Bistro', 
          'Cherry Cafe',
          'Date Diner'
        ],
        response_deadline: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // Already expired
        creator_secret: 'demo-secret-456'
      }])
      .select()
      .single();

    if (pollError) {
      console.error('❌ Error creating poll:', pollError);
      return;
    }

    console.log('✅ Poll created successfully!');
    console.log('🆔 Poll ID:', poll.id);
    console.log('🔗 Short ID:', poll.short_id);
    
    // Strategic votes to create tie-breaking scenarios
    const strategicVotes = [
      // Cherry and Date get clear leads
      ['Cherry Cafe', 'Apple Cafe', 'Banana Bistro', 'Date Diner'],
      ['Date Diner', 'Banana Bistro', 'Apple Cafe', 'Cherry Cafe'],
      ['Cherry Cafe', 'Banana Bistro', 'Date Diner', 'Apple Cafe'],
      ['Date Diner', 'Apple Cafe', 'Cherry Cafe', 'Banana Bistro'],
      
      // More votes to create Borda tie-breaking
      ['Cherry Cafe', 'Apple Cafe', 'Date Diner', 'Banana Bistro'],
      ['Date Diner', 'Banana Bistro', 'Cherry Cafe', 'Apple Cafe'],
    ];

    console.log('📝 Submitting strategic votes...');
    
    for (let i = 0; i < strategicVotes.length; i++) {
      const { error: voteError } = await supabase
        .from('votes')
        .insert({
          poll_id: poll.id,
          vote_type: 'ranked_choice',
          ranked_choices: strategicVotes[i],
          created_at: new Date(Date.now() - 10 * 60 * 1000 + i * 60 * 1000).toISOString()
        });

      if (voteError) {
        console.error(`❌ Error submitting vote ${i + 1}:`, voteError);
        return;
      }
      
      console.log(`   ✓ Vote ${i + 1}: [${strategicVotes[i].join(' > ')}]`);
    }

    console.log(`\n✅ Successfully submitted ${strategicVotes.length} votes`);
    
    // Force poll to be closed
    const { error: closeError } = await supabase
      .from('polls')
      .update({ is_closed: true })
      .eq('id', poll.id);
      
    if (closeError) {
      console.error('❌ Error closing poll:', closeError);
    } else {
      console.log('🔒 Poll marked as closed');
    }

    console.log('\n🎉 TIE-BREAKING DEMO READY!');
    console.log(`🌐 View at: https://decisionbot.a.pinggy.link/p/${poll.short_id || poll.id}`);
    console.log(`🔗 Direct: https://kifnvombihyfwszuwqvy.supabase.co/p/${poll.short_id || poll.id}`);
    
    return poll;
    
  } catch (error) {
    console.error('💥 Unexpected error:', error);
  }
}

createTieBreakingDemo();