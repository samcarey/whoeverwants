const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function createAlphabeticalTieDemo() {
  try {
    console.log('🔤 Creating Alphabetical Tie-Breaking Demo...');
    
    // Create poll with candidates that will tie in Borda score
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert([{
        title: 'ALPHABETICAL TIE-BREAKING TEST',
        poll_type: 'ranked_choice',
        options: [
          'Alice',     // Should WIN alphabetical tie-breaking  
          'Bob',       // Should be eliminated (alphabetically last)
          'Charlie',   // Will have most votes
          'Diana'      // Will have second most votes
        ],
        response_deadline: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        creator_secret: 'alphabetical-test'
      }])
      .select()
      .single();

    if (pollError) {
      console.error('❌ Error creating poll:', pollError);
      return;
    }

    console.log('✅ Poll created!');
    console.log('🔗 Short ID:', poll.short_id);
    
    // Craft votes so Alice and Bob tie with same Borda scores
    // Charlie gets most votes, Diana gets second most
    // Alice and Bob both get 0 first-place votes but SAME Borda score
    const strategicVotes = [
      ['Charlie', 'Diana', 'Alice', 'Bob'],    // Alice=2pts, Bob=1pt
      ['Charlie', 'Diana', 'Bob', 'Alice'],    // Alice=1pt, Bob=2pts  
      ['Diana', 'Charlie', 'Alice', 'Bob'],    // Alice=2pts, Bob=1pt
      ['Diana', 'Charlie', 'Bob', 'Alice'],    // Alice=1pt, Bob=2pts
    ];
    
    // Total Borda scores: Alice = 2+1+2+1 = 6, Bob = 1+2+1+2 = 6 (TIED!)
    // Alphabetical tie-breaking should eliminate Bob (keep Alice)
    
    console.log('📊 Expected Result:');
    console.log('   Alice: 0 first-place votes, 6 Borda points ✅ SURVIVES');
    console.log('   Bob: 0 first-place votes, 6 Borda points ❌ ELIMINATED (alphabetical)');

    console.log('\n📝 Submitting 4 strategic votes...');
    
    for (let i = 0; i < strategicVotes.length; i++) {
      const { error: voteError } = await supabase
        .from('votes')
        .insert({
          poll_id: poll.id,
          vote_type: 'ranked_choice',
          ranked_choices: strategicVotes[i],
          created_at: new Date(Date.now() - 10 * 60 * 1000 + i * 30 * 1000).toISOString()
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
    
    // Check results
    const { data: rounds } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .eq('round_number', 1)
      .order('vote_count', { ascending: false })
      .order('borda_score', { ascending: false });
      
    console.log('\n🔍 Round 1 Results:');
    rounds.forEach(r => {
      const status = r.is_eliminated ? '❌ ELIMINATED' : '✅ survives';
      const borda = r.borda_score !== null ? ` [Borda: ${r.borda_score}]` : '';
      const tieBreak = r.tie_broken_by_borda ? ' ⚡ TIE-BROKEN!' : '';
      console.log(`  ${r.option_name}: ${r.vote_count} votes${borda} ${status}${tieBreak}`);
    });

    console.log('\n🎉 ALPHABETICAL TIE-BREAKING TEST READY!');
    console.log(`🌐 View at: https://decisionbot.a.pinggy.link/p/${poll.short_id}`);
    
    return poll;
    
  } catch (error) {
    console.error('💥 Error:', error);
  }
}

createAlphabeticalTieDemo();