import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

console.log('🎯 Creating FINAL Test Poll for UI')

async function createFinalTestPoll() {
  try {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    
    const { data: poll } = await supabase
      .from('polls')
      .insert({
        title: 'FINAL UI TEST: Borda Count Explanation',
        poll_type: 'ranked_choice',
        options: ['Alice', 'Bob', 'Charlie'],
        response_deadline: pastDate.toISOString(),
        created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single()

    console.log(`✅ Poll created: ${poll.id}`)

    // Simple scenario: Alice=2, Bob=1, Charlie=1 (tie between Bob and Charlie)
    // Different Borda scores: Alice gets ranked higher by some voters
    const votes = [
      ['Alice', 'Bob', 'Charlie'],     // Alice=1st(3), Bob=2nd(2), Charlie=3rd(1)
      ['Alice', 'Charlie', 'Bob'],     // Alice=1st(3), Charlie=2nd(2), Bob=3rd(1)
      ['Bob', 'Alice', 'Charlie'],     // Bob=1st(3), Alice=2nd(2), Charlie=3rd(1)
      ['Charlie', 'Alice', 'Bob'],     // Charlie=1st(3), Alice=2nd(2), Bob=3rd(1)
    ]

    // Vote counts: Alice=2, Bob=1, Charlie=1 
    // Borda: Alice=(3+3+2+2)=10, Bob=(2+1+3+1)=7, Charlie=(1+2+1+3)=7
    // Bob and Charlie tied at 7 Borda -> alphabetical: Bob eliminated

    console.log('📝 Submitting 4 votes...')
    
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

    console.log('🔄 Running algorithm...')
    
    const { data: result } = await supabase
      .rpc('calculate_ranked_choice_winner', { target_poll_id: poll.id })

    console.log(`🏆 Winner: ${result[0].winner}, Rounds: ${result[0].total_rounds}`)

    // Check tie-breaking occurred
    const { data: rounds } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .eq('tie_broken_by_borda', true)

    if (rounds && rounds.length > 0) {
      console.log('🎯 TIE-BREAKING CONFIRMED!')
      rounds.forEach(r => {
        const status = r.is_eliminated ? 'ELIMINATED' : 'SURVIVED'
        console.log(`  ${r.option_name}: ${r.borda_score} Borda → ${status}`)
      })
    }

    const pollUrl = `http://decisionbot.a.pinggy.link/poll?id=${poll.id}`
    console.log(`\n🌐 FINAL UI TEST URL: ${pollUrl}`)
    console.log('🎯 This should show Borda count explanations in the UI!')
    
    return poll.id

  } catch (error) {
    console.error('❌ Error:', error.message)
    throw error
  }
}

createFinalTestPoll()