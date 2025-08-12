import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkTieDemo() {
  const pollId = 'df36f911-066a-411a-b584-59d959cc7edd'
  
  console.log('🔍 Checking tie demo results...')
  
  // Check votes first
  const { data: votes } = await supabase
    .from('votes')
    .select('ranked_choices')
    .eq('poll_id', pollId)
  
  console.log('\n📊 Submitted votes:')
  votes.forEach((vote, i) => {
    console.log(`Vote ${i+1}: [${vote.ranked_choices.join(', ')}]`)
  })
  
  // Check rounds
  const { data: rounds } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .eq('poll_id', pollId)
    .order('round_number')
    .order('vote_count', { ascending: false })
  
  console.log('\n📋 Round Results:')
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
  console.log(`\n🎯 Tie-breaking rounds found: ${tieBreakerRounds.length}`)
  
  if (tieBreakerRounds.length === 0) {
    console.log('\n❌ Still no tie-breaking! The algorithm logic might be wrong.')
    console.log('Looking at Round 1 in detail...')
    
    const round1 = rounds.filter(r => r.round_number === 1)
    const minVotes = Math.min(...round1.map(r => r.vote_count))
    const tiedForLast = round1.filter(r => r.vote_count === minVotes)
    
    console.log(`\nRound 1 analysis:`)
    console.log(`Minimum votes: ${minVotes}`)
    console.log(`Candidates with ${minVotes} votes: ${tiedForLast.map(r => r.option_name).join(', ')}`)
    console.log(`Number tied: ${tiedForLast.length}`)
    
    if (tiedForLast.length > 1) {
      console.log('✅ There IS a tie for elimination!')
      console.log('❌ But algorithm did not store Borda scores. Bug in the function!')
    }
  }
}

checkTieDemo()