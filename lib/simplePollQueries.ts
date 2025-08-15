// Simple poll queries using browser storage for access control
// No fingerprinting, no complex RLS - just localStorage poll lists

import { supabase, Poll } from '@/lib/supabase';
import { getAccessiblePollIds, addAccessiblePollId } from '@/lib/browserPollAccess';

// Get polls this browser has access to
export async function getAccessiblePolls(): Promise<Poll[]> {
  try {
    const accessibleIds = getAccessiblePollIds();
    
    if (accessibleIds.length === 0) {
      return [];
    }

    // Query only polls this browser has access to
    const { data, error } = await supabase
      .from('polls')
      .select('*')
      .in('id', accessibleIds)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching accessible polls:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getAccessiblePolls:', error);
    return [];
  }
}

// Get a specific poll by ID and grant access if found
export async function getPollWithAccess(pollId: string): Promise<Poll | null> {
  try {
    // Try to find the poll by ID
    const { data, error } = await supabase
      .from('polls')
      .select('*')
      .eq('id', pollId)
      .single();

    if (error || !data) {
      console.log('Poll not found:', pollId);
      return null;
    }

    // Grant access to this poll by adding to browser storage
    addAccessiblePollId(data.id);

    return data;
  } catch (error) {
    console.error('Error in getPollWithAccess:', error);
    return null;
  }
}

// Record that this browser created a poll (grants full access)
export async function recordPollCreation(pollId: string): Promise<void> {
  try {
    // Add to accessible polls list
    addAccessiblePollId(pollId);
    console.log('Recorded poll creation for browser:', pollId.substring(0, 8) + '...');
  } catch (error) {
    console.error('Error recording poll creation:', error);
  }
}

// Check if a poll exists (without granting access)
export async function pollExists(pollId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('polls')
      .select('id')
      .eq('id', pollId)
      .single();

    return !error && !!data;
  } catch (error) {
    return false;
  }
}