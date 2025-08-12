import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

console.log('🎯 Creating Borda Count Explanation Demo Poll')

async function createBordaExplanationDemo() {
  try {
    // Create poll with expiration date in the PAST so it's automatically closed
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000) // 1 day ago
    
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        title: 'DEMO: Borda Count Tie-Breaking Explanation',
        poll_type: 'ranked_choice',
        options: [
          'Pizza Palace',
          'Burger Barn', 
          'Sushi Station',
          'Taco Time'
        ],
        response_deadline: pastDate.toISOString(), // Past date = automatically closed
        created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // Created 25 hours ago
      })
      .select()
      .single()

    if (pollError) throw pollError

    console.log(`✅ Poll created with ID: ${poll.id}`)
    console.log(`📅 Expiration: ${poll.response_deadline} (PAST DATE - poll is closed)`)

    // Carefully crafted votes to create a clear Borda count tie-breaking scenario
    // This will create a situation where 2+ candidates are tied for last place
    // But they have different Borda scores, so only 1 gets eliminated
    const votes = [
      // Pizza gets 3 first-place votes (clear leader)
      ['Pizza Palace', 'Sushi Station', 'Burger Barn', 'Taco Time'],
      ['Pizza Palace', 'Burger Barn', 'Sushi Station', 'Taco Time'],
      ['Pizza Palace', 'Taco Time', 'Sushi Station', 'Burger Barn'],
      
      // Burger and Sushi each get 1 first-place vote (TIED FOR ELIMINATION)
      // But they have DIFFERENT Borda scores due to their ranking positions
      ['Burger Barn', 'Sushi Station', 'Pizza Palace', 'Taco Time'], // Burger=1, Sushi gets 2nd choice
      ['Sushi Station', 'Burger Barn', 'Pizza Palace', 'Taco Time'], // Sushi=1, Burger gets 2nd choice
      
      // Taco Time gets 0 first-place votes but good Borda score (positioned as 2nd choice often)
      ['Pizza Palace', 'Taco Time', 'Burger Barn', 'Sushi Station'],
      ['Pizza Palace', 'Taco Time', 'Sushi Station', 'Burger Barn'],
    ]

    console.log('📝 Submitting 7 votes designed to trigger Borda count tie-breaking...')
    
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

    // Run the ranked choice algorithm to generate results with Borda scores
    console.log('🔄 Running Borda count algorithm with score tracking...')
    
    const { data: result, error: rcError } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id })

    if (rcError) throw rcError

    console.log('\n📊 FINAL RESULTS (Poll is CLOSED):')
    console.log(`🏆 Winner: ${result[0].winner}`)
    console.log(`📈 Total Rounds: ${result[0].total_rounds}`)

    // Get detailed round information INCLUDING Borda scores
    const { data: rounds, error: roundsError } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .order('round_number')
      .order('vote_count', { ascending: false })

    if (roundsError) throw roundsError

    console.log('\n🎯 DETAILED RESULTS WITH BORDA SCORES:')
    let currentRound = 0
    for (const round of rounds) {
      if (round.round_number !== currentRound) {
        currentRound = round.round_number
        console.log(`\n📍 Round ${currentRound}:`)
      }
      const status = round.is_eliminated ? '❌ ELIMINATED' : '✅ survives'
      const bordaInfo = round.borda_score !== null ? ` (Borda: ${round.borda_score})` : ''
      const tieInfo = round.tie_broken_by_borda ? ' 🎯 TIE-BROKEN BY BORDA' : ''
      console.log(`   ${round.option_name}: ${round.vote_count} votes ${status}${bordaInfo}${tieInfo}`)
    }

    console.log('\n💡 BORDA COUNT TIE-BREAKING EXPLANATION:')
    const tieBreakerRounds = rounds.filter(r => r.tie_broken_by_borda === true)
    if (tieBreakerRounds.length > 0) {
      const roundNum = tieBreakerRounds[0].round_number
      const tiedCandidates = tieBreakerRounds.filter(r => r.round_number === roundNum)
      console.log(`📍 In Round ${roundNum}, multiple candidates tied for elimination:`)
      
      tiedCandidates
        .sort((a, b) => (b.borda_score || 0) - (a.borda_score || 0))
        .forEach(candidate => {
          const status = candidate.is_eliminated ? 'ELIMINATED (lowest Borda)' : 'SURVIVED (higher Borda)'
          console.log(`   • ${candidate.option_name}: ${candidate.borda_score} Borda points → ${status}`)
        })
        
      console.log('✅ Result: Only the candidate with LOWEST Borda score was eliminated')
      console.log('🚫 OLD System: Would have eliminated ALL tied candidates simultaneously')
    } else {
      console.log('ℹ️  No tie-breaking occurred in this scenario')
    }

    // Return the poll URL for the CLOSED poll with visible results AND Borda explanation
    const pollUrl = `http://decisionbot.a.pinggy.link/poll?id=${poll.id}`
    console.log(`\n🌐 BORDA EXPLANATION DEMO URL: ${pollUrl}`)
    console.log(`📝 Poll ID: ${poll.id}`)
    console.log(`✅ Status: CLOSED - Results with Borda count explanations are visible!`)
    
    return poll.id

  } catch (error) {
    console.error('❌ Error creating Borda explanation demo poll:', error.message)
    throw error
  }
}

createBordaExplanationDemo()