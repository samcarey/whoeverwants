const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function testBordaCalculation() {
  console.log('📊 Testing Borda calculation on demo poll...');
  
  // Run the calculation
  const { data: result, error: calcError } = await supabase
    .rpc('calculate_ranked_choice_winner', { target_poll_id: '74aab56c-f0ac-4567-ad3f-dea6db920654' });
  
  if (calcError) {
    console.error('❌ Calculation error:', calcError);
    return;
  }
  
  console.log('✅ Winner calculated:', result);
  
  // Check the rounds with Borda scores
  const { data: rounds } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .eq('poll_id', '74aab56c-f0ac-4567-ad3f-dea6db920654')
    .order('round_number')
    .order('vote_count', { ascending: false })
    .order('borda_score', { ascending: false });
    
  console.log('\n🔍 Detailed Round Results:');
  console.log('=========================');
  let currentRound = -1;
  rounds.forEach(r => {
    if (r.round_number !== currentRound) {
      currentRound = r.round_number;
      console.log(`\nRound ${currentRound + 1}:`);
    }
    const status = r.is_eliminated ? '❌ ELIMINATED' : '✅ survives';
    const borda = r.borda_score !== null ? ` [Borda: ${r.borda_score}]` : '';
    const tieBreak = r.tie_broken_by_borda ? ' ⚡ TIE-BROKEN BY BORDA!' : '';
    console.log(`  ${r.option_name}: ${r.vote_count} votes${borda} ${status}${tieBreak}`);
  });
  
  console.log('\n🎉 Demo poll is ready!');
}

testBordaCalculation();