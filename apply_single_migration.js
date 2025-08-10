// Apply a single migration using Node.js and Supabase client
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function applySingleMigration(migrationFile) {
  try {
    console.log(`🔄 Applying migration: ${migrationFile}`);
    
    // Read migration file
    const sql = fs.readFileSync(migrationFile, 'utf8');
    
    // Execute SQL using Supabase client
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      // If exec_sql doesn't exist, try direct SQL execution
      console.log('Trying direct SQL execution...');
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL_TEST}/rest/v1/rpc/exec`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SUPABASE_TEST_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_TEST_SERVICE_KEY
        },
        body: JSON.stringify({ query: sql })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
    }
    
    console.log(`✅ Migration applied successfully`);
    
  } catch (error) {
    console.error(`❌ Migration failed:`, error.message);
    throw error;
  }
}

// Apply the bug fix migration
if (process.argv[2]) {
  applySingleMigration(process.argv[2]);
} else {
  console.log('Usage: node apply_single_migration.js <migration_file>');
}