#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTestPoll() {
  try {
    // Create a test poll
    const testPoll = {
      title: 'Test Poll',
      poll_type: 'ranked_choice',
      is_private: false,
      options: ['A', 'B', 'C'],
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'test-' + Date.now()
    };
    
    console.log('Creating test poll...');
    const { data, error } = await supabase
      .from('polls')
      .insert([testPoll])
      .select()
      .single();
    
    if (error) {
      console.log('❌ Error creating poll:', error);
      return;
    }
    
    console.log('✅ Poll created:', data.id);
    
    // Create a test vote
    const testVote = {
      poll_id: data.id,
      vote_type: 'ranked_choice',
      ranked_choices: ['A', 'B']
    };
    
    const { data: voteData, error: voteError } = await supabase
      .from('votes')
      .insert([testVote])
      .select()
      .single();
    
    if (voteError) {
      console.log('❌ Error creating vote:', voteError);
    } else {
      console.log('✅ Vote created');
      
      // Clean up
      await supabase.from('votes').delete().eq('id', voteData.id);
    }
    
    // Clean up poll
    await supabase.from('polls').delete().eq('id', data.id);
    console.log('✅ Cleanup completed');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkTestPoll();
