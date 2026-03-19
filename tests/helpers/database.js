// Database helpers - now uses Python API instead of Supabase
// These are stubs for backward compatibility with existing tests.
// Tests should be migrated to use the Python API directly.

export function getTestDatabase() {
  throw new Error('Supabase test database removed. Use Python API for testing.')
}

export async function cleanupTestPolls() {
  // No-op: Supabase removed. Use Python API for test cleanup.
}

export async function ensureMigrationsApplied() {
  // No-op: Migrations are managed on the droplet's Postgres now.
}
