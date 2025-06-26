#!/usr/bin/env node
/**
 * Test suite for ranked choice voting against Supabase using JavaScript client.
 * This bypasses PostgreSQL connection issues and uses the REST API.
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://kfngceqepnzlljkwedtd.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbmdjZXFlcG56bGxqa3dlZHRkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA1MzAzOTIsImV4cCI6MjA2NjEwNjM5Mn0.MVcf7jfyRC5bAge9K0axNGFxoeEnwxetFluC0G4Y3As';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Python-equivalent ranked choice calculator for verification
class RankedChoiceCalculator {
    constructor(ballots) {
        this.ballots = ballots;
        this.totalBallots = ballots.length;
        this.majorityThreshold = Math.floor(this.totalBallots / 2) + 1;
    }
    
    calculateWinner() {
        if (this.ballots.length === 0) {
            return { winner: null, totalRounds: 0, roundsData: [] };
        }
        
        let eliminated = new Set();
        let roundsData = [];
        let currentRound = 1;
        
        while (currentRound <= 50) {
            // Count votes for each candidate
            const voteCounts = this.countVotes(eliminated);
            
            const roundInfo = {
                round: currentRound,
                counts: Object.fromEntries(voteCounts),
                eliminated: []
            };
            
            if (voteCounts.size === 0) {
                return { winner: null, totalRounds: currentRound, roundsData: [...roundsData, roundInfo] };
            }
            
            // Check for winner
            const maxVotes = Math.max(...voteCounts.values());
            const candidatesWithMax = [...voteCounts.entries()].filter(([_, v]) => v === maxVotes);
            
            if (maxVotes >= this.majorityThreshold || voteCounts.size === 1) {
                const winner = candidatesWithMax[0][0];
                roundsData.push(roundInfo);
                return { winner, totalRounds: currentRound, roundsData };
            }
            
            // Find candidates to eliminate
            const minVotes = Math.min(...voteCounts.values());
            const toEliminate = [...voteCounts.entries()].filter(([_, v]) => v === minVotes).map(([c, _]) => c);
            
            // Eliminate candidates
            toEliminate.forEach(c => eliminated.add(c));
            roundInfo.eliminated = toEliminate;
            roundsData.push(roundInfo);
            
            currentRound++;
        }
        
        throw new Error('Ranked choice calculation exceeded maximum rounds');
    }
    
    countVotes(eliminated) {
        const counts = new Map();
        
        for (const ballot of this.ballots) {
            // Find first non-eliminated candidate on this ballot
            for (const candidate of ballot) {
                if (!eliminated.has(candidate)) {
                    counts.set(candidate, (counts.get(candidate) || 0) + 1);
                    break;
                }
            }
        }
        
        return counts;
    }
}

class SupabaseTestSuite {
    async createPoll(title, options) {
        const { data, error } = await supabase
            .from('polls')
            .insert([{
                title,
                poll_type: 'ranked_choice',
                options: JSON.stringify(options)
            }])
            .select('id')
            .single();
            
        if (error) throw new Error(`Failed to create poll: ${error.message}`);
        return data.id;
    }
    
    async submitBallot(pollId, rankedChoices) {
        const { error } = await supabase
            .from('votes')
            .insert([{
                poll_id: pollId,
                vote_type: 'ranked_choice',
                ranked_choices: rankedChoices
            }]);
            
        if (error) throw new Error(`Failed to submit ballot: ${error.message}`);
    }
    
    async calculateWinner(pollId) {
        const { data, error } = await supabase
            .rpc('calculate_ranked_choice_winner', { target_poll_id: pollId });
            
        if (error) throw new Error(`Failed to calculate winner: ${error.message}`);
        
        const result = data[0];
        return { winner: result.winner, totalRounds: result.total_rounds };
    }
    
    async getRoundData(pollId) {
        const { data, error } = await supabase
            .from('ranked_choice_rounds')
            .select('round_number, option_name, vote_count, is_eliminated')
            .eq('poll_id', pollId)
            .order('round_number')
            .order('vote_count', { ascending: false });
            
        if (error) throw new Error(`Failed to get round data: ${error.message}`);
        return data;
    }
    
    async cleanup(pollId) {
        // Clean up test data
        await supabase.from('polls').delete().eq('id', pollId);
    }
    
    async testSimpleMajorityWinner() {
        console.log('🧪 Testing simple majority winner...');
        
        const pollId = await this.createPoll('Test_Simple_Majority_JS', ['Alice', 'Bob', 'Charlie']);
        
        const ballots = [
            ['Alice', 'Bob', 'Charlie'],  // Alice voters
            ['Alice', 'Charlie', 'Bob'],
            ['Alice', 'Bob', 'Charlie'],
            ['Bob', 'Alice', 'Charlie'],  // Bob voter
            ['Charlie', 'Bob', 'Alice']   // Charlie voter
        ];
        
        for (const ballot of ballots) {
            await this.submitBallot(pollId, ballot);
        }
        
        // Calculate with database
        const dbResult = await this.calculateWinner(pollId);
        
        // Calculate with JavaScript
        const calculator = new RankedChoiceCalculator(ballots);
        const jsResult = calculator.calculateWinner();
        
        // Verify results match
        const dbMatch = dbResult.winner === 'Alice' && dbResult.totalRounds === 1;
        const jsMatch = jsResult.winner === 'Alice' && jsResult.totalRounds === 1;
        const resultsMatch = dbResult.winner === jsResult.winner && dbResult.totalRounds === jsResult.totalRounds;
        
        console.log(`  DB Result: ${dbResult.winner} in ${dbResult.totalRounds} rounds`);
        console.log(`  JS Result: ${jsResult.winner} in ${jsResult.totalRounds} rounds`);
        console.log(`  ✅ Test ${dbMatch && jsMatch && resultsMatch ? 'PASSED' : 'FAILED'}`);
        
        await this.cleanup(pollId);
        return dbMatch && jsMatch && resultsMatch;
    }
    
    async testEliminationRounds() {
        console.log('🧪 Testing elimination rounds...');
        
        const pollId = await this.createPoll('Test_Elimination_JS', ['Alice', 'Bob', 'Charlie', 'Dave']);
        
        const ballots = [
            ['Alice', 'Bob', 'Charlie', 'Dave'],  // 3 Alice first
            ['Alice', 'Charlie', 'Bob', 'Dave'],
            ['Alice', 'Dave', 'Bob', 'Charlie'],
            ['Bob', 'Alice', 'Charlie', 'Dave'],   // 3 Bob first
            ['Bob', 'Charlie', 'Alice', 'Dave'],
            ['Bob', 'Dave', 'Alice', 'Charlie'],
            ['Charlie', 'Alice', 'Bob', 'Dave'],   // 2 Charlie first
            ['Charlie', 'Bob', 'Alice', 'Dave'],
            ['Dave', 'Alice', 'Bob', 'Charlie']    // 1 Dave first (eliminated first)
        ];
        
        for (const ballot of ballots) {
            await this.submitBallot(pollId, ballot);
        }
        
        // Calculate with both methods
        const dbResult = await this.calculateWinner(pollId);
        const calculator = new RankedChoiceCalculator(ballots);
        const jsResult = calculator.calculateWinner();
        
        const resultsMatch = dbResult.winner === jsResult.winner && dbResult.totalRounds === jsResult.totalRounds;
        
        console.log(`  DB Result: ${dbResult.winner} in ${dbResult.totalRounds} rounds`);
        console.log(`  JS Result: ${jsResult.winner} in ${jsResult.totalRounds} rounds`);
        console.log(`  ✅ Test ${resultsMatch ? 'PASSED' : 'FAILED'}`);
        
        await this.cleanup(pollId);
        return resultsMatch;
    }
    
    async runAllTests() {
        console.log('🗳️  Supabase Ranked Choice Voting Test Suite (JavaScript)');
        console.log('=========================================================');
        
        try {
            const results = [];
            
            results.push(await this.testSimpleMajorityWinner());
            results.push(await this.testEliminationRounds());
            
            const allPassed = results.every(r => r);
            console.log('\n📊 Test Results:');
            console.log(`  ${results.filter(r => r).length}/${results.length} tests passed`);
            console.log(`  Overall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
            
            return allPassed;
            
        } catch (error) {
            console.error('❌ Test suite failed:', error.message);
            return false;
        }
    }
}

// Run the tests
async function main() {
    const testSuite = new SupabaseTestSuite();
    const success = await testSuite.runAllTests();
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main();
}