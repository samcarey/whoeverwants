const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function checkAndCalculate() {
  const pollId = 'b9cfd3e3-37fc-4af3-a7c0-95927d60ebf6';
  
  console.log('📊 Checking poll data...');
  
  // Call the ranked choice function directly
  const { data, error } = await supabase
    .rpc('calculate_ranked_choice_winner', { p_poll_id: pollId });
    
  if (error) {
    console.log('❌ Error calculating:', error);
  } else {
    console.log('✅ Winner calculated:', data);
  }
  
  // Check rounds
  const { data: rounds } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .eq('poll_id', pollId)
    .order('round_number', { ascending: true })
    .order('vote_count', { ascending: false });
    
  console.log('\n🔍 Round-by-round results:');
  if (rounds && rounds.length > 0) {
    let currentRound = 0;
    rounds.forEach(r => {
      if (r.round_number !== currentRound) {
        currentRound = r.round_number;
        console.log(`\n🔄 Round ${currentRound}:`);
      }
      const status = r.is_eliminated ? '❌ ELIMINATED' : '✅ survives';
      const borda = r.borda_score !== null ? ` (Borda: ${r.borda_score})` : '';
      const tieBreak = r.tie_broken_by_borda ? ' 🎯 [TIE-BROKEN BY BORDA]' : '';
      console.log(`  ${r.option_name}: ${r.vote_count} votes${borda} ${status}${tieBreak}`);
    });
    
    // Show winner
    const winner = rounds.find(r => !r.is_eliminated);
    if (winner) {
      console.log(`\n🏆 WINNER: ${winner.option_name}`);
    }
  } else {
    console.log('❌ No rounds found - calculation may have failed');
  }
  
  // Check poll results view
  const { data: results } = await supabase
    .from('poll_results')
    .select('*')
    .eq('poll_id', pollId)
    .single();
    
  console.log('\n📈 Poll Results View:');
  console.log(`  Winner: ${results.winner || 'NOT SET'}`);
  console.log(`  Total Rounds: ${results.total_rounds || 'NOT SET'}`);
  console.log(`  Total Votes: ${results.total_votes}`);
}

checkAndCalculate();