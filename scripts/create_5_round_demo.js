#!/usr/bin/env node
/**
 * Create the 5-round ranked choice demo scenario
 */

const { createClient } = require('@supabase/supabase-js');

// Use test database for this demo
const supabaseUrl = 'https://kfngceqepnzlljkwedtd.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbmdjZXFlcG56bGxqa3dlZHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MzAzOTIsImV4cCI6MjA2NjEwNjM5Mn0.MVcf7jfyRC5bAge9K0axNGFxoeEnwxetFluC0G4Y3As';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function create5RoundDemo() {
    console.log('🗳️  Creating 5-Round Ranked Choice Demo');
    console.log('=====================================');
    
    try {
        // 1. Create the poll
        console.log('📝 Creating poll...');
        const { data: poll, error: pollError } = await supabase
            .from('polls')
            .insert([{
                title: '5-Round Demo: Best Programming Language',
                poll_type: 'ranked_choice',
                options: JSON.stringify(['Alice', 'Bob', 'Charlie', 'Dave', 'Eve', 'Frank'])
            }])
            .select('id')
            .single();
            
        if (pollError) throw new Error(`Failed to create poll: ${pollError.message}`);
        
        const pollId = poll.id;
        console.log(`✅ Poll created with ID: ${pollId}`);
        
        // 2. Submit the ballots that create 5 rounds
        console.log('🗳️  Submitting 15 ballots...');
        
        const ballots = [
            // Alice supporters (4 total) - should win in final round
            ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank"],    // 1
            ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank"],    // 2
            ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank"],    // 3
            ["Alice", "Charlie", "Dave", "Eve", "Frank", "Bob"],    // 4
            
            // Bob supporters (3 total) - should be runner-up
            ["Bob", "Alice", "Charlie", "Dave", "Eve", "Frank"],    // 5
            ["Bob", "Alice", "Charlie", "Dave", "Eve", "Frank"],    // 6
            ["Bob", "Charlie", "Alice", "Dave", "Eve", "Frank"],    // 7
            
            // Charlie supporters (3 total) - eliminated round 4
            ["Charlie", "Dave", "Alice", "Bob", "Eve", "Frank"],    // 8
            ["Charlie", "Alice", "Bob", "Dave", "Eve", "Frank"],    // 9
            ["Charlie", "Bob", "Alice", "Dave", "Eve", "Frank"],    // 10
            
            // Dave supporters (2 total) - eliminated round 3
            ["Dave", "Eve", "Charlie", "Alice", "Bob", "Frank"],    // 11
            ["Dave", "Charlie", "Eve", "Alice", "Bob", "Frank"],    // 12
            
            // Eve supporters (2 total) - eliminated round 2
            ["Eve", "Frank", "Dave", "Charlie", "Alice", "Bob"],    // 13
            ["Eve", "Dave", "Frank", "Charlie", "Bob", "Alice"],    // 14
            
            // Frank supporter (1 total) - eliminated round 1
            ["Frank", "Eve", "Dave", "Charlie", "Bob", "Alice"]     // 15
        ];
        
        // Submit all ballots
        for (let i = 0; i < ballots.length; i++) {
            const { error } = await supabase
                .from('votes')
                .insert([{
                    poll_id: pollId,
                    vote_type: 'ranked_choice',
                    ranked_choices: ballots[i]
                }]);
                
            if (error) throw new Error(`Failed to submit ballot ${i + 1}: ${error.message}`);
            
            // Show progress
            process.stdout.write(`\r  Ballot ${i + 1}/15 submitted...`);
        }
        console.log('\n✅ All ballots submitted!');
        
        // 3. Calculate the winner to populate rounds table
        console.log('🧮 Calculating winner...');
        const { data: result, error: calcError } = await supabase
            .rpc('calculate_ranked_choice_winner', { target_poll_id: pollId });
            
        if (calcError) throw new Error(`Failed to calculate winner: ${calcError.message}`);
        
        const winner = result[0].winner;
        const totalRounds = result[0].total_rounds;
        
        console.log(`🏆 Winner: ${winner} (${totalRounds} rounds)`);
        
        // 4. Show the results URL
        console.log('\n🌐 Demo URLs:');
        console.log(`   Poll: http://localhost:3000/poll/${pollId}`);
        console.log(`   Results: http://localhost:3000/results/${pollId}`);
        
        // 5. Get round-by-round data for display
        console.log('\n📊 Round-by-round results:');
        const { data: rounds, error: roundsError } = await supabase
            .from('ranked_choice_rounds')
            .select('round_number, option_name, vote_count, is_eliminated')
            .eq('poll_id', pollId)
            .order('round_number')
            .order('vote_count', { ascending: false });
            
        if (roundsError) throw new Error(`Failed to get rounds: ${roundsError.message}`);
        
        // Group by round
        const roundsMap = {};
        rounds.forEach(r => {
            if (!roundsMap[r.round_number]) roundsMap[r.round_number] = [];
            roundsMap[r.round_number].push(r);
        });
        
        Object.keys(roundsMap).forEach(roundNum => {
            console.log(`\nRound ${roundNum}:`);
            roundsMap[roundNum].forEach(r => {
                const eliminated = r.is_eliminated ? ' (ELIMINATED)' : '';
                console.log(`  ${r.option_name}: ${r.vote_count} votes${eliminated}`);
            });
        });
        
        return pollId;
        
    } catch (error) {
        console.error('❌ Demo creation failed:', error.message);
        return null;
    }
}

if (require.main === module) {
    create5RoundDemo();
}