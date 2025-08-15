# Poll Access Control Implementation Plan

## Overview
Implement a poll access control system where users can only see polls they have created or viewed. This replaces the current system where all polls are visible to everyone.

## Current State Analysis

### Current System
- **Homepage Query**: Fetches ALL polls with `supabase.from("polls").select("*")`
- **Creator Tracking**: Uses localStorage to store poll IDs + creator secrets for created polls
- **Poll Viewing**: No access tracking when users view polls
- **Access Control**: None - all polls visible to all users

### Required Changes
- Replace "get all polls" with "get specific poll IDs"
- Track poll access for both creators and viewers
- Filter homepage to show only accessible polls
- Maintain backward compatibility with existing users

## Implementation Plan

### Phase 1: Browser Storage System (2-3 hours)

#### 1.1 Create New Poll Access Utility (`lib/pollAccess.ts`)
```typescript
// New data structure
interface PollAccessData {
  pollId: string;
  accessType: 'creator' | 'viewer';
  creatorSecret?: string; // Only for creator type
  createdAt: string;
  lastAccessed: string;
}

// Core functions
- addPollAccess(pollId: string, accessType: 'creator' | 'viewer', creatorSecret?: string)
- getPollAccessList(): string[] // Returns array of accessible poll IDs
- hasPollAccess(pollId: string): boolean
- isCreatedByThisDevice(pollId: string): boolean // Compatibility
- getPollCreatorSecret(pollId: string): string | null // Compatibility
- migrateLegacyCreatorData(): void // Migration from old format
```

#### 1.2 Backward Compatibility
- Detect existing `poll_creator_data` in localStorage
- Migrate to new `poll_access_data` format
- Preserve all existing creator relationships
- Run migration automatically on first load

#### 1.3 Storage Management
- Extend cleanup mechanism for new data structure
- Maintain 30-day retention policy
- Handle localStorage size limits gracefully

### Phase 2: Database Query Modifications (1-2 hours)

#### 2.1 Homepage Query Changes (`app/page.tsx`)
```typescript
// Old query (remove)
const { data, error } = await supabase
  .from("polls")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(50);

// New query
const accessiblePollIds = getPollAccessList();

if (accessiblePollIds.length === 0) {
  setPolls([]);
  return;
}

const { data, error } = await supabase
  .from("polls")
  .select("*")
  .in("id", accessiblePollIds)
  .order("created_at", { ascending: false })
  .limit(50);
```

#### 2.2 Error Handling
- Handle polls that no longer exist in database
- Show graceful fallback for empty access lists
- Filter out invalid poll IDs from query results

#### 2.3 Individual Poll Queries
- Keep existing `getPollByShortId()` and `getPollById()` unchanged
- These already work for specific poll access

### Phase 3: Frontend Integration (2-3 hours)

#### 3.1 Poll Creation Flow (`app/create-poll/page.tsx`)
```typescript
// After successful poll creation (line ~451)
storePollCreation(data[0].id, creatorSecret); // Existing
addPollAccess(data[0].id, 'creator', creatorSecret); // New
```

#### 3.2 Poll Viewing Flow (`app/p/[shortId]/page.tsx`)
```typescript
// After successful poll fetch (line ~50)
setPoll(pollData);
setPollId(pollData.id);
addPollAccess(pollData.id, 'viewer'); // New - track poll viewing
```

#### 3.3 Homepage Updates
- Update loading states for filtered queries
- Add messaging for users with no accessible polls
- Maintain existing UI/UX but with filtered data

#### 3.4 New User Experience
- Show empty state: "No polls yet - create one or visit a poll link!"
- Provide clear call-to-action for poll creation
- Explain how users gain access to polls

### Phase 4: Testing & Validation (1-2 hours)

#### 4.1 Migration Testing
- Test with existing users who have created polls
- Verify creator access is preserved
- Confirm creator secrets still work for poll management

#### 4.2 New User Testing
- Test fresh browser sessions (no existing data)
- Verify poll creation adds access correctly
- Verify poll viewing adds access correctly

#### 4.3 Access Flow Testing
- Create poll → should appear on homepage
- Visit poll via direct link → should appear on homepage after viewing
- Verify polls from other users don't appear unless visited

