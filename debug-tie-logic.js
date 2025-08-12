import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function debugTieLogic() {
  const pollId = '47d01358-a233-4ad9-80ce-51c713eb5227'
  
  console.log('🔍 Debugging tie logic for poll:', pollId)
  
  // Check the votes
  const { data: votes } = await supabase
    .from('votes')
    .select('ranked_choices')
    .eq('poll_id', pollId)
    .order('created_at')
    
  console.log('\n📊 Submitted votes:')
  votes.forEach((vote, i) => {
    console.log(`Vote ${i+1}: [${vote.ranked_choices.join(', ')}]`)
  })
  
  // Manual Borda calculation
  console.log('\n🧮 Manual Borda Score Calculation:')
  console.log('Scoring: 1st=3pts, 2nd=2pts, 3rd=1pt')
  
  let aliceTotal = 0, bobTotal = 0, charlieTotal = 0
  
  votes.forEach((vote, i) => {
    const choices = vote.ranked_choices
    console.log(`\nVote ${i+1}: [${choices.join(', ')}]`)
    
    choices.forEach((candidate, rank) => {
      const points = 3 - rank // 1st=3, 2nd=2, 3rd=1
      console.log(`  ${candidate}: ${rank + 1}${rank === 0 ? 'st' : rank === 1 ? 'nd' : 'rd'} place = ${points} points`)
      
      if (candidate === 'Alice') aliceTotal += points
      if (candidate === 'Bob') bobTotal += points  
      if (candidate === 'Charlie') charlieTotal += points
    })
  })
  
  console.log('\n📋 Total Borda Scores:')
  console.log(`Alice: ${aliceTotal} points`)
  console.log(`Bob: ${bobTotal} points`)
  console.log(`Charlie: ${charlieTotal} points`)
  
  // Check what the algorithm stored
  const { data: rounds } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .eq('poll_id', pollId)
    .order('round_number')
    .order('borda_score', { ascending: false, nullsLast: true })
    
  console.log('\n🗄️ Algorithm Results:')
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
  
  // Check if there was actually a legitimate tie-breaker or if it was alphabetical
  const round1TiedCandidates = rounds.filter(r => r.round_number === 1 && r.tie_broken_by_borda === true)
  
  if (round1TiedCandidates.length > 0) {
    console.log('\n🤔 Tie-breaking analysis:')
    const bobData = round1TiedCandidates.find(c => c.option_name === 'Bob')
    const charlieData = round1TiedCandidates.find(c => c.option_name === 'Charlie')
    
    if (bobData && charlieData) {
      console.log(`Bob Borda: ${bobData.borda_score}`)
      console.log(`Charlie Borda: ${charlieData.borda_score}`)
      
      if (bobData.borda_score === charlieData.borda_score) {
        console.log('⚠️  BOTH CANDIDATES HAD SAME BORDA SCORE!')
        console.log('📝 The algorithm should use alphabetical tie-breaking as secondary sort')
        console.log('📝 Function sorts: ORDER BY total_borda_score ASC, tied_candidate ASC')
        console.log('📝 So "Bob" comes before "Charlie" alphabetically → Bob eliminated')
      } else {
        console.log(`✅ Legitimate Borda tie-breaker: ${bobData.borda_score} vs ${charlieData.borda_score}`)
      }
    }
  }
}

debugTieLogic()