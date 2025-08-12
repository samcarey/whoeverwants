import { config } from 'dotenv';
import { getTestDatabase } from './tests/helpers/database.js';

config();

async function debugTest(testName, candidates, votes) {
  const db = getTestDatabase();
  
  console.log(`\n🔍 DEBUGGING: ${testName}`);
  console.log(`Candidates: ${candidates.join(', ')}`);
  console.log(`Votes: ${votes.map(v => JSON.stringify(v)).join(', ')}`);
  
  try {
    const { data: poll } = await db
      .from('polls')
      .insert({
        title: `Debug ${testName} ${Date.now()}`,
        poll_type: 'ranked_choice',
        options: candidates
      })
      .select()
      .single();

    for (const vote of votes) {
      await db.from('votes').insert({
        poll_id: poll.id,
        vote_type: 'ranked_choice',
        ranked_choices: vote
      });
    }
    
    const { data: result } = await db.rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id });
    const { data: rounds } = await db
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .order('round_number')
      .order('vote_count', { ascending: false });

    console.log(`🏆 Winner: ${result[0].winner}, Rounds: ${result[0].total_rounds}`);
    
    // Calculate Borda scores
    const bordaScores = {};
    candidates.forEach(c => bordaScores[c] = 0);
    
    votes.forEach(vote => {
      vote.forEach((candidate, rank) => {
        const points = candidates.length - rank;
        bordaScores[candidate] += points;
      });
    });
    
    console.log('📊 Borda Scores:');
    Object.entries(bordaScores).sort((a, b) => b[1] - a[1]).forEach(([c, s]) => {
      console.log(`  ${c}: ${s} points`);
    });

    console.log('\n📋 Actual Results:');
    let currentRound = 0;
    for (const round of rounds) {
      if (round.round_number !== currentRound) {
        currentRound = round.round_number;
        console.log(`\n  Round ${currentRound}:`);
      }
      const status = round.is_eliminated ? '❌ eliminated' : '✅ survives';
      console.log(`    ['${round.option_name}', ${round.vote_count}, ${round.is_eliminated}], // ${round.option_name}: ${round.vote_count} votes ${status}`);
    }

    await db.from('polls').delete().eq('id', poll.id);
    console.log('\n' + '='.repeat(80));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function fixTests() {
  // Borda-count tie-breaking test scenarios - failing tests
  await debugTest(
    "eliminates candidate with lowest Borda score when tied for last place",
    ['A', 'B', 'C', 'D'],
    [
      ['A', 'C', 'D', 'B'],  // A=1, C gets 2nd choice (3 pts), D gets 3rd choice (2 pts), B gets 4th choice (1 pt)
      ['B', 'C', 'A', 'D'],  // B=1, C gets 2nd choice (3 pts), A gets 3rd choice (2 pts), D gets 4th choice (1 pt)
      ['C', 'A', 'B', 'D'],  // C=1, A gets 2nd choice (3 pts), B gets 3rd choice (2 pts), D gets 4th choice (1 pt)
      ['D', 'A', 'C', 'B']   // D=1, A gets 2nd choice (3 pts), C gets 3rd choice (2 pts), B gets 4th choice (1 pt)
    ]
  );

  await debugTest(
    "uses Borda count to determine which candidate survives comeback scenario",
    ['A', 'B', 'C', 'D', 'E'],
    [
      ['A', 'B', 'C', 'D', 'E'],  // A=2 first place votes
      ['A', 'C', 'B', 'D', 'E'],  
      ['B', 'C', 'A', 'D', 'E'],  // B=1
      ['C', 'B', 'A', 'D', 'E'],  // C=1  
      ['D', 'C', 'B', 'A', 'E']   // D=1, E=0 (tied for last: D and E)
    ]
  );

  await debugTest(
    "handles Borda count when some candidates not ranked by all voters",
    ['A', 'B', 'C'],
    [
      ['A', 'B'],        // A=1, B gets 2 points, C gets 0 points (unranked)
      ['B', 'C'],        // B=1, C gets 2 points, A gets 0 points (unranked)  
      ['C', 'A']         // C=1, A gets 2 points, B gets 0 points (unranked)
    ]
  );

  await debugTest(
    "handles perfect Borda ties with alphabetical elimination",
    ['A', 'B'],
    [
      ['A', 'B'],  // A=1, B gets 1 Borda point
      ['B', 'A']   // B=1, A gets 1 Borda point  
    ]
  );

  await debugTest(
    "eliminates candidate with lowest Borda among multiple zero-vote candidates",
    ['A', 'B', 'C', 'D', 'E'],
    [
      ['A', 'B', 'C', 'D', 'E'],  // A=1
      ['B', 'C', 'A', 'D', 'E'],  // B=1, C,D,E get 0 first-place votes
      ['C', 'A', 'B', 'D', 'E']   // C=1, B,D,E get 0 first-place votes
    ]
  );

  await debugTest(
    "applies Borda count repeatedly across multiple rounds",
    ['A', 'B', 'C', 'D', 'E', 'F'],
    [
      ['A', 'B', 'C', 'D', 'E', 'F'],  // A=2
      ['A', 'C', 'B', 'D', 'E', 'F'],  
      ['B', 'A', 'C', 'D', 'E', 'F'],  // B=1
      ['C', 'A', 'B', 'D', 'E', 'F'],  // C=1
      ['D', 'A', 'B', 'C', 'E', 'F'],  // D=1, E=0, F=0 (tied for last)
      ['E', 'A', 'B', 'C', 'D', 'F']   // E=1, F=0
    ]
  );
}

fixTests();