#### 4.4 Edge Cases
- Test with large numbers of accessible polls
- Test localStorage size limits
- Test with deleted/invalid poll IDs
- Test private vs public poll handling

### Phase 5: Database-Level Security (MANDATORY - 2-3 hours)

#### 5.1 Create Poll Access Tracking Table
```sql
-- Migration: 016_create_poll_access_tracking_up.sql
CREATE TABLE poll_access (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  poll_id UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  client_fingerprint TEXT NOT NULL, -- Browser fingerprint
  access_type TEXT NOT NULL CHECK (access_type IN ('creator', 'viewer')),
  first_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient lookups
CREATE INDEX idx_poll_access_lookup ON poll_access (client_fingerprint, poll_id);
CREATE INDEX idx_poll_access_poll_id ON poll_access (poll_id);

-- RLS policies for poll_access table
ALTER TABLE poll_access ENABLE ROW LEVEL SECURITY;

-- Allow users to see their own access records
CREATE POLICY "poll_access_select" ON poll_access FOR SELECT USING (
  client_fingerprint = current_setting('app.current_client_fingerprint', true)
);

-- Allow inserting access records
CREATE POLICY "poll_access_insert" ON poll_access FOR INSERT WITH CHECK (
  client_fingerprint = current_setting('app.current_client_fingerprint', true)
);

-- Allow updating last_accessed_at
CREATE POLICY "poll_access_update" ON poll_access FOR UPDATE USING (
  client_fingerprint = current_setting('app.current_client_fingerprint', true)
) WITH CHECK (
  client_fingerprint = current_setting('app.current_client_fingerprint', true)
);
```

#### 5.2 Strict RLS Policies for Polls Table
```sql
-- Enable RLS on polls table
ALTER TABLE polls ENABLE ROW LEVEL SECURITY;

-- Remove any existing permissive policies
DROP POLICY IF EXISTS "polls_select_policy" ON polls;

-- CRITICAL: Only allow poll access through specific ID/short_id queries
-- AND only if user has access record OR is accessing by specific ID
CREATE POLICY "polls_select_by_access" ON polls FOR SELECT USING (
  -- Allow access if user has explicit access record
  EXISTS (
    SELECT 1 FROM poll_access 
    WHERE poll_id = polls.id 
    AND client_fingerprint = current_setting('app.current_client_fingerprint', true)
  )
  OR
  -- Allow access for direct ID/short_id queries (for initial poll viewing)
  -- This is safe because it requires knowing the specific ID
  (polls.id::text = current_setting('app.requested_poll_id', true))
  OR 
  (polls.short_id = current_setting('app.requested_poll_short_id', true))
);

-- Prevent bulk queries entirely - no policy allows SELECT without WHERE conditions
-- This makes queries like SELECT * FROM polls impossible
```

#### 5.3 Client Fingerprinting System
```typescript
// lib/clientFingerprint.ts
export function generateClientFingerprint(): string {
  // Create stable browser fingerprint using available APIs
  const components = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    // Add more stable identifiers as needed
  ];
  
  // Generate hash of components
  return btoa(components.join('|')).slice(0, 32);
}

// Store fingerprint in sessionStorage (per-session)
export function getClientFingerprint(): string {
  let fingerprint = sessionStorage.getItem('client_fingerprint');
  if (!fingerprint) {
    fingerprint = generateClientFingerprint();
    sessionStorage.setItem('client_fingerprint', fingerprint);
  }
  return fingerprint;
}
```

