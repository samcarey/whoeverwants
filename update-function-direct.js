import fs from 'fs'
import https from 'https'
import dotenv from 'dotenv'

dotenv.config()

// Extract project reference from URL
const testUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const projectRef = testUrl.replace('https://', '').replace('.supabase.co', '')
const accessToken = process.env.SUPABASE_ACCESS_TOKEN

console.log(`🔧 Updating function for project: ${projectRef}`)

// Read the migration file and extract the function
const migration = fs.readFileSync('database/migrations/020_add_borda_scores_to_rounds_up.sql', 'utf8')
const functionStart = migration.indexOf('CREATE OR REPLACE FUNCTION')
const functionSql = migration.substring(functionStart)

console.log('📝 Function to update:', functionSql.substring(0, 100) + '...')

const postData = JSON.stringify({
  query: functionSql
})

const options = {
  hostname: 'api.supabase.com',
  port: 443,
  path: `/v1/projects/${projectRef}/database/query`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    'Content-Length': Buffer.byteLength(postData)
  }
}

const req = https.request(options, (res) => {
  let data = ''
  
  res.on('data', (chunk) => {
    data += chunk
  })
  
  res.on('end', () => {
    console.log(`📡 Response status: ${res.statusCode}`)
    console.log('📋 Response:', data)
    
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('✅ Function updated successfully!')
      console.log('🔄 Now testing with the tie-breaking poll...')
      
      // Re-run the algorithm on our test poll
      import('./test-updated-function.js')
    } else {
      console.error('❌ Failed to update function')
    }
  })
})

req.on('error', (error) => {
  console.error('❌ Request error:', error)
})

req.write(postData)
req.end()