import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

console.log('🎯 Creating CLOSED Borda Count Demo Poll (with expiration)')

async function createClosedDemo() {
  try {
    // Create poll with expiration date in the PAST so it's automatically closed
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
    
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        title: 'CLOSED: Borda Count vs Batch Elimination Demo',
        poll_type: 'ranked_choice',
        options: [
          'Alpha Party',
          'Beta Coalition', 
          'Gamma Movement',
          'Delta Alliance',
          'Epsilon Group',
          'Zeta Union'
        ],
        response_deadline: pastDate.toISOString(), // Past date = automatically closed
        created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // Created 25 hours ago
      })
      .select()
      .single()

    if (pollError) throw pollError

    console.log(`✅ Poll created with ID: ${poll.id}`)
    console.log(`📅 Expiration: ${poll.response_deadline} (PAST DATE - poll is closed)`)

    // Strategic voting pattern for 5+ round demonstration
    const votes = [
      // Alpha gets early lead (3 first-place votes)
      ['Alpha Party', 'Beta Coalition', 'Gamma Movement', 'Delta Alliance', 'Epsilon Group', 'Zeta Union'],
      ['Alpha Party', 'Gamma Movement', 'Beta Coalition', 'Delta Alliance', 'Epsilon Group', 'Zeta Union'],
      ['Alpha Party', 'Epsilon Group', 'Beta Coalition', 'Gamma Movement', 'Delta Alliance', 'Zeta Union'],
      
      // Beta, Gamma, Delta each get 2 first place votes (THIS IS THE KEY TIE!)
      // In OLD system: ALL THREE would be eliminated simultaneously  
      // In NEW system: Only lowest Borda score is eliminated each round
      ['Beta Coalition', 'Alpha Party', 'Gamma Movement', 'Delta Alliance', 'Epsilon Group', 'Zeta Union'],
      ['Beta Coalition', 'Epsilon Group', 'Alpha Party', 'Gamma Movement', 'Delta Alliance', 'Zeta Union'],
      ['Gamma Movement', 'Alpha Party', 'Beta Coalition', 'Delta Alliance', 'Epsilon Group', 'Zeta Union'], 
      ['Gamma Movement', 'Beta Coalition', 'Alpha Party', 'Delta Alliance', 'Epsilon Group', 'Zeta Union'],
      ['Delta Alliance', 'Alpha Party', 'Beta Coalition', 'Gamma Movement', 'Epsilon Group', 'Zeta Union'],
      ['Delta Alliance', 'Gamma Movement', 'Beta Coalition', 'Alpha Party', 'Epsilon Group', 'Zeta Union'],
      
      // Epsilon and Zeta get 0 first-place votes but different Borda scores
      ['Alpha Party', 'Beta Coalition', 'Epsilon Group', 'Gamma Movement', 'Delta Alliance', 'Zeta Union'],
      ['Beta Coalition', 'Alpha Party', 'Epsilon Group', 'Delta Alliance', 'Gamma Movement', 'Zeta Union']
    ]

    console.log('📝 Submitting 11 strategic votes to closed poll...')
    
    for (let i = 0; i < votes.length; i++) {
      const { error: voteError } = await supabase
        .from('votes')
        .insert({
          poll_id: poll.id,
          vote_type: 'ranked_choice',
          ranked_choices: votes[i],
          created_at: new Date(Date.now() - 23 * 60 * 60 * 1000 + i * 60 * 1000).toISOString() // Votes spread over time before deadline
        })

      if (voteError) throw voteError
    }

    console.log(`✅ Submitted ${votes.length} votes to the closed poll`)

    // Close the poll explicitly by setting is_closed = true
    const { error: closeError } = await supabase
      .from('polls')
      .update({ is_closed: true })
      .eq('id', poll.id)

    if (closeError) {
      console.log('⚠️  Could not set is_closed flag, but poll should be closed due to past expiration date')
    } else {
      console.log('✅ Poll explicitly closed with is_closed flag')
    }

    // Run the ranked choice algorithm to generate results
    console.log('🔄 Running Borda count algorithm on closed poll...')
    
    const { data: result, error: rcError } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id })

    if (rcError) throw rcError

    console.log('\n📊 FINAL RESULTS (Poll is CLOSED):')
    console.log(`🏆 Winner: ${result[0].winner}`)
    console.log(`📈 Total Rounds: ${result[0].total_rounds}`)

    // Get detailed round information
    const { data: rounds, error: roundsError } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .order('round_number')
      .order('vote_count', { ascending: false })

    if (roundsError) throw roundsError

    console.log('\n🎯 BORDA COUNT SEQUENTIAL ELIMINATION:')
    let currentRound = 0
    for (const round of rounds) {
      if (round.round_number !== currentRound) {
        currentRound = round.round_number
        console.log(`\n📍 Round ${currentRound}:`)
      }
      const status = round.is_eliminated ? '❌ ELIMINATED' : '✅ survives'
      console.log(`   ${round.option_name}: ${round.vote_count} votes ${status}`)
    }

    console.log('\n🔍 WHY BORDA COUNT PREVENTS UNFAIR BATCH ELIMINATION:')
    console.log('❌ OLD BATCH SYSTEM: When 3 candidates tied with 2 votes each, ALL would be eliminated together')
    console.log('✅ NEW BORDA SYSTEM: Only eliminates the candidate with lowest Borda score from tied group')
    console.log('🎯 RESULT: Candidates with broader appeal survive even without leading in first-place votes')

    // Return the poll URL for the CLOSED poll with visible results
    const pollUrl = `http://localhost:3000/poll/${poll.id}`
    console.log(`\n🌐 CLOSED DEMO POLL URL (Results Visible): ${pollUrl}`)
    console.log(`📝 Poll ID: ${poll.id}`)
    console.log(`✅ Status: CLOSED - Results are now visible!`)
    
    return poll.id

  } catch (error) {
    console.error('❌ Error creating closed demo poll:', error.message)
    throw error
  }
}

createClosedDemo()