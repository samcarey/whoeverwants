import { config } from 'dotenv'
import { getTestDatabase } from './tests/helpers/database.js'

// Load environment variables
config()

console.log('🔍 Debugging test expectations...')

async function debug() {
  const db = getTestDatabase()
  
  try {
    // Create test poll
    const { data: poll, error: pollError } = await db
      .from('polls')
      .insert({
        title: `Debug Poll ${Date.now()}`,
        poll_type: 'ranked_choice',
        options: ['A', 'B', 'C', 'D', 'E']
      })
      .select()
      .single()

    if (pollError) throw new Error(`Failed to create poll: ${pollError.message}`)
    
    console.log('✅ Poll created:', poll.id)

    // Debug the failing 5-candidate scenario
    const votes = [
      ['A', 'B', 'C', 'D', 'E'],  // A=1
      ['C', 'A', 'B', 'D', 'E'],  // C=1  
      ['D', 'A', 'C', 'B', 'E'],  // D=1
      ['E', 'C', 'A', 'B', 'D']   // E=1, B=0 first place, no majority (need 3/4)
    ]

    for (const voteArray of votes) {
      const { error: voteError } = await db
        .from('votes')
        .insert({
          poll_id: poll.id,
          vote_type: 'ranked_choice',
          ranked_choices: voteArray
        })

      if (voteError) throw new Error(`Failed to insert vote: ${voteError.message}`)
    }
    
    console.log('✅ Votes inserted')

    // Calculate results
    const { data: result, error: calcError } = await db
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id })

    if (calcError) throw new Error(`Calculation failed: ${calcError.message}`)
    
    console.log('🏆 Winner:', result[0].winner)
    console.log('📊 Total rounds:', result[0].total_rounds)

    // Get detailed rounds
    const { data: rounds, error: roundsError } = await db
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .order('round_number')
      .order('vote_count', { ascending: false })

    if (roundsError) throw new Error(`Failed to get rounds: ${roundsError.message}`)
    
    console.log('\n📋 Round details:')
    
    let currentRound = 0
    for (const round of rounds) {
      if (round.round_number !== currentRound) {
        currentRound = round.round_number
        console.log(`\n  Round ${currentRound}:`)
      }
      const status = round.is_eliminated ? '❌ eliminated' : '✅ survives'
      console.log(`    ${round.option_name}: ${round.vote_count} votes ${status}`)
    }

    // Cleanup
    await db.from('polls').delete().eq('id', poll.id)
    console.log('\n🧹 Cleaned up test poll')
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message)
  }
}

debug()