# Implementation Plan: Location & Time Fields for Participation Polls

## Feature Summary

Participation polls get two new optional fields: **Location** and **Time**. Each has a dropdown with 3 modes:

1. **Set** — creator types a value directly
2. **Ask for Preferences** — creator provides options, system auto-creates a ranked choice sub-poll
3. **Ask for Suggestions** — system auto-creates a nomination sub-poll, which auto-creates a ranked choice preferences poll when it closes

### Key Behaviors

- Participation poll launches immediately and is votable before sub-polls resolve
- Sub-polls are hidden from the main poll list, only accessible from the participation poll
- Location and Time sub-polls run in parallel (independent)
- Creator sets independent durations per phase per field
- Validation: sub-poll deadlines < participation poll deadline; preferences deadline > suggestions deadline
- When nomination poll closes → auto-create preferences poll from nominations (existing mechanism)
- When preferences poll closes → resolved value auto-populates on participation poll
- Resolved values on participation poll link to final results
- Preferences poll shows nomination results as "Round 0" in rounds navigation
- "Ask for Preferences" mode opens a modal reusing the existing `OptionsInput` component (no code duplication). When closed, show option count in parentheses after "Preferences"
- No curation of nominations before they flow into preferences poll
- Fully automated chain, no creator intervention needed

---

## Phase 1: Database Migrations

### Migration 069: Add location/time fields to polls

New columns on `polls` table:

```sql
-- Mode selection for each field
location_mode TEXT CHECK (location_mode IN ('set', 'preferences', 'suggestions')),
time_mode TEXT CHECK (time_mode IN ('set', 'preferences', 'suggestions')),

-- Static values for 'set' mode
location_value TEXT,
time_value TEXT,

-- Resolved values (populated when sub-poll chain completes)
resolved_location TEXT,
resolved_time TEXT,

-- Sub-poll metadata
is_sub_poll BOOLEAN DEFAULT false,
sub_poll_role TEXT CHECK (sub_poll_role IN (
  'location_preferences', 'location_suggestions',
  'time_preferences', 'time_suggestions'
)),
parent_participation_poll_id UUID REFERENCES polls(id),

-- Phase deadlines (in minutes)
location_suggestions_deadline_minutes INT,
location_preferences_deadline_minutes INT,
time_suggestions_deadline_minutes INT,
time_preferences_deadline_minutes INT
```

Down migration drops all these columns.

### Migration 070: Add location/time options columns

```sql
-- Options for 'preferences' mode (creator-provided)
location_options TEXT[],
time_options TEXT[]
```

These store the options the creator provides when selecting "Ask for Preferences" mode. They're sent to the API at creation time and used to populate the ranked choice sub-poll.

---

## Phase 2: Python API Changes

### 2a. Update `server/models.py`

**CreatePollRequest** — add fields:
- `location_mode: str | None = None`
- `location_value: str | None = None`
- `location_options: list[str] | None = None`
- `time_mode: str | None = None`
- `time_value: str | None = None`
- `time_options: list[str] | None = None`
- `location_suggestions_deadline_minutes: int | None = None`
- `location_preferences_deadline_minutes: int | None = None`
- `time_suggestions_deadline_minutes: int | None = None`
- `time_preferences_deadline_minutes: int | None = None`

**PollResponse** — add fields:
- All the above, plus: `resolved_location`, `resolved_time`, `is_sub_poll`, `sub_poll_role`, `parent_participation_poll_id`

### 2b. Update `create_poll` in `server/routers/polls.py`

After inserting the main participation poll, for each field (location, time):

**"set" mode:**
- Store value in `location_value`/`time_value` and also in `resolved_location`/`resolved_time` (already resolved)

**"preferences" mode:**
- Create a ranked_choice sub-poll with:
  - `is_sub_poll=true`
  - `sub_poll_role='location_preferences'` or `'time_preferences'`
  - `parent_participation_poll_id=<parent_id>`
  - `options=<creator-provided options>`
  - `title="Location for <parent title>"` or `"Time for <parent title>"`
  - `creator_secret=<parent's creator_secret>`
  - `response_deadline = now + preferences_deadline_minutes`
  - `is_closed=false`

**"suggestions" mode:**
- Create a nomination sub-poll with:
  - `is_sub_poll=true`
  - `sub_poll_role='location_suggestions'` or `'time_suggestions'`
  - `parent_participation_poll_id=<parent_id>`
  - `auto_create_preferences=true`
  - `title="Location for <parent title>"` or `"Time for <parent title>"`
  - `creator_secret=<parent's creator_secret>`
  - `response_deadline = now + suggestions_deadline_minutes`
