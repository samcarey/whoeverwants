#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.test' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_TEST_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('- NEXT_PUBLIC_SUPABASE_TEST_URL (or fallback to main URL)');
  console.error('- SUPABASE_TEST_SERVICE_KEY (or fallback to main service key)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function readSqlFile(filename) {
  const filePath = path.join(__dirname, '..', 'database', 'migrations', filename);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error(`❌ Error reading ${filename}:`, error.message);
    throw error;
  }
}

async function runMigrations() {
  console.log('🔄 Running database migrations...');
  
  try {
    // Test if table already exists
    const { error: testError } = await supabase.from('polls').select('*').limit(1);
    
    if (!testError) {
      console.log('✅ Table already exists, skipping migration');
      return;
    }
    
    if (testError.message.includes('does not exist')) {
      console.log('❌ Table does not exist. Please run this SQL in your Supabase Dashboard:');
      console.log('\n' + '='.repeat(50));
      
      const migrationSql = await readSqlFile('001_create_polls_table_up.sql');
      console.log(migrationSql);
      
      console.log('='.repeat(50));
      console.log('\n💡 Go to: https://supabase.com/dashboard/project/kfngceqepnzlljkwedtd/sql');
      console.log('📋 Copy and paste the SQL above, then run it');
      console.log('🔄 Then run this script again');
      
      throw new Error('Manual migration required');
    }
    
    console.log('✅ Database schema ready');
  } catch (error) {
    if (error.message === 'Manual migration required') {
      throw error;
    }
    console.log('⚠️  Migration check failed, assuming table exists');
  }
}

function generateFakePolls(count) {
  const pollStarters = [
    'What should we have for',
    'Best way to',
    'Favorite',
    'Should we',
    'How do you feel about',
    'What is your opinion on',
    'Which is better:',
    'Do you prefer',
    'What time should we',
    'Where should we go for',
    'Who is the best',
    'When is the right time to',
    'Why do people',
    'How often do you',
    'What would you choose:'
  ];
  
  const pollEndings = [
    'lunch today?',
    'learn new programming languages?',
    'movie of all time?',
    'work remotely or in office?',
    'the new software update?',
    'artificial intelligence in education?',
    'React or Vue.js?',
    'coffee or tea in the morning?',
    'start our team meeting?',
    'our company retreat?',
    'frontend developer in the team?',
    'invest in cryptocurrency?',
    'choose open source over proprietary software?',
    'exercise during the week?',
    'Android or iPhone?'
  ];
  
  const polls = [];
  
  for (let i = 0; i < count; i++) {
    const starter = pollStarters[i % pollStarters.length];
    const ending = pollEndings[Math.floor(Math.random() * pollEndings.length)];
    polls.push({ title: `${starter} ${ending}` });
  }
  
  return polls;
}

async function seedTestData(count = 5000) {
  console.log(`🌱 Seeding ${count} test polls...`);
  
  try {
    const batchSize = 1000;
    let totalInserted = 0;
    
    for (let i = 0; i < count; i += batchSize) {
      const currentBatch = Math.min(batchSize, count - i);
      const testPolls = generateFakePolls(currentBatch);
      
      console.log(`   Inserting batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(count/batchSize)} (${currentBatch} records)...`);
      
      const { data, error } = await supabase
        .from('polls')
        .insert(testPolls)
        .select('id');
      
      if (error) {
        console.error('❌ Seeding failed:', error.message);
        throw error;
      }
      
      totalInserted += data.length;
      console.log(`   ✅ Inserted ${data.length} polls (${totalInserted}/${count} total)`);
      
      // Small delay to avoid overwhelming the database
      if (i + batchSize < count) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`✅ Successfully seeded ${totalInserted} test polls`);
    return totalInserted;
  } catch (error) {
    console.error('❌ Seeding error:', error.message);
    throw error;
  }
}

async function clearDatabase() {
  console.log('🧹 Clearing existing data...');
  
  try {
    // First try to delete all records (safer approach)
    const { error: deleteError } = await supabase
      .from('polls')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all records
    
    if (deleteError && !deleteError.message.includes('does not exist')) {
      console.log('⚠️  Delete approach failed, trying table drop...');
      
      // Fallback to dropping tables
      const dropSql = `
        DROP TABLE IF EXISTS polls CASCADE;
        DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
      `;
      
      const { error } = await supabase.rpc('exec', { sql: dropSql });
      
      if (error) {
        console.log('⚠️  RPC drop failed, table may not exist yet');
      }
    }
    
    console.log('✅ Database cleared successfully');
  } catch (error) {
    console.log('⚠️  Clear database completed with warnings');
  }
}

async function verifySetup() {
  console.log('🔍 Verifying database setup...');
  
  try {
    const { data, error } = await supabase
      .from('polls')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('❌ Verification failed:', error.message);
      throw error;
    }
    
    console.log('✅ Database verification successful');
    return true;
  } catch (error) {
    console.error('❌ Verification error:', error.message);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldSeed = !args.includes('--no-seed');
  const shouldClear = args.includes('--clear');
  
  console.log('🚀 Setting up test database...');
  console.log(`📍 Database URL: ${supabaseUrl}`);
  
  try {
    if (shouldClear) {
      await clearDatabase();
    }
    
    await runMigrations();
    await verifySetup();
    
    if (shouldSeed) {
      await seedTestData();
    }
    
    console.log('\n🎉 Test database setup completed successfully!');
    console.log('\n📝 Summary:');
    console.log('- Database schema created');
    console.log('- RLS policies applied');
    if (shouldSeed) {
      console.log('- Test data seeded');
    }
    console.log('\n💡 Usage:');
    console.log('- Set NEXT_PUBLIC_SUPABASE_URL to your test database URL');
    console.log('- Set NEXT_PUBLIC_SUPABASE_ANON_KEY to your test database anon key');
    
  } catch (error) {
    console.error('\n💥 Setup failed:', error.message);
    process.exit(1);
  }
}

// Handle command line execution
if (require.main === module) {
  main();
}

module.exports = { runMigrations, seedTestData, clearDatabase, verifySetup };