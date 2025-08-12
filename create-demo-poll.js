import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

console.log('🎯 Creating Borda Count Tie-Breaking Demo Poll')

async function createDemoPoll() {
  try {
    // Create poll with 5 candidates designed to show sequential vs batch elimination
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        title: 'Borda Count Demo: Sequential vs Batch Elimination',
        poll_type: 'ranked_choice',
        options: [
          'Progressive Party (A)',
          'Conservative Party (B)', 
          'Green Party (C)',
          'Reform Party (D)',
          'Independent (E)'
        ]
      })
      .select()
      .single()

    if (pollError) throw pollError

    console.log(`✅ Poll created with ID: ${poll.id}`)

    // Create strategic voting pattern that showcases Borda count benefits
    // This pattern creates ties that would trigger batch elimination in old system
    // But Borda count eliminates sequentially based on broader appeal
    const votes = [
      // Progressive gets early lead (2 first-place votes)
      ['Progressive Party (A)', 'Green Party (C)', 'Reform Party (D)', 'Conservative Party (B)', 'Independent (E)'],
      ['Progressive Party (A)', 'Reform Party (D)', 'Green Party (C)', 'Conservative Party (B)', 'Independent (E)'],
      
      // But other parties have first-place support too (would be tied for elimination)
      ['Conservative Party (B)', 'Progressive Party (A)', 'Green Party (C)', 'Reform Party (D)', 'Independent (E)'],
      ['Green Party (C)', 'Progressive Party (A)', 'Reform Party (D)', 'Conservative Party (B)', 'Independent (E)'],
      ['Reform Party (D)', 'Progressive Party (A)', 'Conservative Party (B)', 'Green Party (C)', 'Independent (E)'],
      
      // Independent gets no first-place votes but some second-choice support
      // Green Party positioned well as second choice (broader appeal)
      ['Progressive Party (A)', 'Green Party (C)', 'Independent (E)', 'Reform Party (D)', 'Conservative Party (B)'],
      ['Conservative Party (B)', 'Green Party (C)', 'Progressive Party (A)', 'Independent (E)', 'Reform Party (D)']
    ]

    console.log('📝 Submitting strategic votes that showcase Borda count benefits...')
    
    for (let i = 0; i < votes.length; i++) {
      const { error: voteError } = await supabase
        .from('votes')
        .insert({
          poll_id: poll.id,
          vote_type: 'ranked_choice',
          ranked_choices: votes[i]
        })

      if (voteError) throw voteError
    }

    console.log(`✅ Submitted ${votes.length} strategic votes`)

    // Run the ranked choice algorithm to see the results
    console.log('🔄 Running Borda count ranked choice algorithm...')
    
    const { data: result, error: rcError } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id })

    if (rcError) throw rcError

    console.log('📊 Results with Borda Count Sequential Elimination:')
    console.log(`🏆 Winner: ${result[0].winner}`)
    console.log(`📈 Rounds: ${result[0].total_rounds}`)

    // Get detailed round information
    const { data: rounds, error: roundsError } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .order('round_number')
      .order('vote_count', { ascending: false })

    if (roundsError) throw roundsError

    console.log('\n🎯 Sequential Elimination Breakdown:')
    let currentRound = 0
    for (const round of rounds) {
      if (round.round_number !== currentRound) {
        currentRound = round.round_number
        console.log(`\n📍 Round ${currentRound}:`)
      }
      const status = round.is_eliminated ? '❌ ELIMINATED' : '✅ survives'
      console.log(`   ${round.option_name}: ${round.vote_count} votes ${status}`)
    }

    console.log('\n🔍 Key Insight:')
    console.log('In the OLD system: Multiple tied candidates would be eliminated simultaneously (batch elimination)')
    console.log('In the NEW system: Only the candidate with lowest Borda score is eliminated each round (sequential elimination)')
    console.log('This allows candidates with broader appeal to make comebacks even if they don\'t lead in first-place votes!')

    // Return the poll URL (assuming app is running on localhost:3000 in dev)
    const pollUrl = `http://localhost:3000/poll/${poll.id}`
    console.log(`\n🌐 Demo Poll URL: ${pollUrl}`)
    console.log(`📝 Poll ID: ${poll.id}`)
    
    return poll.id

  } catch (error) {
    console.error('❌ Error creating demo poll:', error.message)
    throw error
  }
}

createDemoPoll()