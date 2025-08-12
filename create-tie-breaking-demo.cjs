const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function createTieBreakingDemo() {
  try {
    console.log('🎯 Creating Tie-Breaking Demo Poll...');
    
    // Create poll with strategic candidate names for alphabetical tie-breaking demonstration
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert([{
        title: 'Tie-Breaking Demo: Borda Count + Alphabetical',
        poll_type: 'ranked_choice',
        options: [
          'Alpha Restaurant',
          'Beta Bistro', 
          'Gamma Grill',
          'Delta Diner'
        ],
        response_deadline: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago (expired)
        creator_secret: 'demo-secret-123'
      }])
      .select()
      .single();

    if (pollError) {
      console.error('❌ Error creating poll:', pollError);
      return;
    }

    console.log('✅ Poll created successfully!');
    console.log('🆔 Poll ID:', poll.id);
    console.log('📅 Deadline:', poll.response_deadline, '(EXPIRED - poll is closed)');
    
    // Now add strategic votes to demonstrate both tie-breaking mechanisms
    console.log('\n📊 Adding strategic votes to demonstrate tie-breaking...');
    
    // These votes are carefully crafted to create specific tie scenarios:
    const strategicVotes = [
      // Votes that give Gamma and Delta clear first-place leads
      ['Gamma Grill', 'Alpha Restaurant', 'Beta Bistro', 'Delta Diner'], // Gamma=1st
      ['Delta Diner', 'Beta Bistro', 'Alpha Restaurant', 'Gamma Grill'], // Delta=1st
      ['Gamma Grill', 'Beta Bistro', 'Delta Diner', 'Alpha Restaurant'], // Gamma=1st (Gamma now has 2)
      ['Delta Diner', 'Alpha Restaurant', 'Gamma Grill', 'Beta Bistro'], // Delta=1st (Delta now has 2)
      
      // Votes that create Borda count tie-breaking scenario
      // Alpha and Beta will be tied at 0 first-place votes, but different Borda scores
      ['Gamma Grill', 'Alpha Restaurant', 'Beta Bistro', 'Delta Diner'], // Alpha gets 2nd place (3 points)
      ['Delta Diner', 'Beta Bistro', 'Alpha Restaurant', 'Gamma Grill'], // Beta gets 2nd place (3 points), Alpha gets 3rd (2 points)
      
      // Additional votes to create perfect tie scenario in later round
      ['Gamma Grill', 'Delta Diner', 'Alpha Restaurant', 'Beta Bistro'], // More strategic positioning
      ['Delta Diner', 'Gamma Grill', 'Beta Bistro', 'Alpha Restaurant']  // Create complex Borda calculations
    ];

    console.log('📝 Submitting 8 strategically crafted votes...');
    
    for (let i = 0; i < strategicVotes.length; i++) {
      const { error: voteError } = await supabase
        .from('votes')
        .insert({
          poll_id: poll.id,
          vote_type: 'ranked_choice',
          ranked_choices: strategicVotes[i],
          created_at: new Date(Date.now() - 10 * 60 * 1000 + i * 60 * 1000).toISOString() // Votes before deadline
        });

      if (voteError) {
        console.error(`❌ Error submitting vote ${i + 1}:`, voteError);
        return;
      }
      
      console.log(`   ✓ Vote ${i + 1}: [${strategicVotes[i].join(' > ')}]`);
    }

    console.log(`\n✅ Successfully submitted ${strategicVotes.length} votes to the closed poll`);
    
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
    console.log(`📊 View results at: http://localhost:3000/p/${poll.short_id || poll.id}`);
    console.log(`🌐 Public URL: https://decisionbot.a.pinggy.link/p/${poll.short_id || poll.id}`);
    
    // Let's analyze what should happen:
    console.log('\n🔍 Expected Tie-Breaking Scenarios:');
    console.log('1️⃣ ROUND 1: Alpha and Beta should be tied at 0 first-place votes');
    console.log('   → Borda Count breaks the tie (different cumulative scores)');
    console.log('2️⃣ LATER ROUNDS: May demonstrate alphabetical tie-breaking');
    console.log('   → If perfect tie occurs, alphabetical order determines elimination');
    
    return poll;
    
  } catch (error) {
    console.error('💥 Unexpected error:', error);
  }
}

// Run the demo
createTieBreakingDemo();