// Test to verify elimination logic works correctly
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function testEliminationLogic() {
  console.log('🧪 Testing Elimination Logic');
  console.log('=============================\n');

  try {
    // Create test poll with scenario that requires elimination
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        title: 'Elimination Logic Test',
        poll_type: 'ranked_choice',
        options: ['A', 'B', 'C', 'D']
      })
      .select()
      .single();

    if (pollError) throw pollError;
    console.log(`✅ Poll created: ${poll.id}`);

    // Scenario: A=1, C=1, B=0, D=0 (B and D should be eliminated)
    const votes = [
      { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['A', 'C', 'B', 'D'] },
      { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['C', 'A', 'D', 'B'] }
    ];

    for (let i = 0; i < votes.length; i++) {
      await supabase.from('votes').insert(votes[i]);
      console.log(`   Voter ${i + 1}: [${votes[i].ranked_choices.join(' > ')}]`);
    }

    console.log('\n🔍 Expected:');
    console.log('   Round 1: A=1, C=1, B=0, D=0');
    console.log('   → B and D should be eliminated (0 votes)');
    console.log('   Round 2: A vs C with transferred votes');

    // Run calculation
    const { data: result } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id });

    console.log(`\n🏆 Winner: ${result[0].winner}, Rounds: ${result[0].total_rounds}`);

    // Check detailed rounds
    const { data: rounds } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .order('round_number')
      .order('vote_count', { ascending: false });

    let currentRound = 0;
    for (const round of rounds) {
      if (round.round_number !== currentRound) {
        currentRound = round.round_number;
        console.log(`\n📍 Round ${currentRound}:`);
      }
      const status = round.is_eliminated ? '❌ ELIMINATED' : '✅ advancing';
      console.log(`   ${round.option_name}: ${round.vote_count} votes ${status}`);
    }

    // Verify B and D were eliminated in round 1
    const round1 = rounds.filter(r => r.round_number === 1);
    const bElim = round1.find(r => r.option_name === 'B')?.is_eliminated;
    const dElim = round1.find(r => r.option_name === 'D')?.is_eliminated;
    const bVotes = round1.find(r => r.option_name === 'B')?.vote_count;
    const dVotes = round1.find(r => r.option_name === 'D')?.vote_count;

    console.log('\n✅ VERIFICATION:');
    console.log(`   B: ${bVotes} votes, eliminated: ${bElim} ${bElim ? '✅' : '❌'}`);
    console.log(`   D: ${dVotes} votes, eliminated: ${dElim} ${dElim ? '✅' : '❌'}`);

    if (bElim && dElim && bVotes === 0 && dVotes === 0) {
      console.log('🎉 ELIMINATION LOGIC WORKING CORRECTLY!');
    } else {
      console.log('⚠️  ELIMINATION LOGIC NEEDS DEBUGGING');
    }

    // Clean up
    await supabase.from('polls').delete().eq('id', poll.id);
    console.log('\n🧹 Cleaned up');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testEliminationLogic();