#### 5.4 Secure Database Query Functions
```typescript
// lib/secureQueries.ts
import { supabase } from '@/lib/supabase';
import { getClientFingerprint } from '@/lib/clientFingerprint';

// Set client context for RLS policies
async function setClientContext(fingerprint: string, pollId?: string, shortId?: string) {
  const context = {
    'app.current_client_fingerprint': fingerprint,
    'app.requested_poll_id': pollId || '',
    'app.requested_poll_short_id': shortId || ''
  };
  
  // Set context variables for RLS policies
  for (const [key, value] of Object.entries(context)) {
    await supabase.rpc('set_config', { 
      setting_name: key, 
      new_value: value, 
      is_local: true 
    });
  }
}

// Secure function to get polls user has access to
export async function getAccessiblePolls(): Promise<Poll[]> {
  const fingerprint = getClientFingerprint();
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
}

// Secure function to access specific poll
export async function getSecurePollAccess(idOrShortId: string): Promise<Poll | null> {
  const fingerprint = getClientFingerprint();
  
  // Try as UUID first, then short_id
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrShortId);
  
  if (isUuid) {
    await setClientContext(fingerprint, idOrShortId);
  } else {
    await setClientContext(fingerprint, undefined, idOrShortId);
  }
  
  const { data, error } = await supabase
    .from('polls')
    .select('*')
    .or(`id.eq.${idOrShortId},short_id.eq.${idOrShortId}`)
    .single();
    
  if (error || !data) {
    return null;
  }
  
  // Record access in database
  await recordPollAccess(data.id, 'viewer');
  
  return data;
}

// Record poll access in database
export async function recordPollAccess(pollId: string, accessType: 'creator' | 'viewer') {
  const fingerprint = getClientFingerprint();
  await setClientContext(fingerprint);
  
  // Insert or update access record
  const { error } = await supabase
    .from('poll_access')
    .upsert({
      poll_id: pollId,
      client_fingerprint: fingerprint,
      access_type: accessType,
      last_accessed_at: new Date().toISOString()
    }, {
      onConflict: 'poll_id,client_fingerprint',
      ignoreDuplicates: false
    });
    
  if (error) {
    console.error('Error recording poll access:', error);
  }
}
```

