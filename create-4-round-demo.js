import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

console.log('🎯 Creating 4+ Round Borda Count Demo Poll')

async function create4RoundDemo() {
  try {
    // Create poll with 6 candidates for more elimination rounds
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        title: 'Borda Count 4+ Round Demo: Anti-Batch Elimination',
        poll_type: 'ranked_choice',
        options: [
          'Alpha Party',
          'Beta Coalition', 
          'Gamma Movement',
          'Delta Alliance',
          'Epsilon Group',
          'Zeta Union'
        ]
      })
      .select()
      .single()

    if (pollError) throw pollError

    console.log(`✅ Poll created with ID: ${poll.id}`)

    // Carefully crafted voting pattern to create 4+ rounds
    // This creates multiple ties that would trigger batch elimination in old system
    // But Borda count will eliminate them one by one
    const votes = [
      // Alpha gets 2 first place votes (early leader)
      ['Alpha Party', 'Beta Coalition', 'Gamma Movement', 'Delta Alliance', 'Epsilon Group', 'Zeta Union'],
      ['Alpha Party', 'Gamma Movement', 'Beta Coalition', 'Delta Alliance', 'Epsilon Group', 'Zeta Union'],
      
      // Beta, Gamma, Delta each get 1 first place vote (tied for elimination in OLD system)
      ['Beta Coalition', 'Alpha Party', 'Gamma Movement', 'Delta Alliance', 'Epsilon Group', 'Zeta Union'],
      ['Gamma Movement', 'Alpha Party', 'Delta Alliance', 'Beta Coalition', 'Epsilon Group', 'Zeta Union'],
      ['Delta Alliance', 'Alpha Party', 'Beta Coalition', 'Gamma Movement', 'Epsilon Group', 'Zeta Union'],
      
      // Epsilon gets 0 first place but positioned as 2nd choice (will survive longer due to Borda)
      ['Alpha Party', 'Epsilon Group', 'Gamma Movement', 'Beta Coalition', 'Delta Alliance', 'Zeta Union'],
      ['Beta Coalition', 'Epsilon Group', 'Alpha Party', 'Gamma Movement', 'Delta Alliance', 'Zeta Union'],
      
      // Zeta gets no first place votes and poor Borda score (eliminated first)
      ['Gamma Movement', 'Beta Coalition', 'Alpha Party', 'Delta Alliance', 'Epsilon Group', 'Zeta Union'],
      ['Delta Alliance', 'Beta Coalition', 'Gamma Movement', 'Alpha Party', 'Epsilon Group', 'Zeta Union']
    ]

    console.log('📝 Submitting 9 strategic votes designed for 4+ round elimination...')
    
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

    // Run the ranked choice algorithm
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

    console.log('\n💡 BATCH vs SEQUENTIAL ELIMINATION COMPARISON:')
    console.log('❌ OLD BATCH SYSTEM would have eliminated ALL tied candidates simultaneously')
    console.log('✅ NEW BORDA SYSTEM eliminates only the candidate with lowest Borda score each round')
    console.log('🎯 This prevents unfair "double eliminations" and allows better candidates to survive!')

    // Return the poll URL
    const pollUrl = `http://localhost:3000/poll/${poll.id}`
    console.log(`\n🌐 Demo Poll URL: ${pollUrl}`)
    console.log(`📝 Poll ID: ${poll.id}`)
    
    return poll.id

  } catch (error) {
    console.error('❌ Error creating 4-round demo poll:', error.message)
    throw error
  }
}

create4RoundDemo()