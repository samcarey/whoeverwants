// Test script to verify poll access control implementation
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testPollAccessControl() {
  console.log('🧪 Testing Poll Access Control System');
  console.log('=====================================');
  
  try {
    // Test 1: Try to query all polls without proper context (should fail)
    console.log('\n📋 Test 1: Attempting to query all polls without fingerprint...');
    const { data: allPolls, error: allPollsError } = await supabase
      .from('polls')
      .select('*');
    
    console.log(`Result: ${allPolls?.length || 0} polls returned`);
    if (allPollsError) console.log('Error:', allPollsError.message);

    // Test 2: Set a client fingerprint context
    console.log('\n🔧 Test 2: Setting client fingerprint context...');
    const testFingerprint = 'test123456789abcdef';
    
    const { error: contextError } = await supabase.rpc('safe_set_config', {
      setting_name: 'app.current_client_fingerprint',
      new_value: testFingerprint,
      is_local: true
    });
    
    if (contextError) {
      console.log('Context setting error:', contextError.message);
    } else {
      console.log('✅ Context set successfully');
    }

    // Test 3: Try to query polls with fingerprint (should still return empty)
    console.log('\n📋 Test 3: Querying polls with fingerprint context...');
    const { data: contextPolls, error: contextError2 } = await supabase
      .from('polls')
      .select('*');
    
    console.log(`Result: ${contextPolls?.length || 0} polls returned`);
    if (contextError2) console.log('Error:', contextError2.message);

    // Test 4: Check poll_access table structure
    console.log('\n🏗️ Test 4: Checking poll_access table structure...');
    const { data: pollAccessStructure, error: structureError } = await supabase
      .from('poll_access')
      .select('*')
      .limit(1);
    
    if (structureError) {
      console.log('Structure error:', structureError.message);
    } else {
      console.log('✅ poll_access table accessible');
      console.log('Table columns:', Object.keys(pollAccessStructure[0] || {}));
    }

    // Test 5: Test client fingerprint validation function
    console.log('\n🔐 Test 5: Testing fingerprint validation...');
    const { data: validationResult, error: validationError } = await supabase
      .rpc('is_valid_client_fingerprint', { fingerprint: testFingerprint });
    
    if (validationError) {
      console.log('Validation error:', validationError.message);
    } else {
      console.log(`Fingerprint validation result: ${validationResult}`);
    }

    // Test 6: Check RLS policies are active
    console.log('\n🛡️ Test 6: Checking RLS policy status...');
    const { data: rlsStatus, error: rlsError } = await supabase
      .from('information_schema.tables')
      .select('table_name, row_security')
      .eq('table_name', 'polls');
    
    if (rlsError) {
      console.log('RLS check error:', rlsError.message);
    } else {
      console.log('RLS status for polls table:', rlsStatus);
    }

    console.log('\n🎉 Poll Access Control Test Complete!');
    console.log('=====================================');
    
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
testPollAccessControl();