import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

console.log('🎯 Creating TRUE Borda Tie-Breaking Demo')

async function createTrueBordaDemo() {
  try {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
    
    const { data: poll } = await supabase
      .from('polls')
      .insert({
        title: 'TRUE BORDA: Genuine Score Difference Demo',
        poll_type: 'ranked_choice',
        options: ['Apple', 'Banana', 'Cherry'],
        response_deadline: pastDate.toISOString(),
        created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single()

    console.log(`✅ Poll created: ${poll.id}`)

    // Create scenario where Apple=2, Banana=1, Cherry=1 (tied for elimination)
    // But Banana has HIGHER Borda than Cherry
    const votes = [
      ['Apple', 'Banana', 'Cherry'],     // Apple=3, Banana=2, Cherry=1
      ['Apple', 'Banana', 'Cherry'],     // Apple=3, Banana=2, Cherry=1  
      ['Banana', 'Apple', 'Cherry'],     // Banana=3, Apple=2, Cherry=1
      ['Cherry', 'Banana', 'Apple'],     // Cherry=3, Banana=2, Apple=1
    ]

    // Vote counts: Apple=2, Banana=1, Cherry=1 (Banana & Cherry tied)
    // Borda: Apple=(3+3+2+1)=9, Banana=(2+2+3+2)=9, Cherry=(1+1+1+3)=6
    // Cherry has LOWER Borda (6 vs 9) → Cherry eliminated

    console.log('📝 Submitting 4 strategic votes...')
    
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

    // Manual verification
    console.log('\n🧮 Expected Borda Scores:')
    console.log('Apple: 3+3+2+1 = 9')
    console.log('Banana: 2+2+3+2 = 9') 
    console.log('Cherry: 1+1+1+3 = 6')
    console.log('👉 Cherry should be eliminated (lowest Borda)')

    // Check actual results
    const { data: rounds } = await supabase
      .from('ranked_choice_rounds')
      .select('*')
      .eq('poll_id', poll.id)
      .eq('tie_broken_by_borda', true)

    if (rounds && rounds.length > 0) {
      console.log('\n🎯 ACTUAL TIE-BREAKING RESULTS:')
      rounds
        .sort((a, b) => (b.borda_score || 0) - (a.borda_score || 0))
        .forEach(r => {
          const status = r.is_eliminated ? 'ELIMINATED' : 'SURVIVED'
          console.log(`  ${r.option_name}: ${r.borda_score} Borda → ${status}`)
        })
        
      const eliminated = rounds.find(r => r.is_eliminated)
      const survivors = rounds.filter(r => !r.is_eliminated)
      const maxSurvivorBorda = Math.max(...survivors.map(s => s.borda_score || 0))
      
      if (eliminated && eliminated.borda_score !== maxSurvivorBorda) {
        console.log('✅ This is a TRUE Borda tie-breaker!')
        console.log(`   ${eliminated.option_name} (${eliminated.borda_score}) < survivors (${maxSurvivorBorda})`)
      } else {
        console.log('⚠️  This would be alphabetical tie-breaking')
      }
    }

    const pollUrl = `http://decisionbot.a.pinggy.link/poll?id=${poll.id}`
    console.log(`\n🌐 TRUE BORDA DEMO URL: ${pollUrl}`)
    console.log('🎯 This should show genuine Borda score difference!')
    
    return poll.id

  } catch (error) {
    console.error('❌ Error:', error.message)
    throw error
  }
}

createTrueBordaDemo()