import { config } from 'dotenv'
import '@testing-library/jest-dom'
import { vi } from 'vitest'

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

// Mock Next.js router for tests
const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  route: '/',
  pathname: '/',
  query: {},
  asPath: '/',
}

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(),
}))

// Mock window methods that aren't available in jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

console.log('🧪 Test environment initialized')
console.log(`📊 Testing against: ${process.env.NEXT_PUBLIC_SUPABASE_URL_TEST}`)