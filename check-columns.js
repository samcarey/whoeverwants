import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkColumns() {
  console.log('🔍 Checking ranked_choice_rounds table structure...')
  
  const { data, error } = await supabase
    .from('ranked_choice_rounds')
    .select('*')
    .limit(1)
  
  if (error) {
    console.error('❌ Error:', error)
    return
  }
  
  if (data && data.length > 0) {
    console.log('✅ Available columns:', Object.keys(data[0]))
    console.log('📋 Sample row:', data[0])
  } else {
    console.log('⚠️ No data found in table')
  }

  // Try to select the new columns specifically
  const { data: testCols, error: colError } = await supabase
    .from('ranked_choice_rounds')
    .select('borda_score, tie_broken_by_borda')
    .limit(1)
  
  if (colError) {
    console.error('❌ New columns not found:', colError.message)
  } else {
    console.log('✅ New columns accessible:', testCols)
  }
}

checkColumns()