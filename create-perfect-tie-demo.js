import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

console.log('🎯 Creating PERFECT Borda Tie-Breaking Demo')

async function createPerfectTieDemo() {
  try {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    
    const { data: poll, error: pollError } = await supabase
      .from('polls')
      .insert({
        title: 'PERFECT: Borda Count Explanation Demo',
        poll_type: 'ranked_choice',
        options: [
          'Restaurant A',
          'Restaurant B', 
          'Restaurant C'
        ],
        response_deadline: pastDate.toISOString(),
        created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single()

    if (pollError) throw pollError

    console.log(`✅ Poll created with ID: ${poll.id}`)

    // Create B and C tie with different Borda scores:
    const votes = [
      ['Restaurant A', 'Restaurant B', 'Restaurant C'],  // A=1st(3pts), B=2nd(2pts), C=3rd(1pt)
      ['Restaurant A', 'Restaurant B', 'Restaurant C'],  // A=1st(3pts), B=2nd(2pts), C=3rd(1pt)
      ['Restaurant B', 'Restaurant C', 'Restaurant A'],  // B=1st(3pts), C=2nd(2pts), A=3rd(1pt)
      ['Restaurant C', 'Restaurant B', 'Restaurant A'],  // C=1st(3pts), B=2nd(2pts), A=3rd(1pt)
    ]
    // Vote counts: A=2, B=1, C=1 (B and C tied for elimination)  
    // Borda scores: A=(3+3+1+1)=8, B=(2+2+3+2)=9, C=(1+1+2+3)=7
    // C has lowest Borda (7) so C gets eliminated

    console.log('📝 Submitting 4 strategically crafted votes...')
    
    for (let i = 0; i < votes.length; i++) {
      const { error: voteError } = await supabase
        .from('votes')
        .insert({
          poll_id: poll.id,
          vote_type: 'ranked_choice',
          ranked_choices: votes[i],
          created_at: new Date(Date.now() - 23 * 60 * 60 * 1000 + i * 60 * 1000).toISOString()
        })

      if (voteError) throw voteError
    }

    await supabase.from('polls').update({ is_closed: true }).eq('id', poll.id)
    
    console.log('🔄 Running algorithm...')
    
    const { data: result, error: rcError } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id })

    if (rcError) throw rcError

    console.log(`🏆 Winner: ${result[0].winner}, Rounds: ${result[0].total_rounds}`)

    // Check for tie-breaking
    const { data: rounds } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .order('round_number')
      .order('borda_score', { ascending: false, nullsLast: true })

    console.log('\n📊 EXPECTED RESULTS:')
    console.log('Round 1: A=2, B=1, C=1 → B&C tied for elimination')
    console.log('Borda: A=8, B=9, C=7 → C eliminated (lowest Borda)')
    console.log('This should trigger tie-breaking explanation in the UI!')

    const tieBreakerRounds = rounds.filter(r => r.tie_broken_by_borda === true)
    if (tieBreakerRounds.length > 0) {
      console.log('\n🎯 SUCCESS! TIE-BREAKING OCCURRED!')
      const roundNum = tieBreakerRounds[0].round_number
      console.log(`Round ${roundNum} Borda Scores:`)
      
      tieBreakerRounds
        .filter(r => r.round_number === roundNum)
        .sort((a, b) => (b.borda_score || 0) - (a.borda_score || 0))
        .forEach(r => {
          const status = r.is_eliminated ? 'ELIMINATED' : 'SURVIVED'
          console.log(`  ${r.option_name}: ${r.borda_score} Borda → ${status}`)
        })
    }

    const pollUrl = `http://decisionbot.a.pinggy.link/poll?id=${poll.id}`
    console.log(`\n🌐 PERFECT DEMO URL: ${pollUrl}`)
    console.log(`📝 Poll ID: ${poll.id}`)
    console.log(`🎯 This poll should show Borda count explanation UI!`)
    
    return poll.id

  } catch (error) {
    console.error('❌ Error:', error.message)
    throw error
  }
}

createPerfectTieDemo()