import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://kfngceqepnzlljkwedtd.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbmdjZXFlcG56bGxqa3dlZHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MzAzOTIsImV4cCI6MjA2NjEwNjM5Mn0.MVcf7jfyRC5bAge9K0axNGFxoeEnwxetFluC0G4Y3As'
);

await supabase.from('polls').delete().eq('short_id', '6');
console.log('Cleaned up');

const { data: poll, error } = await supabase
  .from('polls')
  .insert({
    title: 'True Alphabetical Tie',
    poll_type: 'ranked_choice', 
    options: ['A', 'B', 'C', 'D'],
    response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    short_id: '6'
  })
  .select()
  .single();

if (error) throw error;

// Votes designed so A and C have same Borda scores (lowest)
const votes = [
  ['B', 'D', 'A', 'C'], // B=4, D=3, A=2, C=1
  ['D', 'B', 'C', 'A'], // D=4, B=3, C=2, A=1
  ['B', 'D', 'C', 'A'], // B=4, D=3, C=2, A=1
  ['D', 'B', 'A', 'C']  // D=4, B=3, A=2, C=1
];

for (const votePattern of votes) {
  await supabase.from('votes').insert({
    poll_id: poll.id,
    vote_type: 'ranked_choice',
    ranked_choices: votePattern
  });
}

// Expected Borda: A=6, B=14, C=6, D=14 (A and C tied lowest)
const bordaScores = { A: 0, B: 0, C: 0, D: 0 };
votes.forEach(pattern => {
  pattern.forEach((candidate, pos) => {
    bordaScores[candidate] += (4 - pos);
  });
});

console.log('Expected Borda scores:');
Object.entries(bordaScores).forEach(([c, s]) => console.log(`  ${c}: ${s}`));

const { data: winner } = await supabase
  .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id });

console.log('Winner:', winner);

const { data: rounds } = await supabase
  .from('ranked_choice_rounds') 
  .select('*')
  .eq('poll_id', poll.id)
  .eq('round_number', 1);

console.log('Round 1 (should show A eliminated via alphabetical tie-breaking):');
rounds?.forEach(r => 
  console.log(`  ${r.option_name}: ${r.borda_score} Borda, eliminated: ${r.is_eliminated}, tie-broken: ${r.tie_broken_by_borda}`)
);

console.log('\n🔗 http://decisionbot.a.pinggy.link/p/6#round1');