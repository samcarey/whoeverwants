# Follow-Up Poll Feature Implementation Plan

## Overview
Implement a comprehensive follow-up poll system that allows users to create polls that reference previous polls, with recursive discovery of all related polls to automatically expand the user's poll list.

## Phase 1: Database Schema Changes

### 1.1 Add follow_up_to Column to Polls Table
```sql
ALTER TABLE polls ADD COLUMN follow_up_to UUID REFERENCES polls(id);
CREATE INDEX idx_polls_follow_up_to ON polls(follow_up_to);
```

### 1.2 Create Recursive Follow-Up Discovery Function
```sql
CREATE OR REPLACE FUNCTION get_all_related_poll_ids(input_poll_ids UUID[])
RETURNS TABLE(poll_id UUID) AS $$
WITH RECURSIVE poll_tree AS (
    -- Base case: Start with input poll IDs
    SELECT id as poll_id, 0 as level
    FROM polls 
    WHERE id = ANY(input_poll_ids)
    
    UNION ALL
    
    -- Recursive case: Find follow-ups to current level
    SELECT p.id as poll_id, pt.level + 1
    FROM polls p
    INNER JOIN poll_tree pt ON p.follow_up_to = pt.poll_id
    WHERE pt.level < 10  -- Prevent infinite loops
)
SELECT DISTINCT poll_tree.poll_id FROM poll_tree;
$$ LANGUAGE SQL;
```

## Phase 2: API Endpoints

### 2.1 Follow-Up Discovery Endpoint
```typescript
// GET /api/polls/discover-related
// Input: { pollIds: string[] }
// Output: { allRelatedIds: string[] }
```

### 2.2 Enhanced Poll Creation
- Modify existing poll creation endpoint to accept `follow_up_to` parameter
- Validate that the referenced poll exists and user has access

## Phase 3: Frontend Components

### 3.1 Follow-Up Button Component
```typescript
// components/FollowUpButton.tsx
// Shows on closed poll results pages
// Links to create-poll with followUpTo query parameter
```

### 3.2 Follow-Up Header Component
```typescript
// components/FollowUpHeader.tsx
// Shows on create-poll page when followUpTo is present
// Displays "Follow up to 'Original Poll Title'"
// Fetches and displays original poll title
```

### 3.3 Enhanced Poll List Discovery
```typescript
// lib/pollDiscovery.ts
// Automatic discovery and storage expansion
// Called on home page load and after poll creation
```

## Phase 4: Create Poll Page Enhancements

### 4.1 URL Parameter Handling
- Accept `followUpTo` query parameter
- Fetch original poll title for display
- Pass follow-up reference to submission handler

### 4.2 Form Submission Updates
- Include `follow_up_to` in poll creation payload
- After successful creation, trigger poll discovery refresh

## Phase 5: Home Page Poll Discovery

### 5.1 Enhanced Poll Loading Logic
1. Get stored poll IDs from localStorage
2. Call follow-up discovery API to get all related IDs
3. Compare with stored IDs, add any new ones to localStorage
4. If new IDs found, re-fetch poll list with expanded ID set
5. Display all polls with visual indicators for follow-ups

### 5.2 Follow-Up Visual Indicators
- Show chain/link icons for polls that are follow-ups
- Display relationship hints in poll cards
- Group related polls together optionally

## Phase 6: Implementation Steps

### Step 1: Database Changes
1. Add migration for `follow_up_to` column
2. Create recursive discovery function
3. Add database indexes for performance

### Step 2: Backend API
1. Create `/api/polls/discover-related` endpoint
2. Implement recursive poll ID discovery
3. Update poll creation endpoint to handle follow-ups
4. Add validation for follow-up references

### Step 3: Frontend Components
1. Create `FollowUpButton` component for results pages
2. Create `FollowUpHeader` component for create page
3. Implement poll discovery utilities
4. Add follow-up indicators to poll cards

### Step 4: Page Integration
1. Add follow-up button to poll results pages (closed polls only)
2. Enhance create-poll page with follow-up header
3. Update home page poll loading with discovery
4. Handle URL parameters and navigation

### Step 5: Testing & Polish
1. Test recursive discovery with various poll chains
2. Handle edge cases (deleted polls, circular references)
3. Performance testing with large poll networks
4. UI/UX refinements

## Technical Considerations

### Performance
- Limit recursion depth to prevent infinite loops
- Index follow_up_to column for fast queries
- Cache discovery results on frontend
- Batch poll fetching to minimize API calls

### Security
- Validate user access to referenced polls
- Prevent creation of circular follow-up chains
- Sanitize poll titles in follow-up headers

### User Experience
- Clear visual indication of poll relationships
- Intuitive follow-up creation flow
- Automatic poll list expansion without user action
- Graceful handling of missing/deleted referenced polls

### Error Handling
- Handle cases where follow-up target is deleted
- Graceful degradation if discovery API fails
- Clear error messages for invalid follow-up attempts

## Database Migration File Structure
```
database/migrations/
├── 016_add_follow_up_to_polls_up.sql
├── 017_create_poll_discovery_function_up.sql
└── 018_add_poll_indexes_up.sql
```

## File Structure for Implementation
```
lib/
├── pollDiscovery.ts          # Recursive poll discovery logic
├── followUpHelpers.ts        # Follow-up utility functions
└── followUpValidation.ts     # Validation for follow-up references

components/
├── FollowUpButton.tsx        # Button for results pages
├── FollowUpHeader.tsx        # Header for create page
└── PollCard.tsx              # Enhanced with follow-up indicators

app/
├── api/polls/discover-related/route.ts  # Discovery API endpoint
├── create-poll/page.tsx      # Enhanced with follow-up support
└── page.tsx                  # Enhanced poll loading with discovery
```

## Success Metrics
- Users can create follow-up polls with one click
- Poll discovery automatically expands user's poll list
- Follow-up relationships are clearly visible
- No performance degradation with large poll networks
- Recursive discovery works reliably up to reasonable depths