- Create a reserved ranked_choice sub-poll (placeholder, existing pattern):
  - `is_sub_poll=true`
  - `sub_poll_role='location_preferences'` or `'time_preferences'`
  - `parent_participation_poll_id=<parent_id>`
  - `follow_up_to=<nomination sub-poll id>`
  - `is_closed=true`, `options=NULL`
  - `auto_preferences_deadline_minutes=<preferences_deadline_minutes>`

This reuses the existing `_activate_reserved_preferences_poll` mechanism exactly.

### 2c. New endpoint: `GET /api/polls/{poll_id}/sub-polls`

Returns all sub-polls for a participation poll. Query:
```sql
SELECT * FROM polls WHERE parent_participation_poll_id = :poll_id ORDER BY created_at
```

### 2d. Resolution logic: `_resolve_sub_poll_winner()`

New helper function called when a ranked_choice sub-poll with `sub_poll_role` closes:

1. Compute the IRV winner from ranked choice results
2. Find parent via `parent_participation_poll_id`
3. Update parent's `resolved_location` or `resolved_time` with winner text

Called from:
- `_check_auto_close()` — after vote-triggered auto-close
- `close_poll()` — after manual close
- `get_results()` — after deadline-triggered lazy close

Must also propagate `parent_participation_poll_id` and `is_sub_poll=true` in `_activate_reserved_preferences_poll()` when it activates the reserved ranked_choice poll from a nomination sub-poll.

### 2e. Hide sub-polls from main list

In `get_accessible_polls`, add filter: `AND (is_sub_poll = false OR is_sub_poll IS NULL)`

### 2f. Validation in `create_poll`

- `location_mode`/`time_mode` only valid when `poll_type='participation'`
- "preferences" mode requires `location_options`/`time_options` with >= 2 items
- "set" mode requires non-empty `location_value`/`time_value`
- Sub-poll deadlines must be before participation poll's `response_deadline`
- For "suggestions" mode: suggestions deadline < preferences deadline (preferences starts after suggestions ends)

---

## Phase 3: Frontend — Types & API Client

### 3a. Update `lib/types.ts`

Add to `Poll` interface:
```typescript
location_mode?: 'set' | 'preferences' | 'suggestions' | null;
location_value?: string | null;
location_options?: string[] | null;
resolved_location?: string | null;
time_mode?: 'set' | 'preferences' | 'suggestions' | null;
time_value?: string | null;
time_options?: string[] | null;
resolved_time?: string | null;
is_sub_poll?: boolean;
sub_poll_role?: string | null;
parent_participation_poll_id?: string | null;
location_suggestions_deadline_minutes?: number | null;
location_preferences_deadline_minutes?: number | null;
time_suggestions_deadline_minutes?: number | null;
time_preferences_deadline_minutes?: number | null;
```

### 3b. Update `lib/api.ts`

- Add new fields to `apiCreatePoll` params and `toPoll` mapping
- Add `apiGetSubPolls(pollId: string): Promise<Poll[]>` function

---

## Phase 4: Frontend — Create Poll UI

### 4a. New state in `app/create-poll/page.tsx`

```typescript
const [locationMode, setLocationMode] = useState<'none' | 'set' | 'preferences' | 'suggestions'>('suggestions');
const [locationValue, setLocationValue] = useState('');
const [locationOptions, setLocationOptions] = useState<string[]>(['', '']);
const [locationSuggestionsDeadline, setLocationSuggestionsDeadline] = useState('');
const [locationPreferencesDeadline, setLocationPreferencesDeadline] = useState('');
const [showLocationOptionsModal, setShowLocationOptionsModal] = useState(false);
// Same for time_*
```

Default mode is "Ask for Suggestions" (most common use case).

### 4b. UI layout (only when `pollType === 'participation'`)

Below existing participation poll settings, add two sections:

**Location:**
```
[Label: "Location"]  [Dropdown: Ask for Suggestions ▼]
                      - Ask for Suggestions (default)
                      - Ask for Preferences (3)  ← count shown when modal has been used
                      - Set
```

- **Ask for Suggestions**: Show two deadline dropdowns (suggestions phase, preferences phase)
- **Ask for Preferences**: Clicking opens modal with `OptionsInput` component. After closing, show option count. Show one deadline dropdown (preferences phase)
- **Set**: Show text input

**Time:** Same structure.

### 4c. Preferences modal

Reuse existing `OptionsInput` component inside a modal overlay. No submit button — modal closes on tap-away. The options state persists after close. Show count in dropdown label: "Ask for Preferences (3)"

### 4d. Form submission

In `handleConfirmSubmit`, include location/time fields in the API request. Map deadline dropdown values to minutes using existing `baseDeadlineOptions` lookup.

