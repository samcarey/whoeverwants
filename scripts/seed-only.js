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

async function main() {
  const count = 5000;
  console.log(`🚀 Seeding ${count} test polls...`);
  
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
    
    // Verify the data
    const { data: countData, error: countError } = await supabase
      .from('polls')
      .select('id', { count: 'exact', head: true });
    
    if (!countError) {
      console.log(`📊 Total polls in database: ${countData}`);
    }
    
  } catch (error) {
    console.error('\n💥 Seeding failed:', error.message);
    process.exit(1);
  }
}

main();