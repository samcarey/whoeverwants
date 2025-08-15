// Test the safe_set_config RPC function
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST;

async function testRPCFunction() {
  console.log('🧪 Testing safe_set_config RPC Function');
  console.log('========================================');
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  try {
    // Test 1: Call safe_set_config function
    console.log('\n🔧 Test 1: Testing safe_set_config...');
    const { data, error } = await supabase.rpc('safe_set_config', {
      setting_name: 'app.current_client_fingerprint',
      new_value: 'test123456789',
      is_local: true
    });
    
    if (error) {
      console.log('❌ safe_set_config error:', error);
    } else {
      console.log('✅ safe_set_config success:', data);
    }
    
    // Test 2: Check if the setting was applied
    console.log('\n🔍 Test 2: Checking current_setting...');
    const { data: currentValue, error: currentError } = await supabase
      .rpc('current_setting', { setting_name: 'app.current_client_fingerprint' });
    
    if (currentError) {
      console.log('❌ current_setting error:', currentError);
    } else {
      console.log('✅ Current setting value:', currentValue);
    }
    
    // Test 3: Try to insert into poll_access
    console.log('\n📝 Test 3: Testing poll_access insert...');
    const testPollId = 'test-poll-' + Math.random().toString(36).substr(2, 9);
    
    const { data: insertData, error: insertError } = await supabase
      .from('poll_access')
      .insert({
        poll_id: testPollId,
        client_fingerprint: 'test123456789',
        access_type: 'creator'
      });
    
    if (insertError) {
      console.log('❌ poll_access insert error:', insertError);
    } else {
      console.log('✅ poll_access insert success:', insertData);
      
      // Cleanup
      await supabase.from('poll_access').delete().eq('poll_id', testPollId);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
  
  console.log('\n🎉 RPC Function Test Complete!');
}

testRPCFunction();