const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_PRODUCTION,
  process.env.SUPABASE_ACCESS_TOKEN_PRODUCTION
);

async function createPerfectBordaDemo() {
  try {
    console.log('🎯 Creating PERFECT Borda Count Demo...');
    
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert([{
        title: 'Perfect Tie-Breaking Demo: See Borda Count in Action!',
        poll_type: 'ranked_choice',
        options: [
          'Alpha Team',
          'Bravo Team', 
          'Charlie Team',
          'Delta Team'
        ],
        response_deadline: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        creator_secret: 'demo-borda-123'
      }])
      .select()
      .single();

    if (pollError) {
      console.error('❌ Error creating poll:', pollError);
      return;
    }

    console.log('✅ Poll created!');
    console.log('🔗 Short ID:', poll.short_id);
    
    // Carefully crafted votes to force Borda tie-breaking
    // Charlie and Delta will each get 2 first-place votes
    // Alpha and Bravo will BOTH get 0 first-place votes (tied!)
    // But Alpha and Bravo will have different Borda scores
    const votes = [
      // Charlie gets 2 first-place votes
      ['Charlie Team', 'Alpha Team', 'Bravo Team', 'Delta Team'],  // Alpha=3pts, Bravo=2pts
      ['Charlie Team', 'Alpha Team', 'Delta Team', 'Bravo Team'],  // Alpha=3pts, Bravo=1pt
      
      // Delta gets 2 first-place votes  
      ['Delta Team', 'Bravo Team', 'Alpha Team', 'Charlie Team'],  // Bravo=3pts, Alpha=2pts
      ['Delta Team', 'Alpha Team', 'Bravo Team', 'Charlie Team'],  // Alpha=3pts, Bravo=2pts
    ];
    
    // Borda totals after these votes:
    // Charlie: 8 + 6 + 1 + 1 = 16 points (2 first-place votes)
    // Delta: 1 + 2 + 8 + 8 = 19 points (2 first-place votes)
    // Alpha: 6 + 6 + 4 + 6 = 22 points (0 first-place votes)
    // Bravo: 4 + 2 + 6 + 4 = 16 points (0 first-place votes)
    
    // Alpha and Bravo are tied at 0 votes, but Alpha has 22 Borda points vs Bravo's 16
    // So Bravo should be eliminated due to lower Borda score!

    console.log('📝 Submitting 4 perfectly crafted votes...');
    
    for (let i = 0; i < votes.length; i++) {
      const { error: voteError } = await supabase
        .from('votes')
        .insert({
          poll_id: poll.id,
          vote_type: 'ranked_choice',
          ranked_choices: votes[i],
          created_at: new Date(Date.now() - 10 * 60 * 1000 + i * 60 * 1000).toISOString()
        });

      if (voteError) {
        console.error(`❌ Error with vote ${i + 1}:`, voteError);
        return;
      }
      
      console.log(`   ✓ Vote ${i + 1}: [${votes[i].join(' > ')}]`);
    }

    // Close the poll
    await supabase
      .from('polls')
      .update({ is_closed: true })
      .eq('id', poll.id);
      
    console.log('🔒 Poll closed');
    
    // Trigger calculation
    const { data: result } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id });
    
    console.log('📊 Calculated winner:', result);

    console.log('\n🎉 PERFECT BORDA DEMO READY!');
    console.log(`🌐 View at: https://decisionbot.a.pinggy.link/p/${poll.short_id}`);
    console.log('\n🔍 What to look for:');
    console.log('   Round 1: Alpha and Bravo both have 0 votes (tied!)');
    console.log('   → Borda scores displayed to break the tie');
    console.log('   → Bravo eliminated due to lower Borda score');
    
  } catch (error) {
    console.error('💥 Error:', error);
  }
}

createPerfectBordaDemo();