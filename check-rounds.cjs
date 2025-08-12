const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_PRODUCTION,
  process.env.SUPABASE_ACCESS_TOKEN_PRODUCTION
);

async function checkRounds() {
  const pollId = 'dd5b5e60-ade4-49d2-b31e-cf95048ad8d7';
  
  // Get rounds after calculation
  const { data: rounds, error } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .eq('poll_id', pollId)
    .order('round_number')
    .order('vote_count', { ascending: false });
    
  console.log('Rounds found:', rounds?.length || 0);
  
  if (rounds && rounds.length > 0) {
    let currentRound = 0;
    rounds.forEach(r => {
      if (r.round_number !== currentRound) {
        currentRound = r.round_number;
        console.log('\nRound', currentRound + ':');
      }
      const status = r.is_eliminated ? 'ELIMINATED' : 'survives';
      const borda = r.borda_score !== null ? ' (Borda: ' + r.borda_score + ')' : '';
      const tieBreak = r.tie_broken_by_borda ? ' [TIE-BROKEN BY BORDA]' : '';
      console.log('  ' + r.option_name + ': ' + r.vote_count + ' votes' + borda + ' ' + status + tieBreak);
    });
  }
  
  // Check results view again
  const { data: results } = await supabase
    .from('poll_results')
    .select('*')
    .eq('poll_id', pollId)
    .single();
    
  console.log('\nPoll Results View:');
  console.log('  Winner:', results.winner);
  console.log('  Total Rounds:', results.total_rounds);
  console.log('  Total Votes:', results.total_votes);
}

checkRounds();