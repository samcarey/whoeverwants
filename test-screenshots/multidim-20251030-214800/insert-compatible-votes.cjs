#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/sccarey/projects/whoeverwants/.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_TEST;
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const pollId = 'ef1f39ce-6925-4655-961b-ab4253b176e3';

// Calculate dates
const today = new Date();
today.setHours(0, 0, 0, 0);
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);
const dayAfter = new Date(today);
dayAfter.setDate(dayAfter.getDate() + 2);
const day3 = new Date(today);
day3.setDate(day3.getDate() + 3);
const day4 = new Date(today);
day4.setDate(day4.getDate() + 4);

// 5 voters with COMPATIBLE constraints
// Group 1: Alice, Diana, Eric (all can work with 3-4 participants, overlapping days/times/durations)
// Bob and Carol have incompatible constraints and won't participate
const votes = [
  {
    poll_id: pollId,
    vote_type: 'participation',
    yes_no_choice: 'yes',
    is_abstain: false,
    voter_name: 'Alice Smith',
    min_participants: 3,
    max_participants: 5,
    voter_days: [today.toISOString().split('T')[0], tomorrow.toISOString().split('T')[0]],
    voter_time: { minValue: '08:00', maxValue: '12:00', minEnabled: true, maxEnabled: true },
    voter_duration: { minValue: 0.5, maxValue: 1.5, minEnabled: true, maxEnabled: true }
  },
  {
    poll_id: pollId,
    vote_type: 'participation',
    yes_no_choice: 'yes',
    is_abstain: false,
    voter_name: 'Bob Johnson',
    min_participants: 3,
    max_participants: null,
    voter_days: [today.toISOString().split('T')[0], tomorrow.toISOString().split('T')[0]],
    voter_time: { minValue: '11:00', maxValue: '15:00', minEnabled: true, maxEnabled: true },
    voter_duration: { minValue: 1, maxValue: 2, minEnabled: true, maxEnabled: true }
  },
  {
    poll_id: pollId,
    vote_type: 'participation',
    yes_no_choice: 'yes',
    is_abstain: false,
    voter_name: 'Carol Williams',
    min_participants: 3,
    max_participants: 4,
    voter_days: [dayAfter.toISOString().split('T')[0], day3.toISOString().split('T')[0]],
    voter_time: { minValue: '16:00', maxValue: '20:00', minEnabled: true, maxEnabled: true },
    voter_duration: { minValue: 1.5, maxValue: 2.5, minEnabled: true, maxEnabled: true }
  },
  {
    poll_id: pollId,
    vote_type: 'participation',
    yes_no_choice: 'yes',
    is_abstain: false,
    voter_name: 'Diana Martinez',
    min_participants: 3,
    max_participants: 5,
    voter_days: [today.toISOString().split('T')[0], tomorrow.toISOString().split('T')[0]],
    voter_time: { minValue: '09:00', maxValue: '13:00', minEnabled: true, maxEnabled: true },
    voter_duration: { minValue: 1, maxValue: 2, minEnabled: true, maxEnabled: true }
  },
  {
    poll_id: pollId,
    vote_type: 'participation',
    yes_no_choice: 'yes',
    is_abstain: false,
    voter_name: 'Eric Thompson',
    min_participants: 3,
    max_participants: 6,
    voter_days: [today.toISOString().split('T')[0], tomorrow.toISOString().split('T')[0]],
    voter_time: { minValue: '10:00', maxValue: '14:00', minEnabled: true, maxEnabled: true },
    voter_duration: { minValue: 1, maxValue: 2, minEnabled: true, maxEnabled: true }
  }
];

async function insertCompatibleVotes() {
  // Delete all existing votes
  console.log('🗑️  Deleting existing votes...');
  const { error: deleteError } = await supabase
    .from('votes')
    .delete()
    .eq('poll_id', pollId);

  if (deleteError) {
    console.error('Error deleting:', deleteError);
    return;
  }

  console.log('✓ Deleted all existing votes\n');
  console.log('📝 Inserting 5 voters with COMPATIBLE constraints...\n');
  console.log('Expected outcome: Bob, Alice, Diana, Eric participate (4 voters)\n');
  console.log('  - All have days Today/Tomorrow in common ✓');
  console.log('  - Times overlap: 11:00-12:00 window ✓');
  console.log('  - Durations overlap: 1-1.5h range ✓');
  console.log('  - All satisfied with 4 participants ✓\n');
  console.log('Carol excluded:');
  console.log('  - Carol: Different days (Day+2, Day+3) + different times (16:00-20:00)\n');

  // Insert new votes
  for (const vote of votes) {
    const { error } = await supabase
      .from('votes')
      .insert(vote);

    if (error) {
      console.error(`❌ Error inserting ${vote.voter_name}:`, error.message);
    } else {
      console.log(`✓ ${vote.voter_name}`);
    }
  }

  console.log('\n✅ Done! 5 voters inserted with compatible constraints');
  console.log(`\n🔗 http://localhost:3000/p/${pollId}/`);
}

insertCompatibleVotes();
