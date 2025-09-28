#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkError() {
  try {
    // Try to insert a vote with a non-existent poll_id to see the exact error
    const testVote = {
      id: require('crypto').randomUUID(),
      poll_id: '00000000-0000-0000-0000-000000000000', // Non-existent poll
      vote_type: 'ranked_choice',
      ranked_choices: ['A', 'B', 'C']
    };
    
    console.log('Testing foreign key constraint...');
    const { data, error } = await supabase
      .from('votes')
      .insert([testVote])
      .select()
      .single();
    
    if (error) {
      console.log('Error details:', error);
      if (error.code === '23503') {
        console.log('Foreign key constraint details:', error.details);
        console.log('This means votes table requires poll_id to exist in polls table');
      }
    } else {
      console.log('Unexpected success - vote created without valid poll');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkError();
