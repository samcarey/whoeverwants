const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Use TEST database (freshly migrated)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function createFinalBordaDemo() {
  try {
    console.log('🎯 Creating ULTIMATE Tie-Breaking Demo on TEST DATABASE...');
    console.log('💫 With full Borda count functionality!');
    
    // Create poll with perfect tie-breaking scenario
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert([{
        title: 'BORDA COUNT TIE-BREAKING DEMO',
        poll_type: 'ranked_choice',
        options: [
          'Alice',     // Will have 0 first-place votes but HIGH Borda score
          'Bob',       // Will have 0 first-place votes but LOW Borda score  
          'Charlie',   // Will have 2 first-place votes
          'Diana'      // Will have 2 first-place votes
        ],
        response_deadline: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // Already expired
        creator_secret: 'borda-demo-final'
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
    
    // PERFECTLY CRAFTED VOTES for Borda tie-breaking:
    // Charlie gets 2 first-place votes, Diana gets 2 first-place votes
    // Alice and Bob BOTH get 0 first-place votes (TIED!)
    // But Alice will have higher Borda score than Bob
    const strategicVotes = [
      ['Charlie', 'Alice', 'Bob', 'Diana'],     // Alice=3pts, Bob=2pts  
      ['Charlie', 'Alice', 'Diana', 'Bob'],     // Alice=3pts, Bob=1pt
      ['Diana', 'Alice', 'Bob', 'Charlie'],     // Alice=3pts, Bob=2pts
      ['Diana', 'Alice', 'Charlie', 'Bob'],     // Alice=3pts, Bob=1pt
    ];
    
    console.log('📊 Expected Borda Calculation (4-point system):');
    console.log('   Alice: 0 first-place + (3+3+3+3) = 12 Borda points');  
    console.log('   Bob: 0 first-place + (2+1+2+1) = 6 Borda points');
    console.log('   → Bob should be eliminated due to lower Borda score!');

    console.log('\n📝 Submitting 4 strategic votes...');
    
    for (let i = 0; i < strategicVotes.length; i++) {
      const { error: voteError } = await supabase
        .from('votes')
        .insert({
          poll_id: poll.id,
          vote_type: 'ranked_choice',
          ranked_choices: strategicVotes[i],
          created_at: new Date(Date.now() - 10 * 60 * 1000 + i * 30 * 1000).toISOString() // 30 seconds apart, before deadline
        });

      if (voteError) {
        console.error(`❌ Error with vote ${i + 1}:`, voteError);
        return;
      }
      
      console.log(`   ✓ Vote ${i + 1}: [${strategicVotes[i].join(' > ')}]`);
    }

    console.log('\n🔒 Closing poll...');
    await supabase
      .from('polls')
      .update({ is_closed: true })
      .eq('id', poll.id);
      
    console.log('📊 Triggering ranked choice calculation...');
    const { data: result, error: calcError } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id });
    
    if (calcError) {
      console.error('❌ Calculation error:', calcError);
    } else {
      console.log('✅ Winner calculated:', result);
    }
    
    // Verify the Borda scores are present
    const { data: rounds } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .eq('round_number', 1)
      .order('vote_count', { ascending: false })
      .order('borda_score', { ascending: false });
      
    console.log('\n🔍 Round 1 Results (Borda Tie-Breaking):');
    console.log('==========================================');
    rounds.forEach(r => {
      const status = r.is_eliminated ? '❌ ELIMINATED' : '✅ SURVIVES';
      const borda = r.borda_score !== null ? ` [Borda: ${r.borda_score}]` : '';
      const tieBreak = r.tie_broken_by_borda ? ' ⚡ TIE-BROKEN BY BORDA!' : '';
      console.log(`${r.option_name}: ${r.vote_count} votes${borda} ${status}${tieBreak}`);
    });

    console.log('\n🎉 ULTIMATE BORDA DEMO IS READY!');
    console.log(`🌐 View at: https://decisionbot.a.pinggy.link/p/${poll.short_id}`);
    console.log(`🔗 Local: http://localhost:3000/p/${poll.short_id}`);
    
    console.log('\n🎯 What you\'ll see:');
    console.log('• Round 1: Alice & Bob both have 0 first-place votes (TIED!)');
    console.log('• Borda scores displayed: Alice (12 points) vs Bob (6 points)');
    console.log('• Bob eliminated due to lower Borda score');
    console.log('• Complete elimination rounds showing the full process');
    
    return poll;
    
  } catch (error) {
    console.error('💥 Error:', error);
  }
}

createFinalBordaDemo();