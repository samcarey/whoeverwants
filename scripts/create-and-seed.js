#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.test' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_TEST_URL;
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing environment variables in .env.test');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

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

async function createTableViaSupabaseAPI() {
  console.log('🔧 Creating table via Supabase REST API...');
  
  // Try inserting a test record to see if table exists
  const testPoll = { title: 'Test poll - will be deleted' };
  const { data: testData, error: testError } = await supabase
    .from('polls')
    .insert([testPoll])
    .select();
  
  if (!testError) {
    console.log('✅ Table already exists! Cleaning up test record...');
    // Delete the test record
    await supabase.from('polls').delete().eq('title', 'Test poll - will be deleted');
    return true;
  }
  
  if (testError) {
    // Any error likely means table doesn't exist
    console.log('❌ Table does not exist. We need to create it manually.');
    console.log('\n📋 Please run this SQL in your Supabase dashboard:');
    console.log('🔗 Go to: https://supabase.com/dashboard/project/kfngceqepnzlljkwedtd/sql');
    console.log('\n' + '='.repeat(60));
    console.log(`
CREATE TABLE IF NOT EXISTS polls (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_polls_updated_at 
  BEFORE UPDATE ON polls 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE polls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on polls" ON polls
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert access on polls" ON polls
  FOR INSERT WITH CHECK (true);
    `);
    console.log('='.repeat(60));
    console.log('\n🔄 After running the SQL, run this script again!');
    return false;
  }
}

async function seedData(count = 5000) {
  console.log(`🌱 Seeding ${count} test polls...`);
  
  try {
    const batchSize = 1000;
    let totalInserted = 0;
    
    for (let i = 0; i < count; i += batchSize) {
      const currentBatch = Math.min(batchSize, count - i);
      const testPolls = generateFakePolls(currentBatch);
      
      console.log(`📦 Inserting batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(count/batchSize)} (${currentBatch} records)...`);
      
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
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    console.log(`\n🎉 Successfully seeded ${totalInserted} test polls!`);
    return totalInserted;
    
  } catch (error) {
    console.error('❌ Seeding error:', error.message);
    throw error;
  }
}

async function main() {
  console.log('🚀 Creating table and seeding test database...');
  console.log(`📍 Database URL: ${supabaseUrl}`);
  
  const tableExists = await createTableViaSupabaseAPI();
  
  if (tableExists) {
    await seedData(5000);
    
    // Verify final count
    const { count, error } = await supabase
      .from('polls')
      .select('*', { count: 'exact', head: true });
    
    if (!error) {
      console.log(`\n📊 Total polls in database: ${count}`);
    }
    
    console.log('\n✨ All done! Your test database is ready with 5000 polls.');
  }
}

main().catch(error => {
  console.error('\n💥 Failed:', error.message);
  process.exit(1);
});