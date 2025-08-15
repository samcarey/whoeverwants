// Secure database query functions with RLS policy enforcement
// Provides database-level access control for poll data

import { supabase, Poll } from '@/lib/supabase';
import { getClientFingerprint } from '@/lib/clientFingerprint';
import { addPollAccess } from '@/lib/pollAccess';

// Rate limiting storage
const rateLimits = new Map<string, { count: number; resetTime: number }>();

// Set client context for RLS policies
async function setClientContext(fingerprint: string, pollId?: string, shortId?: string): Promise<void> {
  try {
    // Set context variables for RLS policies using Supabase's built-in set_config
    const contextSets = [
      { name: 'app.current_client_fingerprint', value: fingerprint },
      { name: 'app.requested_poll_id', value: pollId || '' },
      { name: 'app.requested_poll_short_id', value: shortId || '' }
    ];

    // Set each context variable
    for (const context of contextSets) {
      const { error } = await supabase.rpc('safe_set_config', {
        setting_name: context.name,
        new_value: context.value,
        is_local: true
      });
      
      if (error) {
        console.error(`Error setting context ${context.name}:`, error);
      }
    }
  } catch (error) {
    console.error('Error setting client context:', error);
  }
}

// Check rate limit for fingerprint and endpoint
function checkRateLimit(fingerprint: string, endpoint: string): boolean {
  const key = `${fingerprint}:${endpoint}`;
  const now = Date.now();
  const limit = rateLimits.get(key) || { count: 0, resetTime: now + 60000 };

  if (now > limit.resetTime) {
    limit.count = 0;
    limit.resetTime = now + 60000;
  }

  limit.count++;
  rateLimits.set(key, limit);

  // Allow 100 requests per minute per endpoint
  return limit.count <= 100;
}

// Record poll access in database
export async function recordPollAccess(pollId: string, accessType: 'creator' | 'viewer'): Promise<void> {
  const fingerprint = getClientFingerprint();
  
  // Rate limit check
  if (!checkRateLimit(fingerprint, 'record_access')) {
    console.warn('Rate limit exceeded for poll access recording');
    return;
  }

  try {
    // Use secure function to insert poll access record
    const { error } = await supabase.rpc('insert_poll_access', {
      p_poll_id: pollId,
      p_client_fingerprint: fingerprint,
      p_access_type: accessType
    });

    if (error) {
      console.error('Error recording poll access in database:', error);
    } else {
      // Also record in localStorage for offline access
      const creatorSecret = accessType === 'creator' ? undefined : undefined; // Will be set separately for creators
      addPollAccess(pollId, accessType, creatorSecret);
    }
  } catch (error) {
    console.error('Error in recordPollAccess:', error);
  }
}

// Secure function to get polls user has access to
export async function getAccessiblePolls(): Promise<Poll[]> {
  const fingerprint = getClientFingerprint();
  
  // Rate limit check
  if (!checkRateLimit(fingerprint, 'get_accessible')) {
    console.warn('Rate limit exceeded for accessible polls query');
    return [];
  }

  try {
    await setClientContext(fingerprint);

    // This query will only return polls the user has access to due to RLS
    const { data, error } = await supabase
      .from('polls')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

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

// Secure function to access specific poll by ID or short_id
export async function getSecurePollAccess(idOrShortId: string): Promise<Poll | null> {
  const fingerprint = getClientFingerprint();
  
  // Rate limit check
  if (!checkRateLimit(fingerprint, 'get_poll')) {
    console.warn('Rate limit exceeded for poll access');
    return null;
  }

  try {
    // Determine if input is UUID or short_id
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrShortId);
    
    // Set appropriate context for RLS policy
    if (isUuid) {
      await setClientContext(fingerprint, idOrShortId);
    } else {
      await setClientContext(fingerprint, undefined, idOrShortId);
    }

    // Query for the poll - RLS will enforce access control
    const { data, error } = await supabase
      .from('polls')
      .select('*')
      .or(`id.eq.${idOrShortId},short_id.eq.${idOrShortId}`)
      .single();

    if (error || !data) {
      console.log('Poll not found or access denied:', error?.message);
      return null;
    }

    // Record access in database (this creates access for future queries)
    await recordPollAccess(data.id, 'viewer');

    return data;
  } catch (error) {
    console.error('Error in getSecurePollAccess:', error);
    return null;
  }
}

// Record poll creation access (includes creator secret)
export async function recordPollCreation(pollId: string, creatorSecret: string): Promise<void> {
  const fingerprint = getClientFingerprint();
  
  // Rate limit check
  if (!checkRateLimit(fingerprint, 'record_creation')) {
    console.warn('Rate limit exceeded for poll creation recording');
    return;
  }

  try {
    // Use secure function to insert poll access record
    const { error } = await supabase.rpc('insert_poll_access', {
      p_poll_id: pollId,
      p_client_fingerprint: fingerprint,
      p_access_type: 'creator'
    });

    if (error) {
      console.error('Error recording poll creation in database:', error);
      console.error('Fingerprint used:', fingerprint);
      console.error('Poll ID:', pollId);
    }

    // Also record in localStorage with creator secret
    addPollAccess(pollId, 'creator', creatorSecret);
  } catch (error) {
    console.error('Error in recordPollCreation:', error);
  }
}

// Get polls accessible to current user from localStorage (fallback)
export function getLocalAccessiblePollIds(): string[] {
  try {
    // Import here to avoid circular dependency
    const { getPollAccessList } = require('@/lib/pollAccess');
    return getPollAccessList();
  } catch (error) {
    console.error('Error getting local accessible polls:', error);
    return [];
  }
}

// Hybrid approach: get accessible polls with localStorage fallback
export async function getAccessiblePollsHybrid(): Promise<Poll[]> {
  try {
    // Try database-first approach
    const dbPolls = await getAccessiblePolls();
    
    if (dbPolls.length > 0) {
      return dbPolls;
    }

    // Fallback to localStorage-based query
    const localPollIds = getLocalAccessiblePollIds();
    if (localPollIds.length === 0) {
      return [];
    }

    const fingerprint = getClientFingerprint();
    await setClientContext(fingerprint);

    // Query specific poll IDs from localStorage
    const { data, error } = await supabase
      .from('polls')
      .select('*')
      .in('id', localPollIds)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error in localStorage fallback query:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in getAccessiblePollsHybrid:', error);
    return [];
  }
}

// Debug function to check current context
export async function debugClientContext(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  const fingerprint = getClientFingerprint();
  console.log('Debug: Client fingerprint:', fingerprint);
  
  try {
    // Try to get current config values
    const { data: configData } = await supabase.rpc('current_setting', { 
      setting_name: 'app.current_client_fingerprint' 
    });
    console.log('Debug: Current fingerprint in DB context:', configData);
  } catch (error) {
    console.log('Debug: Could not read DB context (expected if RLS not yet applied)');
  }
}

// Clean up rate limit storage periodically
if (typeof window !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, limit] of rateLimits.entries()) {
      if (now > limit.resetTime) {
        rateLimits.delete(key);
      }
    }
  }, 60000); // Clean up every minute
}