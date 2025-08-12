import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function debugBordaData() {
  console.log('🔍 Debugging Borda Count Data Storage')
  
  // Check the most recent demo poll
  const pollId = '9c1a6ec6-2b1b-4128-8168-6ec1ac70ff79'
  
  console.log(`\n📊 Checking poll: ${pollId}`)
  
  const { data: rounds, error } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .eq('poll_id', pollId)
    .order('round_number')
    .order('vote_count', { ascending: false })
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  console.log('\n📋 All Rounds Data:')
  let currentRound = 0
  for (const round of rounds) {
    if (round.round_number !== currentRound) {
      currentRound = round.round_number
      console.log(`\n📍 Round ${currentRound}:`)
    }
    
    const bordaScore = round.borda_score !== null ? round.borda_score : 'null'
    const tieBroken = round.tie_broken_by_borda ? 'YES' : 'no'
    const eliminated = round.is_eliminated ? 'ELIMINATED' : 'survives'
    
    console.log(`   ${round.option_name}: ${round.vote_count} votes, Borda: ${bordaScore}, TieBroken: ${tieBroken}, ${eliminated}`)
  }
  
  // Check if any tie-breaking occurred
  const tieBreakingRounds = rounds.filter(r => r.tie_broken_by_borda === true)
  console.log(`\n🎯 Tie-breaking rounds found: ${tieBreakingRounds.length}`)
  
  if (tieBreakingRounds.length > 0) {
    console.log('\n✅ Tie-breaking data exists! The UI logic must be wrong.')
    tieBreakingRounds.forEach(r => {
      console.log(`   Round ${r.round_number}: ${r.option_name} (Borda: ${r.borda_score}, Eliminated: ${r.is_eliminated})`)
    })
  } else {
    console.log('\n❌ No tie-breaking data found. The algorithm might not be triggering.')
    console.log('Creating a poll that GUARANTEES tie-breaking...')
    await createGuaranteedTieBreakingPoll()
  }
}

async function createGuaranteedTieBreakingPoll() {
  try {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    
    const { data: poll } = await supabase
      .from('polls')
      .insert({
        title: 'DEBUG: Guaranteed Borda Tie-Breaking',
        poll_type: 'ranked_choice', 
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        response_deadline: pastDate.toISOString(),
        created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single()

    console.log(`\n🔧 Created debug poll: ${poll.id}`)

    // Votes designed to create a perfect tie scenario
    // 4 votes total: A=1, B=1, C=1, D=1 (all tied)
    // But different Borda scores will break the tie
    const votes = [
      ['Option A', 'Option B', 'Option C', 'Option D'], // A=1st, B=2nd, C=3rd, D=4th
      ['Option B', 'Option A', 'Option D', 'Option C'], // B=1st, A=2nd, D=3rd, C=4th  
      ['Option C', 'Option D', 'Option A', 'Option B'], // C=1st, D=2nd, A=3rd, B=4th
      ['Option D', 'Option C', 'Option B', 'Option A'], // D=1st, C=2nd, B=3rd, A=4th
    ]

    for (let i = 0; i < votes.length; i++) {
      await supabase
        .from('votes')
        .insert({
          poll_id: poll.id,
          vote_type: 'ranked_choice',
          ranked_choices: votes[i],
          created_at: new Date(Date.now() - 22 * 60 * 60 * 1000 + i * 60 * 1000).toISOString()
        })
    }

    await supabase.from('polls').update({ is_closed: true }).eq('id', poll.id)

    console.log('🔄 Running algorithm on perfect tie scenario...')
    
    const { data: result } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id })

    console.log(`Winner: ${result[0].winner}, Rounds: ${result[0].total_rounds}`)

    // Check the results
    const { data: debugRounds } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .order('round_number')
      .order('borda_score', { ascending: false, nullsLast: true })

    console.log('\n🔧 DEBUG POLL RESULTS:')
    let currentRound = 0
    for (const round of debugRounds) {
      if (round.round_number !== currentRound) {
        currentRound = round.round_number
        console.log(`\nRound ${currentRound}:`)
      }
      console.log(`   ${round.option_name}: ${round.vote_count} votes, Borda: ${round.borda_score}, TieBroken: ${round.tie_broken_by_borda}, ${round.is_eliminated ? 'ELIM' : 'OK'}`)
    }

    const pollUrl = `http://decisionbot.a.pinggy.link/poll?id=${poll.id}`
    console.log(`\n🌐 DEBUG POLL URL: ${pollUrl}`)
    
    return poll.id
  } catch (error) {
    console.error('Error creating debug poll:', error)
  }
}

debugBordaData()