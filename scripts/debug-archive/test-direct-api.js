import { createClient } from '@supabase/supabase-js';

async function testDirectAPI() {
  console.log('🧪 Testing Direct Supabase API Calls');
  console.log('=' .repeat(50));
  
  // Test both production and test database configurations
  const configs = [
    {
      name: 'PRODUCTION DATABASE',
      url: 'https://kifnvombihyfwszuwqvy.supabase.co',
      key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpZm52b21iaWh5ZndzenV3cXZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA0NDkwNTUsImV4cCI6MjA2NjAyNTA1NX0.z8v81nd0LDaPu8h_M0-e3sEMudu8fIAjALg2P5v81uk'
    },
    {
      name: 'TEST DATABASE',
      url: 'https://kfngceqepnzlljkwedtd.supabase.co',
      key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbmdjZXFlcG56bGxqa3dlZHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MzAzOTIsImV4cCI6MjA2NjEwNjM5Mn0.MVcf7jfyRC5bAge9K0axNGFxoeEnwxetFluC0G4Y3As'
    }
  ];
  
  for (const config of configs) {
    console.log(`\n📊 Testing ${config.name}`);
    console.log('-'.repeat(30));
    
    try {
      const supabase = createClient(config.url, config.key);
      
      console.log(`   URL: ${config.url}`);
      console.log(`   Key: ${config.key.substring(0, 20)}...`);
      
      // Test the exact same query that the homepage uses
      const { data, error } = await supabase
        .from("polls")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      
      console.log(`   Error: ${error ? JSON.stringify(error) : 'null'}`);
      console.log(`   Data type: ${typeof data}`);
      console.log(`   Data length: ${Array.isArray(data) ? data.length : 'not array'}`);
      
      if (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        console.log(`   Error details: ${JSON.stringify(error, null, 2)}`);
      } else if (Array.isArray(data)) {
        console.log(`   ✅ SUCCESS: Retrieved ${data.length} polls`);
        
        if (data.length > 0) {
          console.log(`   First poll preview:`);
          console.log(`     ID: ${data[0].id}`);
          console.log(`     Title: ${data[0].title}`);
          console.log(`     Type: ${data[0].poll_type}`);
          console.log(`     Deadline: ${data[0].response_deadline}`);
          console.log(`     Closed: ${data[0].is_closed}`);
          
          // Test the filtering logic that homepage uses
          const now = new Date();
          const openPolls = data.filter(poll => {
            if (!poll.response_deadline) return false;
            return new Date(poll.response_deadline) > now && !poll.is_closed;
          });
          
          const closedPolls = data.filter(poll => {
            if (!poll.response_deadline) return true;
            return new Date(poll.response_deadline) <= now || poll.is_closed;
          });
          
          console.log(`   📈 Filtering results:`);
          console.log(`     Open polls: ${openPolls.length}`);
          console.log(`     Closed polls: ${closedPolls.length}`);
          
          if (openPolls.length > 0) {
            console.log(`     Open poll example: "${openPolls[0].title}"`);
          }
          if (closedPolls.length > 0) {
            console.log(`     Closed poll example: "${closedPolls[0].title}"`);
          }
        }
      } else {
        console.log(`   ⚠️  UNEXPECTED: Data is not an array`);
        console.log(`   Data: ${JSON.stringify(data)}`);
      }
      
    } catch (error) {
      console.log(`   ❌ EXCEPTION: ${error.message}`);
      console.log(`   Stack: ${error.stack}`);
    }
  }
  
  // Test environment variable logic
  console.log(`\n🔧 ENVIRONMENT VARIABLE SIMULATION`);
  console.log('-'.repeat(30));
  
  const nodeEnvProduction = 'production';
  const nodeEnvDevelopment = 'development';
  
  console.log(`When NODE_ENV='production':`);
  const isProduction = nodeEnvProduction === 'production';
  const prodUrl = isProduction ? 'https://kifnvombihyfwszuwqvy.supabase.co' : 'https://kfngceqepnzlljkwedtd.supabase.co';
  console.log(`   isProduction: ${isProduction}`);
  console.log(`   Selected URL: ${prodUrl}`);
  
  console.log(`When NODE_ENV='development':`);
  const isDevelopment = nodeEnvDevelopment === 'production';
  const devUrl = isDevelopment ? 'https://kifnvombihyfwszuwqvy.supabase.co' : 'https://kfngceqepnzlljkwedtd.supabase.co';
  console.log(`   isProduction: ${isDevelopment}`);
  console.log(`   Selected URL: ${devUrl}`);
}

testDirectAPI().then(() => {
  console.log('\n🏁 Direct API test complete');
}).catch(error => {
  console.error('Test failed:', error);
});