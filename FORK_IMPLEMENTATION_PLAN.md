# Fork Feature Implementation Plan

## Overview
Add a "Fork" button next to follow-up buttons that creates a new poll based on an existing one, with auto-filled form data and change tracking.

## 1. Database Schema Changes
- **Option A**: Add new `fork_of` field to polls table (RECOMMENDED)
  - `fork_of UUID REFERENCES polls(id)`
  - Keeps forks separate from follow-ups conceptually
- **Option B**: Reuse `follow_up_to` with a type flag
  - Less clean, mixes two different concepts

## 2. Database Migration
Create migration file: `041_add_fork_relationship_up.sql`
```sql
ALTER TABLE polls ADD COLUMN IF NOT EXISTS fork_of UUID REFERENCES polls(id);
CREATE INDEX IF NOT EXISTS idx_polls_fork_of ON polls(fork_of);
```

## 3. Fork Button Component
Create `components/ForkButton.tsx`:
- Similar styling to FollowUpButton
- Takes `pollId` and `pollData` props  
- Navigates to `/create-poll?fork=${pollId}` with poll data in URL params or localStorage
- Icon: branching/fork symbol (could use git fork icon)

## 4. Create Poll Form Enhancements
Modify `app/create-poll/page.tsx`:
- Detect fork mode from URL params `?fork=pollId`
- Fetch original poll data and auto-fill form
- Track form changes to enable/disable submit
- Add fork relationship when submitting
- Show indicator that this is a fork during creation

## 5. Fork Header Component  
Create `components/ForkHeader.tsx`:
- Similar to FollowUpHeader
- Shows: "This is a fork of [Original Poll Title]"
- Links back to original poll

## 6. Poll Display Updates
Modify `PollPageClient.tsx`:
- Show ForkHeader when poll has `fork_of` field
- Add ForkButton next to FollowUpButton in button rows
- Pass poll data to ForkButton

## 7. Supabase Integration
Update `lib/supabase.ts`:
- Add `fork_of` field to Poll interface
- Update poll creation function to handle forks
- Add query functions for fork relationships

## 8. Implementation Steps
1. ✅ Create plan document  
2. ✅ Create database migration
3. ✅ Update Poll interface and supabase functions
4. ✅ Create ForkButton component
5. ✅ Create ForkHeader component  
6. ✅ Update create-poll form for fork mode
7. ✅ Add fork buttons to poll pages
8. ✅ Test fork creation and display
9. ⚠️ Run migration on database (needs manual execution due to migration conflicts)

## Technical Considerations
- **URL vs LocalStorage**: Use URL params for fork ID, localStorage for poll data to avoid URL length limits
- **Change Detection**: Compare form state with original poll data
- **Validation**: Ensure at least one field is different before allowing submit
- **UI/UX**: Clear indication when in fork mode, easy way to see what changed
- **Performance**: Efficient queries for fork relationships

## UI Design Notes
- Fork button should be visually distinct from Follow-up button
- Use branching/fork icon (⑂ or similar)
- Fork header should be styled similarly to follow-up header
- Form should clearly indicate "Forking from: [Original Title]"