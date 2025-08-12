import fs from 'fs'
import https from 'https'
import dotenv from 'dotenv'

dotenv.config()

// Extract project reference from URL
const testUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST
const projectRef = testUrl.replace('https://', '').replace('.supabase.co', '')
const accessToken = process.env.SUPABASE_ACCESS_TOKEN

console.log(`🔧 Applying fixed Borda function for project: ${projectRef}`)

// Read the fixed function
const fixedFunction = fs.readFileSync('fix-borda-function.sql', 'utf8')

console.log('📝 Applying fixed function...')

const postData = JSON.stringify({
  query: fixedFunction
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
      console.log('✅ Fixed function applied successfully!')
    } else {
      console.error('❌ Failed to apply function')
    }
  })
})

req.on('error', (error) => {
  console.error('❌ Request error:', error)
})

req.write(postData)
req.end()