import { createClient } from '@supabase/supabase-js';

async function debugBordaCalculation() {
  console.log('🔍 Debugging Borda Score Calculation');
  
  const supabase = createClient(
    'https://kfngceqepnzlljkwedtd.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbmdjZXFlcG56bGxqa3dlZHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MzAzOTIsImV4cCI6MjA2NjEwNjM5Mn0.MVcf7jfyRC5bAge9K0axNGFxoeEnwxetFluC0G4Y3As'
  );

  // Get poll 5 
  const { data: poll } = await supabase
    .from('polls')
    .select('*')
    .eq('short_id', '5')
    .single();

  if (!poll) {
    console.log('❌ Poll 5 not found');
    return;
  }

  console.log('Poll options:', poll.options);
  console.log('Total candidates:', poll.options.length);

  // Get all votes for this poll
  const { data: votes } = await supabase
    .from('votes')
    .select('*')
    .eq('poll_id', poll.id);

  console.log('\n📊 Vote Analysis:');
  console.log('Total votes:', votes?.length || 0);
  
  if (votes) {
    votes.forEach((vote, index) => {
      console.log(`Vote ${index + 1}: [${vote.ranked_choices.join(', ')}]`);
    });
  }

  // Manual Borda calculation
  console.log('\n🧮 Manual Borda Calculation:');
  const candidates = poll.options;
  const totalCandidates = candidates.length; // Should be 3
  console.log('Candidates:', candidates);
  console.log('Points system: 1st place =', totalCandidates, 'pts, 2nd place =', totalCandidates - 1, 'pts, 3rd place =', totalCandidates - 2, 'pts');

  const bordaScores = {};
  candidates.forEach(candidate => {
    bordaScores[candidate] = 0;
  });

  if (votes) {
    votes.forEach((vote, voteIndex) => {
      console.log(`\nVote ${voteIndex + 1}: [${vote.ranked_choices.join(', ')}]`);
      vote.ranked_choices.forEach((candidate, position) => {
        const points = totalCandidates - position; // position is 0-indexed
        bordaScores[candidate] += points;
        console.log(`  ${candidate} at position ${position + 1} gets ${points} points`);
      });
    });
  }

  console.log('\n🏆 Final Borda Scores (Manual Calculation):');
  Object.entries(bordaScores)
    .sort(([,a], [,b]) => b - a)
    .forEach(([candidate, score]) => {
      console.log(`  ${candidate}: ${score} points`);
    });

  // Compare with database results
  console.log('\n💾 Database Borda Scores:');
  const { data: rounds } = await supabase
    .from('ranked_choice_rounds')
    .select('option_name, borda_score, vote_count, is_eliminated, tie_broken_by_borda')
    .eq('poll_id', poll.id)
    .eq('round_number', 1)
    .order('borda_score', { ascending: false });

  if (rounds) {
    rounds.forEach(round => {
      const manual = bordaScores[round.option_name];
      const database = round.borda_score;
      const match = manual === database ? '✅' : '❌';
      console.log(`  ${round.option_name}: ${database} points (manual: ${manual}) ${match} - eliminated: ${round.is_eliminated}, tie-broken: ${round.tie_broken_by_borda}`);
    });
  }

  // Test the exact SQL calculation
  console.log('\n🔍 Testing SQL Borda Calculation:');
  const { data: sqlTest, error } = await supabase.rpc('sql', {
    query: `
    WITH tied_candidates_array AS (
      SELECT ARRAY['A', 'B', 'C'] as tied_candidates
    )
    SELECT 
      choice_option as candidate,
      choice_rank as position_1_based,
      (3 - choice_rank + 1) as borda_points
    FROM votes v,
         unnest(v.ranked_choices) WITH ORDINALITY AS choices(choice_option, choice_rank),
         tied_candidates_array tca
    WHERE v.poll_id = '${poll.id}'
      AND v.vote_type = 'ranked_choice'
      AND choice_option = ANY(tca.tied_candidates)
    ORDER BY choice_option, choice_rank;
    `
  });

  if (error) {
    console.log('SQL test error:', error);
  } else if (sqlTest) {
    console.log('SQL breakdown:');
    sqlTest.forEach(row => {
      console.log(`  ${row.candidate} at position ${row.position_1_based} = ${row.borda_points} points`);
    });
    
    // Aggregate by candidate
    const sqlBordaScores = {};
    sqlTest.forEach(row => {
      if (!sqlBordaScores[row.candidate]) {
        sqlBordaScores[row.candidate] = 0;
      }
      sqlBordaScores[row.candidate] += row.borda_points;
    });
    
    console.log('\nSQL aggregated scores:');
    Object.entries(sqlBordaScores).forEach(([candidate, score]) => {
      console.log(`  ${candidate}: ${score} points`);
    });
  }
}

debugBordaCalculation().catch(console.error);