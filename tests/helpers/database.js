import { createClient } from '@supabase/supabase-js'

let supabaseClient = null

export function getTestDatabase() {
  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
      process.env.SUPABASE_TEST_SERVICE_KEY
    )
  }
  return supabaseClient
}

export async function cleanupTestPolls() {
  const db = getTestDatabase()
  
  // Clean up any test polls that might be left over
  const { error } = await db
    .from('polls')
    .delete()
    .like('title', '%Test%')
  
  if (error && !error.message.includes('No rows found')) {
    console.warn('Cleanup warning:', error.message)
  }
}

export async function ensureMigrationsApplied() {
  const db = getTestDatabase()
  
  // Check if our latest migration is applied by testing the fixed function
  try {
    const { data, error } = await db.rpc('calculate_ranked_choice_winner', {
      target_poll_id: '00000000-0000-0000-0000-000000000000'
    })
    
    if (error && !error.message.includes('null')) {
      throw new Error(`Database not ready: ${error.message}`)
    }
  } catch (err) {
    throw new Error(`Test database not properly migrated: ${err.message}`)
  }
}