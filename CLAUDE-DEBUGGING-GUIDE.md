# Claude Quick Debugging Guide

## 🚨 When User Reports "Vote Submit Failed"

### Step 1: Add Logging IMMEDIATELY
Don't guess - add comprehensive logging first:
```typescript
// In PollPageClient.tsx
const logToServer = async (logType, level, message, data) => {
  await fetch('/api/debug-logs', {
    method: 'POST',
    body: JSON.stringify({ sessionId, logType, level, message, data })
  });
};
```

### Step 2: Check Log Files
```bash
# Most recent logs
cat debug-logs/nomination-vote-$(date +%Y-%m-%d).log | tail -50
```

### Step 3: Common Database Constraint Errors

#### Error: `vote_yes_no_valid`
**Fix**: Apply migration 047
```sql
ALTER TABLE votes DROP CONSTRAINT IF EXISTS vote_yes_no_valid;
```

#### Error: `votes_vote_type_check`
**Fix**: Apply migration 048
```sql
ALTER TABLE votes DROP CONSTRAINT IF EXISTS votes_vote_type_check;
ALTER TABLE votes ADD CONSTRAINT votes_vote_type_check
  CHECK (vote_type IN ('yes_no', 'ranked_choice', 'nomination'));
```

#### Error: `vote_structure_valid`
**Fix**: Check migration 043/044 for proper structure validation

## 🔧 Quick Fixes

### Frontend Validation Issues
```typescript
// In handleVoteClick
if (poll.poll_type === 'nomination' && !isAbstaining) {
  const filtered = nominationChoices.filter(c => c && c.trim().length > 0);
  if (filtered.length === 0) {
    setVoteError("Please select at least one nomination");
    return;
  }
}
```

### Database Constraint Issues
```bash
# Apply specific migration
./scripts/apply-single-migration.sh database/migrations/048_fix_vote_type_check_constraint_up.sql
```

### Clear Cache & Restart
```bash
rm -rf .next && npm run dev
```

## 📊 Debugging Decision Tree

```
User: "Vote submit failed"
    ↓
Is there an error message visible?
    ├─ Yes → Check specific constraint name
    │         └─ Apply relevant migration
    └─ No → Add logging system first
             └─ Check logs for real error
                  └─ Fix based on constraint name
```

## ⚡ Speed Tips

1. **Don't debug blind** - Always add logging first
2. **Check ALL constraints** - They can stack/hide each other
3. **Test after each fix** - New errors may appear
4. **Keep migrations atomic** - One constraint per migration

## 🎯 Most Common Issues (Ranked)

1. **Missing 'nomination' in type enum** (votes_vote_type_check)
2. **Old constraints not removed** (vote_yes_no_valid)
3. **Frontend validation too strict**
4. **Cache issues** (rm -rf .next)
5. **Multiple dev servers on different ports**

## 💾 Database Constraint Audit

Run this to see all constraints:
```javascript
// scripts/audit-constraints.cjs
const { data } = await supabase.rpc('get_all_constraints');
console.log(data.filter(c => c.table_name === 'votes'));
```

## 🚀 Proactive Measures

Before user tests voting:
1. ✅ Check logging endpoint exists (`/api/debug-logs`)
2. ✅ Verify all vote types in constraints
3. ✅ Clear Next.js cache
4. ✅ Ensure single dev server on port 3000

## 📝 Note for Future Claude

**The nomination voting issue was caused by MULTIPLE overlapping constraints:**
- First fix revealed second constraint
- PostgreSQL only reports first failing constraint
- Always check for additional constraints after fixing one

**Time could have been saved by:**
1. Adding comprehensive logging immediately (not after multiple attempts)
2. Checking ALL constraints on the votes table at once
3. Understanding that constraints can "hide" behind each other

**Remember**: When one constraint is fixed, test again immediately - there may be more!