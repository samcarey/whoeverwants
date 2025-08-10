// Test script to verify the ranked choice bug fix
// This reproduces the exact scenario from the production poll
// and verifies that candidates with 0 first-place votes are eliminated first

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Use test database
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function testRankedChoiceFix() {
  console.log('🧪 Testing Ranked Choice Voting Bug Fix');
  console.log('=====================================\n');

  try {
    // Step 1: Create test poll
    console.log('1. Creating test poll...');
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        title: 'RCV Bug Fix Test',
        poll_type: 'ranked_choice',
        options: ['A', 'B', 'C', 'D', 'E']
      })
      .select()
      .single();

    if (pollError) throw pollError;
    console.log(`✅ Poll created: ${poll.id}`);

    // Step 2: Insert test votes (same as production bug)
    console.log('\n2. Inserting test votes...');
    const votes = [
      { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['A', 'D', 'B', 'C', 'E'] },
      { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['E', 'A', 'B', 'C', 'D'] },
      { poll_id: poll.id, vote_type: 'ranked_choice', ranked_choices: ['D', 'E', 'A', 'B', 'C'] }
    ];

    for (let i = 0; i < votes.length; i++) {
      const { error: voteError } = await supabase.from('votes').insert(votes[i]);
      if (voteError) throw voteError;
      console.log(`✅ Vote ${i + 1} inserted: [${votes[i].ranked_choices.join(', ')}]`);
    }

    // Step 3: Calculate results using the fixed algorithm
    console.log('\n3. Running ranked choice calculation...');
    const { data: result, error: calcError } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id });

    if (calcError) throw calcError;
    console.log(`✅ Calculation complete`);
    console.log(`🏆 Winner: ${result[0].winner}`);
    console.log(`📊 Total rounds: ${result[0].total_rounds}`);

    // Step 4: Examine round-by-round results
    console.log('\n4. Round-by-round analysis:');
    const { data: rounds, error: roundsError } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .order('round_number')
      .order('vote_count', { ascending: false });

    if (roundsError) throw roundsError;

    let currentRound = 0;
    for (const round of rounds) {
      if (round.round_number !== currentRound) {
        currentRound = round.round_number;
        console.log(`\n📍 Round ${currentRound}:`);
      }
      const status = round.is_eliminated ? '❌ ELIMINATED' : '✅ advancing';
      console.log(`   ${round.option_name}: ${round.vote_count} votes ${status}`);
    }

    // Step 5: Verify the fix worked
    console.log('\n5. Verification:');
    
    // Check first round - B and C should have 0 votes and be eliminated
    const round1 = rounds.filter(r => r.round_number === 1);
    const bVotes = round1.find(r => r.option_name === 'B')?.vote_count;
    const cVotes = round1.find(r => r.option_name === 'C')?.vote_count;
    const bEliminated = round1.find(r => r.option_name === 'B')?.is_eliminated;
    const cEliminated = round1.find(r => r.option_name === 'C')?.is_eliminated;

    console.log(`   B in Round 1: ${bVotes} votes, eliminated: ${bEliminated}`);
    console.log(`   C in Round 1: ${cVotes} votes, eliminated: ${cEliminated}`);

    // Verify fix
    if (bVotes === 0 && cVotes === 0 && bEliminated && cEliminated) {
      console.log('✅ BUG FIX VERIFIED: Candidates with 0 votes correctly eliminated first!');
    } else {
      console.log('❌ BUG STILL EXISTS: Candidates with 0 votes not eliminated properly!');
    }

    // Check that winner makes sense
    const round1Winners = round1.filter(r => !r.is_eliminated);
    console.log(`   Advancing from Round 1: ${round1Winners.map(r => `${r.option_name}(${r.vote_count})`).join(', ')}`);

    // Expected: A(1), D(1), E(1) should advance; B(0), C(0) eliminated
    const expectedAdvancing = ['A', 'D', 'E'].sort();
    const actualAdvancing = round1Winners.map(r => r.option_name).sort();
    
    if (JSON.stringify(expectedAdvancing) === JSON.stringify(actualAdvancing)) {
      console.log('✅ CORRECT: A, D, E advance from Round 1 (each has 1 first-place vote)');
    } else {
      console.log(`❌ INCORRECT: Expected [${expectedAdvancing.join(',')}], got [${actualAdvancing.join(',')}]`);
    }

    // Step 6: Clean up
    console.log('\n6. Cleaning up...');
    await supabase.from('polls').delete().eq('id', poll.id);
    console.log('✅ Test poll deleted');

    console.log('\n🎉 TEST COMPLETE');
    console.log('================');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
  }
}

// Run the test
testRankedChoiceFix();