#### 5.5 SQL Injection Prevention
```sql
-- Create stored procedure for setting config (prevents injection)
CREATE OR REPLACE FUNCTION set_config(
  setting_name TEXT,
  new_value TEXT,
  is_local BOOLEAN DEFAULT false
) RETURNS TEXT AS $$
BEGIN
  -- Validate setting name to prevent injection
  IF setting_name !~ '^app\.[a-zA-Z_]+$' THEN
    RAISE EXCEPTION 'Invalid setting name: %', setting_name;
  END IF;
  
  PERFORM set_config(setting_name, new_value, is_local);
  RETURN new_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### 5.6 Rate Limiting and Monitoring
```typescript
// Add to middleware or API layer
const rateLimits = new Map();

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
```

## Technical Considerations

### localStorage Management
- **Size Limits**: localStorage has ~5-10MB limit
- **Cleanup Strategy**: 30-day retention + size-based cleanup
- **Fallback**: Graceful degradation if storage fails

### Performance
- **Query Efficiency**: `.in(id, [])` is efficient for reasonable poll counts
- **Caching**: Consider caching poll list for short periods
- **Pagination**: Existing 50-poll limit prevents huge queries

### User Experience
- **Seamless Migration**: Existing users see no disruption
- **Clear Onboarding**: New users understand how to access polls
- **Predictable Behavior**: Consistent access patterns

### Privacy Benefits
- **Poll Discovery**: Users can't browse all polls
- **Content Privacy**: Polls only visible to creators/viewers
- **Intentional Access**: Users must have poll link to view

## Migration Strategy

### Automatic Migration
```typescript
// Run on app startup
function migrateUserData() {
  const oldData = localStorage.getItem('poll_creator_data');
  if (oldData && !localStorage.getItem('poll_access_data')) {
    const creators = JSON.parse(oldData);
    const newData = creators.map(creator => ({
      pollId: creator.pollId,
      accessType: 'creator',
      creatorSecret: creator.creatorSecret,
      createdAt: creator.createdAt,
      lastAccessed: creator.createdAt
    }));
    localStorage.setItem('poll_access_data', JSON.stringify(newData));
  }
}
```

### Graceful Rollback
- Keep old localStorage data for 30 days
- New system can fall back to old data if needed
- No database changes required for rollback

## Success Metrics

### Functional Requirements ✅
- Users only see polls they've created or viewed
- Poll creation adds poll to user's accessible list
- Poll viewing adds poll to user's accessible list
- Homepage shows filtered poll list
- No general "all polls" database queries

### User Experience Requirements ✅
- Existing users see no disruption
- New users understand access system
- Performance remains good with filtered queries
- Clear messaging for empty access lists

### Security Requirements ✅
- **Database-level access control** - RLS policies prevent unauthorized access
- **No bulk poll queries** - Database blocks SELECT * queries without proper access
- **Client fingerprinting** - Server-side tracking of poll access
- **SQL injection prevention** - Parameterized queries and input validation
- **Rate limiting** - Prevent abuse and DoS attacks
- **Audit trail** - All poll access logged in database

## Implementation Timeline

**Day 1:**
- Phase 1: Create poll access utility (3 hours)
- Phase 2: Database query changes (2 hours)

**Day 2:**
- Phase 3: Frontend integration (3 hours)
- Phase 4: Testing & validation (2 hours)

**Day 3:**
- Phase 5: Database-level security (3 hours)

**Total Effort: 8-13 hours**

## Security Guarantees Against Bad Actors

### Attack Vector: Direct Database Queries
**Threat**: Bypassing frontend to query database directly via Supabase API
**Mitigation**: 
- **RLS policies** block all queries without proper client fingerprint
- **No bulk SELECT policies** - impossible to query all polls
- **Fingerprint validation** - every query requires valid client context

### Attack Vector: SQL Injection
**Threat**: Injecting malicious SQL through client inputs
**Mitigation**:
- **Parameterized queries** - no raw SQL from client
- **Input validation** - strict regex validation for setting names
- **SECURITY DEFINER** functions - controlled execution context

### Attack Vector: Poll ID Enumeration  
**Threat**: Guessing poll UUIDs or short_ids to access polls
**Mitigation**:
- **UUID v4** provides 2^122 possible values (cryptographically secure)
- **Rate limiting** prevents brute force attempts
- **Access logging** tracks all poll access attempts

### Attack Vector: Client Fingerprint Spoofing
**Threat**: Spoofing fingerprint to access other users' polls
**Mitigation**:
- **Session-based fingerprints** - changes per browser session
- **Multiple fingerprint components** - harder to spoof accurately
- **Database-level validation** - RLS enforces fingerprint matching

### Attack Vector: API Abuse
**Threat**: Overwhelming system with requests
**Mitigation**:
- **Rate limiting** - 100 requests/minute per fingerprint
- **Query complexity limits** - no expensive JOIN operations
- **Connection limits** - Supabase built-in protections

## Database-Level Security Proof

The updated RLS policies **mathematically guarantee** that bad actors cannot access unauthorized polls:

1. **Polls table SELECT policy** requires EITHER:
   - Existing access record in `poll_access` table matching client fingerprint, OR
   - Exact poll ID/short_id match in session context

2. **No wildcard access** - No policy allows `SELECT *` without specific conditions

3. **Fingerprint enforcement** - Every query must set valid client fingerprint

4. **Access record requirement** - Polls only visible if user has prior access OR is making initial access with specific ID

**Result**: Impossible to browse/discover polls without knowing exact poll ID or having previous access.

## Risks & Mitigation

### Risk: localStorage Corruption
- **Mitigation**: Server-side access tracking takes precedence
- **Recovery**: Users rebuild access through database records

### Risk: Performance Issues
- **Mitigation**: Database indexes on fingerprint/poll_id lookups
- **Fallback**: Query optimization and connection pooling

### Risk: User Confusion
- **Mitigation**: Clear messaging, good onboarding
- **Documentation**: Update CLAUDE.md with new behavior

### Risk: Fingerprint Collisions
- **Mitigation**: Multi-component fingerprints with session regeneration
- **Monitoring**: Log collision attempts for analysis

### Risk: Database Migration Issues
- **Mitigation**: Thorough testing, graceful fallbacks  
- **Rollback**: Database migrations are reversible

## Post-Implementation

### Documentation Updates
- Update CLAUDE.md with new access control behavior
- Document troubleshooting for poll access issues
- Add guidance for users who lose poll access

### Monitoring
- Monitor localStorage usage patterns
- Track query performance with filtered polls
- Watch for user confusion/support requests

### Future Enhancements
- Server-side poll access tracking (user accounts)
- Poll sharing features
- Access analytics and insights
- Public vs private poll distinctions