#!/usr/bin/env node

const fetch = require('node-fetch');
require('dotenv').config({ path: '.env.test' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_TEST_URL;
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY;

async function executeSQL(sql) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'apikey': supabaseKey
    },
    body: JSON.stringify({ sql })
  });
  
  return response;
}

async function createTableDirect() {
  console.log('🔧 Creating polls table via REST API...');
  
  const sql = `
    -- Create polls table
    CREATE TABLE IF NOT EXISTS polls (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    
    -- Create updated_at trigger function
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
    
    -- Create trigger
    DROP TRIGGER IF EXISTS update_polls_updated_at ON polls;
    CREATE TRIGGER update_polls_updated_at 
      BEFORE UPDATE ON polls 
      FOR EACH ROW 
      EXECUTE FUNCTION update_updated_at_column();
    
    -- Enable RLS
    ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
    
    -- Create policies
    DROP POLICY IF EXISTS "Allow public read access on polls" ON polls;
    CREATE POLICY "Allow public read access on polls" ON polls
      FOR SELECT USING (true);
    
    DROP POLICY IF EXISTS "Allow public insert access on polls" ON polls;
    CREATE POLICY "Allow public insert access on polls" ON polls
      FOR INSERT WITH CHECK (true);
  `;
  
  try {
    const response = await executeSQL(sql);
    console.log('Response status:', response.status);
    
    if (response.ok) {
      console.log('✅ Table created successfully via REST API!');
      return true;
    } else {
      const errorText = await response.text();
      console.log('❌ REST API failed:', errorText);
      return false;
    }
  } catch (error) {
    console.log('❌ Direct API call failed:', error.message);
    return false;
  }
}

createTableDirect().then(success => {
  if (!success) {
    console.log('\n🤔 The issue is that Supabase doesn\'t expose a general SQL execution endpoint for security reasons.');
    console.log('📋 You need to run the SQL manually in the Supabase Dashboard:');
    console.log('🔗 Go to: https://supabase.com/dashboard/project/kfngceqepnzlljkwedtd/sql');
    console.log('\n📝 This is a one-time setup. After this, our scripts will work perfectly!');
  }
});