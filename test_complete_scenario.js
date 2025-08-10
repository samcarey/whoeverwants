// Complete test to show the fix with a scenario that produces a clear winner
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function testCompleteScenario() {
  console.log('🧪 Testing Complete Ranked Choice Scenario');
  console.log('==========================================\n');

  try {
    // Create test poll
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        title: 'Complete RCV Test',
        poll_type: 'ranked_choice',
        options: ['A', 'B', 'C']
      })
      .select()
      .single();

    if (pollError) throw pollError;
    console.log(`✅ Poll created: ${poll.id}`);

    // Insert votes that will show clear winner
    console.log('\n📊 Test scenario:');
    const votes = [
      { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['A', 'C', 'B'] }, // A first
      { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['A', 'B', 'C'] }, // A first  
      { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['C', 'A', 'B'] }, // C first
      { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['C', 'B', 'A'] }, // C first
      { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['C', 'A', 'B'] }  // C first
    ];

    for (let i = 0; i < votes.length; i++) {
      await supabase.from('votes').insert(votes[i]);
      console.log(`   Voter ${i + 1}: [${votes[i].ranked_choices.join(' > ')}]`);
    }

    console.log('\n🔍 Expected results:');
    console.log('   Round 1: A=2 votes, C=3 votes, B=0 votes');
    console.log('   → B eliminated (0 first-place votes)');
    console.log('   Round 2: Vote transfers, C should win with majority');

    // Run calculation
    const { data: result } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id });

    console.log('\n🏆 ACTUAL RESULTS:');
    console.log(`   Winner: ${result[0].winner}`);
    console.log(`   Total rounds: ${result[0].total_rounds}`);

    // Get detailed rounds
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
        console.log(`\n   Round ${currentRound}:`);
      }
      const status = round.is_eliminated ? 'ELIMINATED' : 'advancing';
      console.log(`     ${round.option_name}: ${round.vote_count} votes (${status})`);
    }

    // Verify B was eliminated first
    const round1 = rounds.filter(r => r.round_number === 1);
    const bEliminated = round1.find(r => r.option_name === 'B')?.is_eliminated;
    const bVotes = round1.find(r => r.option_name === 'B')?.vote_count;

    console.log('\n✅ VERIFICATION:');
    console.log(`   B had ${bVotes} first-place votes and was ${bEliminated ? 'correctly eliminated' : 'NOT eliminated - BUG!'}`);
    console.log(`   Winner is ${result[0].winner} (should be C with 3 first-place votes)`);

    // Clean up
    await supabase.from('polls').delete().eq('id', poll.id);
    console.log('\n🧹 Test poll cleaned up');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testCompleteScenario();