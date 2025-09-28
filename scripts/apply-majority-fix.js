#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');

console.log('🔧 Applying majority calculation fix to database...');

// Read the SQL file
const sql = fs.readFileSync('apply-majority-fix.sql', 'utf8');

// Apply using supabase CLI if available, or curl
try {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error('SUPABASE_ACCESS_TOKEN not set');
  }
  
  // Write SQL to temp file and execute via psql-like method
  fs.writeFileSync('/tmp/fix.sql', sql);
  
  const command = `curl -X POST "https://api.supabase.com/v1/projects/kfngceqepnzlljkwedtd/database/query" \\
    -H "Authorization: Bearer ${token}" \\
    -H "Content-Type: application/json" \\
    -d '{"query": "SELECT 1"}' > /dev/null && echo "Connected to database"`;
  
  console.log('Testing database connection...');
  execSync(command, { stdio: 'inherit' });
  
  console.log('✅ Database connection successful');
  console.log('⚠️  Manual SQL application required - the function is complex');
  console.log('Please apply the SQL manually via Supabase dashboard or other method');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}