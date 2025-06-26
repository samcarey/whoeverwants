// Quick test to verify Supabase connection works from JavaScript
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://kfngceqepnzlljkwedtd.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbmdjZXFlcG56bGxqa3dlZHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MzAzOTIsImV4cCI6MjA2NjEwNjM5Mn0.MVcf7jfyRC5bAge9K0axNGFxoeEnwxetFluC0G4Y3As';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testConnection() {
    try {
        console.log('Testing Supabase connection...');
        
        // Test basic query
        const { data, error } = await supabase
            .from('polls')
            .select('id, title')
            .limit(1);
            
        if (error) {
            console.error('Supabase query error:', error);
        } else {
            console.log('Connection successful! Sample poll data:', data);
        }
        
        // Test if we can call the ranked choice function
        const { data: rcData, error: rcError } = await supabase
            .rpc('calculate_ranked_choice_winner', { target_poll_id: '00000000-0000-0000-0000-000000000000' });
            
        if (rcError) {
            console.log('RPC function call failed (expected with dummy ID):', rcError.message);
        } else {
            console.log('RPC function accessible:', rcData);
        }
        
    } catch (err) {
        console.error('Connection failed:', err.message);
    }
}

testConnection();