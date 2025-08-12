const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_PRODUCTION,
  process.env.SUPABASE_ACCESS_TOKEN_PRODUCTION
);

async function checkBorda() {
  const { data: poll } = await supabase
    .from('polls')
    .select('id')
    .eq('short_id', 'M')
    .single();
    
  const { data: rounds } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .eq('poll_id', poll.id)
    .eq('round_number', 1)
    .order('vote_count', { ascending: false })
    .order('borda_score', { ascending: false });
    
  console.log('🔍 Round 1 Results (Checking for Borda tie-breaking):');
  console.log('================================================');
  rounds.forEach(r => {
    const status = r.is_eliminated ? '❌ ELIMINATED' : '✅ survives';
    const borda = r.borda_score !== null ? ` (Borda Score: ${r.borda_score})` : '';
    const tieBreak = r.tie_broken_by_borda ? ' ⚡ TIE-BROKEN BY BORDA COUNT!' : '';
    console.log(`${r.option_name}: ${r.vote_count} votes${borda} - ${status}${tieBreak}`);
  });
  
  console.log('\n📊 Analysis:');
  const tied = rounds.filter(r => r.vote_count === 0);
  if (tied.length > 1) {
    console.log(`Found ${tied.length} candidates tied at 0 votes: ${tied.map(t => t.option_name).join(', ')}`);
    if (tied.some(t => t.borda_score !== null)) {
      console.log('✅ Borda scores were calculated to break the tie!');
    }
  }
}

checkBorda();