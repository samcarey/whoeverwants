#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPolls() {
  try {
    // Try to create a simple test poll with valid UUID
    const testPoll = {
      id: crypto.randomUUID(),
      title: 'Test Poll',
      poll_type: 'ranked_choice',
      options: ['A', 'B', 'C'],
      created_at: new Date().toISOString()
    };
    
    console.log('Attempting to create test poll with UUID:', testPoll.id);
    const { data, error } = await supabase
      .from('polls')
      .insert([testPoll])
      .select()
      .single();
    
    if (error) {
      console.log('❌ Error creating poll:', error.message);
      console.log('Error code:', error.code);
      if (error.code === '42P01') {
        console.log('Table does not exist!');
      } else if (error.code === '42703') {
        console.log('Column does not exist - schema mismatch');
      }
    } else {
      console.log('✅ Test poll created successfully');
      console.log('Poll ID:', data.id);
      
      // Clean up
      const { error: deleteError } = await supabase
        .from('polls')
        .delete()
        .eq('id', data.id);
      
      if (deleteError) {
        console.log('Warning: Could not delete test poll:', deleteError.message);
      } else {
        console.log('✅ Test poll cleaned up');
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkPolls();
