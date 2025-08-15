# Private Poll Feature Implementation Plan

## Overview
Add a "Private" checkbox option (checked by default) that prevents short URL generation, requiring the full UUID to access the poll.

## Database Changes
1. **Add migration** `016_add_private_polls_up.sql`:
   - Add `is_private BOOLEAN DEFAULT true` column to polls table
   - Update existing polls to `is_private = false` to maintain current behavior
   - Modify short_id generation trigger to only generate when `is_private = false`

## Frontend Changes

### 1. Create Poll Form (`app/create-poll/page.tsx`)
- Add state: `const [isPrivate, setIsPrivate] = useState(true)`
- Add checkbox above submit button:
  ```tsx
  <label className="flex items-center gap-2 cursor-pointer">
    <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
    <span>Private poll (requires full link to access)</span>
  </label>
  ```
- Include `is_private: isPrivate` in poll creation data

### 2. Poll Page (`app/p/[shortId]/page.tsx`)
- No changes needed - already handles both UUID and short_id routing

### 3. Homepage (`app/page.tsx`)
- Update poll links to use `poll.is_private ? poll.id : (poll.short_id || poll.id)`

## Backend Logic

### 1. Short ID Generation
- Modify database trigger/function to skip short_id generation when `is_private = true`
- Ensure short_id remains NULL for private polls

### 2. Poll Access
- Current routing already supports both formats
- `/p/[shortId]` accepts either short_id or full UUID

## User Experience
- **Private polls (default)**: Share via full UUID URL (harder to guess/remember)
- **Public polls**: Share via short memorable URL
- Private poll URLs are practically unguessable (UUID v4 = 2^122 possibilities)

## Implementation Order
1. Create and apply database migration
2. Update create poll form with checkbox
3. Test poll creation and access with both modes
4. Update homepage to use correct URLs
5. Add visual indicator (lock icon) for private polls in UI

## Testing Checklist
- [ ] Private poll creates without short_id
- [ ] Public poll creates with short_id
- [ ] Both URL formats work correctly
- [ ] Homepage shows correct URLs
- [ ] Existing polls still accessible