### 4e. Client-side validation

- Sub-poll deadlines < main poll deadline
- "suggestions" mode: preferences deadline > suggestions deadline
- "set" mode: non-empty value
- "preferences" mode: >= 2 options

---

## Phase 5: Frontend — Participation Poll Display

### 5a. Fetch sub-polls in `PollPageClient.tsx`

On mount, if poll has `location_mode` or `time_mode` (non-null, not 'set'), call `apiGetSubPolls(pollId)`.

### 5b. New component: `SubPollField.tsx`

Displays a location or time field on the participation poll page:

- **Resolved** (`resolved_location`/`resolved_time` set): Show the value as a clickable link → navigates to the preferences sub-poll results
- **Sub-poll open** (nomination or ranked_choice): Show "Vote on location"/"Suggest a time" button → navigates to active sub-poll. Show countdown.
- **Between phases** (nomination closed, preferences pending): Show "Resolving suggestions..." status
- **Set mode**: Show static value (no link)

### 5c. Sub-poll back navigation

On sub-poll pages (where `parent_participation_poll_id` is set), show a "Back to <participation poll title>" link.

### 5d. Creator secret propagation

When navigating from participation poll to sub-poll, propagate the parent's creator secret to the sub-poll in localStorage. Follow existing pattern from `browserPollAccess.ts`.

---

## Phase 6: Round 0 — Nomination Results in Ranked Choice

### Update `CompactRankedChoiceResults.tsx`

When the ranked_choice poll has `follow_up_to` pointing to a nomination poll:

1. Detect: check if parent poll is nomination type (fetch parent poll data)
2. Fetch parent nomination poll results
3. Prepend "Round 0: Suggestions" to the round visualizations
4. Use the `NominationsList` component (pills with vote counts) for Round 0 display
5. Adjust round navigation to start from 0

---

## Implementation Order

| Step | What | Files |
|------|------|-------|
| 1 | Database migration 069 (all new columns) | `database/migrations/069_*` |
| 2 | Database migration 070 (options columns) | `database/migrations/070_*` |
| 3 | Python models | `server/models.py` |
| 4 | API: create_poll sub-poll creation | `server/routers/polls.py` |
| 5 | API: sub-polls endpoint | `server/routers/polls.py` |
| 6 | API: resolution logic | `server/routers/polls.py` |
| 7 | API: hide sub-polls from list | `server/routers/polls.py` |
| 8 | API: validation | `server/routers/polls.py` |
| 9 | TypeScript types | `lib/types.ts` |
| 10 | API client | `lib/api.ts` |
| 11 | Create-poll UI | `app/create-poll/page.tsx` |
| 12 | SubPollField component | `components/SubPollField.tsx` |
| 13 | Participation poll display | `app/p/[shortId]/PollPageClient.tsx` |
| 14 | Round 0 in ranked choice results | `components/CompactRankedChoiceResults.tsx` |
| 15 | Python tests | `server/tests/` |
| 16 | Frontend tests | `tests/__tests__/` |

---

## Risks & Mitigations

- **Constraint stacking**: PostgreSQL only reports first failing constraint. Add logging before each INSERT, test incrementally.
- **Deadline validation**: Multiple nested deadline relationships. Validate all server-side in `create_poll`.
- **Creator secret propagation**: Sub-polls share parent's `creator_secret`. Frontend must use `recordPollCreation()` when navigating to sub-polls.
- **Race conditions on resolution**: Use `WHERE is_closed = false` in UPDATE (existing pattern).
- **`_activate_reserved_preferences_poll` must propagate sub-poll metadata**: When activating the reserved ranked_choice poll, copy `parent_participation_poll_id`, `is_sub_poll`, and `sub_poll_role` from the nomination sub-poll.

---

## Existing Code to Reuse

| Pattern | Where | Reuse How |
|---------|-------|-----------|
| `auto_create_preferences` + reserved placeholder | `server/routers/polls.py` lines 246-257 | Nomination → preferences chain for "suggestions" mode |
| `_activate_reserved_preferences_poll` | `server/routers/polls.py` lines 85-153 | Fires when nomination sub-poll closes |
| `_check_auto_close` | `server/routers/polls.py` line 369 | Hook resolution logic after auto-close |
| `OptionsInput` component | `components/OptionsInput.tsx` | Reuse in preferences modal (no duplication) |
| `NominationsList` component | `components/NominationsList.tsx` | Reuse for Round 0 display |
| Deadline lazy-close in `get_results` | `server/routers/polls.py` lines 459-475 | Same pattern for sub-poll deadline expiry |
| `baseDeadlineOptions` | `app/create-poll/page.tsx` | Map deadline dropdown values to minutes |
