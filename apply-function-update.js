import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function applyFunctionUpdate() {
  console.log('🔄 Applying function update...')
  
  // Read the migration file
  const migration = fs.readFileSync('database/migrations/020_add_borda_scores_to_rounds_up.sql', 'utf8')
  
  // Extract just the function part (everything after the ALTER TABLE statements)
  const functionStart = migration.indexOf('CREATE OR REPLACE FUNCTION')
  if (functionStart === -1) {
    console.error('❌ Function definition not found in migration')
    return
  }
  
  const functionSql = migration.substring(functionStart)
  
  console.log('📝 Executing function update...')
  
  try {
    const { error } = await supabase.rpc('exec_sql', { sql: functionSql })
    
    if (error) {
      console.error('❌ Error executing function:', error)
      
      // Try direct execution instead
      console.log('🔄 Trying direct execution...')
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey
        },
        body: JSON.stringify({ query: functionSql })
      })
      
      const result = await response.text()
      console.log('Response:', result)
    } else {
      console.log('✅ Function updated successfully!')
    }
  } catch (err) {
    console.error('❌ Error:', err.message)
    
    // Let's just run the specific problematic parts manually
    console.log('🔄 Manually executing the CREATE FUNCTION statement...')
    
    // Split the function by lines and execute the CREATE OR REPLACE FUNCTION part
    const lines = functionSql.split('\n')
    const functionLines = []
    let inFunction = false
    
    for (const line of lines) {
      if (line.includes('CREATE OR REPLACE FUNCTION')) {
        inFunction = true
      }
      if (inFunction) {
        functionLines.push(line)
      }
      if (line.includes('$$ LANGUAGE plpgsql;')) {
        break
      }
    }
    
    const cleanFunction = functionLines.join('\n').trim()
    console.log('Function to execute:\n', cleanFunction.substring(0, 200) + '...')
    
    // We'll need to execute this through the Management API instead
  }
}

applyFunctionUpdate()