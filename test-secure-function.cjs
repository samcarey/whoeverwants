// Test the new secure insert function
const { createClient } = require('@supabase/supabase-js');
// Using built-in crypto for UUID generation if needed
require('dotenv').config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_TEST;

async function testSecureFunction() {
  console.log('🧪 Testing Secure Poll Access Function');
  console.log('=======================================');
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  try {
    // Test 1: Create a test poll to get valid UUID
    console.log('\n📝 Test 1: Creating test poll...');
    const testPoll = {
      title: 'Test Poll for Access',
      poll_type: 'yes_no',
      response_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      creator_secret: 'test-secret-123'
    };
    
    const { data: pollData, error: pollError } = await supabase
      .from('polls')
      .insert([testPoll])
      .select();
    
    if (pollError) {
      console.log('❌ Poll creation failed:', pollError);
      return;
    }
    
    const pollId = pollData[0].id;
    console.log('✅ Test poll created with ID:', pollId);
    
    // Test 2: Use secure function to insert access record
    console.log('\n🔒 Test 2: Using secure insert function...');
    const fingerprint = 'testsecure123456789012';
    
    const { data: insertData, error: insertError } = await supabase.rpc('insert_poll_access', {
      p_poll_id: pollId,
      p_client_fingerprint: fingerprint,
      p_access_type: 'creator'
    });
    
    if (insertError) {
      console.log('❌ Secure insert failed:', insertError);
    } else {
      console.log('✅ Secure insert successful');
    }
    
    // Test 3: Check if access record was created
    console.log('\n🔍 Test 3: Checking access record...');
    const { data: accessData, error: accessError } = await supabase.rpc('has_poll_access', {
      p_poll_id: pollId,
      p_client_fingerprint: fingerprint
    });
    
    if (accessError) {
      console.log('❌ Access check failed:', accessError);
    } else {
      console.log('✅ Access check result:', accessData);
    }
    
    // Test 4: Try with viewer access
    console.log('\n👁️ Test 4: Adding viewer access...');
    const viewerFingerprint = 'viewer123456789012345';
    
    const { error: viewerError } = await supabase.rpc('insert_poll_access', {
      p_poll_id: pollId,
      p_client_fingerprint: viewerFingerprint,
      p_access_type: 'viewer'
    });
    
    if (viewerError) {
      console.log('❌ Viewer access insert failed:', viewerError);
    } else {
      console.log('✅ Viewer access inserted successfully');
    }
    
    // Cleanup
    console.log('\n🧹 Cleanup: Removing test data...');
    await supabase.from('polls').delete().eq('id', pollId);
    console.log('✅ Test data cleaned up');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
  
  console.log('\n🎉 Secure Function Test Complete!');
}

testSecureFunction();