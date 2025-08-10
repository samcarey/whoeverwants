// Apply the ranked choice bug fix migration
const fs = require('fs');
require('dotenv').config();

async function applyMigration() {
  try {
    console.log('🔄 Applying ranked choice bug fix migration...');
    
    // Read the migration SQL
    const sql = fs.readFileSync('./database/migrations/017_fix_zero_vote_elimination_bug_up.sql', 'utf8');
    
    // Use Supabase Management API
    const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST.replace('https://', '').replace('.supabase.co', '');
    
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: sql })
    });
    
    const result = await response.text();
    console.log('Response:', result);
    
    if (response.ok) {
      console.log('✅ Migration applied successfully!');
      return true;
    } else {
      console.error('❌ Migration failed:', result);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Error applying migration:', error.message);
    return false;
  }
}

applyMigration();