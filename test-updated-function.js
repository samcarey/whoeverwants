import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function testUpdatedFunction() {
  const pollId = 'df36f911-066a-411a-b584-59d959cc7edd'
  
  console.log('🔄 Re-running algorithm with updated function...')
  
  const { data: result, error } = await supabase
    .rpc('calculate_ranked_choice_winner', { target_poll_id: pollId })

  if (error) {
    console.error('❌ Error:', error)
    return
  }

  console.log(`🏆 Winner: ${result[0].winner}, Rounds: ${result[0].total_rounds}`)

  // Check results with Borda data
  const { data: rounds } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .eq('poll_id', pollId)
    .order('round_number')
    .order('vote_count', { ascending: false })

  console.log('\n📊 UPDATED RESULTS WITH BORDA SCORES:')
  let currentRound = 0
  for (const round of rounds) {
    if (round.round_number !== currentRound) {
      currentRound = round.round_number
      console.log(`\nRound ${currentRound}:`)
    }
    const bordaScore = round.borda_score !== null ? round.borda_score : 'null'
    const tieBroken = round.tie_broken_by_borda ? '🎯 TIE-BROKEN' : ''
    const eliminated = round.is_eliminated ? '❌ ELIMINATED' : '✅ survives'
    console.log(`   ${round.option_name}: ${round.vote_count} votes, Borda: ${bordaScore} ${tieBroken} ${eliminated}`)
  }

  const tieBreakerRounds = rounds.filter(r => r.tie_broken_by_borda === true)
  if (tieBreakerRounds.length > 0) {
    console.log('\n🎉 SUCCESS! TIE-BREAKING DATA NOW STORED!')
    console.log('✅ The UI should now show the Borda count explanation!')
    
    console.log('\nTie-breaking details:')
    tieBreakerRounds.forEach(r => {
      const status = r.is_eliminated ? 'ELIMINATED' : 'SURVIVED'
      console.log(`  Round ${r.round_number}: ${r.option_name} = ${r.borda_score} Borda → ${status}`)
    })
  } else {
    console.log('\n❌ Still no tie-breaking data stored.')
  }
  
  const pollUrl = `http://decisionbot.a.pinggy.link/poll?id=${pollId}`
  console.log(`\n🌐 TEST POLL URL: ${pollUrl}`)
}

testUpdatedFunction()