import { config } from 'dotenv'

// Load environment variables for tests
config()

// Ensure test environment variables are present
if (!process.env.NEXT_PUBLIC_SUPABASE_URL_TEST) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL_TEST is required for tests')
}

if (!process.env.SUPABASE_TEST_SERVICE_KEY) {
  throw new Error('SUPABASE_TEST_SERVICE_KEY is required for tests')
}

// Set test environment
process.env.NODE_ENV = 'test'

console.log('🧪 Test environment initialized')
console.log(`📊 Testing against: ${process.env.NEXT_PUBLIC_SUPABASE_URL_TEST}`)