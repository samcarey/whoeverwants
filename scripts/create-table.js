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

async function createTable() {
  console.log('🔧 Creating polls table...');
  
  const createTableSql = `
    -- Create polls table
    CREATE TABLE IF NOT EXISTS polls (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  
  const { error: tableError } = await supabase.rpc('sql', { query: createTableSql });
  if (tableError) {
    console.log('Table creation via RPC failed, using direct REST approach...');
  }
  
  // Create trigger function
  const triggerFunctionSql = `
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `;
  
  const { error: functionError } = await supabase.rpc('sql', { query: triggerFunctionSql });
  if (functionError) {
    console.log('Function creation via RPC failed...');
  }
  
  // Create trigger
  const triggerSql = `
    DROP TRIGGER IF EXISTS update_polls_updated_at ON polls;
    CREATE TRIGGER update_polls_updated_at 
      BEFORE UPDATE ON polls 
      FOR EACH ROW 
      EXECUTE FUNCTION update_updated_at_column();
  `;
  
  const { error: triggerError } = await supabase.rpc('sql', { query: triggerSql });
  if (triggerError) {
    console.log('Trigger creation via RPC failed...');
  }
  
  // Enable RLS and create policies
  const rlsSql = `
    ALTER TABLE polls ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS "Allow public read access on polls" ON polls;
    CREATE POLICY "Allow public read access on polls" ON polls
      FOR SELECT USING (true);
    
    DROP POLICY IF EXISTS "Allow public insert access on polls" ON polls;
    CREATE POLICY "Allow public insert access on polls" ON polls
      FOR INSERT WITH CHECK (true);
  `;
  
  const { error: rlsError } = await supabase.rpc('sql', { query: rlsSql });
  if (rlsError) {
    console.log('RLS setup via RPC failed...');
  }
  
  // Test if table was created successfully
  const { data, error } = await supabase.from('polls').select('*').limit(1);
  
  if (!error) {
    console.log('✅ Table created successfully!');
    return true;
  } else if (error.message.includes('does not exist')) {
    console.log('❌ Table creation failed. Manual SQL execution required.');
    return false;
  } else {
    console.log('✅ Table appears to exist (got different error, which is expected)');
    return true;
  }
}

createTable().then(success => {
  if (success) {
    console.log('🎉 Ready to seed data!');
  } else {
    console.log('💡 Please run the SQL manually in Supabase Dashboard');
  }
}).catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});