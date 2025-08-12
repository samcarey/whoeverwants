import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function testUIData() {
  const pollId = 'df36f911-066a-411a-b584-59d959cc7edd'
  
  console.log('🔍 Testing UI data fetching...')
  
  // Test the exact query that the BordaCountExplanation component uses
  console.log('\n📊 Round 1 tie-breaking data:')
  const { data: round1Data, error: round1Error } = await supabase
    .from('ranked_choice_rounds')
    .select('option_name, borda_score, is_eliminated, tie_broken_by_borda')
    .eq('poll_id', pollId)
    .eq('round_number', 1)
    .eq('tie_broken_by_borda', true)
    .order('borda_score', { ascending: false })

  if (round1Error) {
    console.error('❌ Error:', round1Error)
  } else {
    console.log('✅ Found tie-breaking data:', round1Data)
    
    if (round1Data && round1Data.length > 0) {
      const eliminated = round1Data.find(c => c.is_eliminated)
      const survivors = round1Data.filter(c => !c.is_eliminated)
      
      console.log(`📋 Eliminated: ${eliminated?.option_name} (${eliminated?.borda_score} Borda)`)
      console.log(`📋 Survivors: ${survivors.map(s => `${s.option_name} (${s.borda_score} Borda)`).join(', ')}`)
      
      if (eliminated && survivors.length > 0) {
        console.log('✅ UI should display explanation!')
      }
    }
  }

  // Test Round 2 as well
  console.log('\n📊 Round 2 tie-breaking data:')
  const { data: round2Data, error: round2Error } = await supabase
    .from('ranked_choice_rounds')
    .select('option_name, borda_score, is_eliminated, tie_broken_by_borda')
    .eq('poll_id', pollId)
    .eq('round_number', 2)
    .eq('tie_broken_by_borda', true)
    .order('borda_score', { ascending: false })

  if (round2Error) {
    console.error('❌ Error:', round2Error)
  } else {
    console.log('✅ Found tie-breaking data:', round2Data)
    
    if (round2Data && round2Data.length > 0) {
      const eliminated = round2Data.find(c => c.is_eliminated)
      const survivors = round2Data.filter(c => !c.is_eliminated)
      
      console.log(`📋 Eliminated: ${eliminated?.option_name} (${eliminated?.borda_score} Borda)`)
      console.log(`📋 Survivors: ${survivors.map(s => `${s.option_name} (${s.borda_score} Borda)`).join(', ')}`)
      
      if (eliminated && survivors.length > 0) {
        console.log('✅ UI should display explanation!')
      }
    }
  }
}

testUIData()