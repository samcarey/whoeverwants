# Multidimensional Constraint Validation Test

## Purpose

This test demonstrates that the participation poll algorithm correctly enforces constraints across ALL dimensions (days, time windows, duration, participant counts), not just participant counts alone.

## Bug Fixed

**Migration 078**: `database/migrations/078_fix_multidimensional_constraints_up.sql`

The original `calculate_participating_voters` function only checked participant count constraints, completely ignoring days, time windows, and duration ranges. This caused mathematically impossible results where voters with zero overlapping availability were marked as participating together.

## Test Scenario

**5 voters with varied constraints:**

| Voter | Days | Time | Duration | Participants |
|-------|------|------|----------|--------------|
| Alice Smith | Today, Tomorrow | 08:00-12:00 | 0.5-1.5h | 3-5 |
| Bob Johnson | Today, Tomorrow | 11:00-15:00 | 1-2h | 3+ (no max) |
| Carol Williams | Day+2, Day+3 | 16:00-20:00 | 1.5-2.5h | 3-4 |
| Diana Martinez | Today, Tomorrow | 09:00-13:00 | 1-2h | 3-5 |
| Eric Thompson | Today, Tomorrow | 10:00-14:00 | 1-2.5h | 3-6 |

## Expected Result

**4 of 5 voters participate:**
- ✅ Alice, Bob, Diana, Eric: Share Today/Tomorrow, time overlap 11:00-12:00, duration 1-1.5h
- ❌ Carol: Days Day+2/Day+3 have ZERO overlap with participating group

## Test Files

### Essential Files (kept in repo)
- `01_creator.png` - Poll creation showing 5 possible days
- `02_alice.png` - Alice's ballot
- `03_bob.png` - Bob's ballot
- `04_carol.png` - Carol's ballot
- `05_results_fixed.png` - Final results with corrected algorithm
- `generate-report.py` - HTML report generator
- `report.html` - Final HTML report
- `insert-compatible-votes.cjs` - Script to recreate test data
- `reopen-and-close.py` - Script to trigger algorithm recalculation
- `simple-capture.py` - Script to capture ballot screenshots
- `README.md` - This file

### Temporary Files (deleted)
All other `.py`, `.cjs`, `.log`, and `.png` files were temporary debugging artifacts.

## Recreating This Test

```bash
# 1. Create poll (or use existing poll ID)
# Poll ID: ef1f39ce-6925-4655-961b-ab4253b176e3

# 2. Insert test votes
node insert-compatible-votes.cjs

# 3. Capture ballot screenshots (optional - already captured)
python3 simple-capture.py

# 4. Close poll and capture results
python3 reopen-and-close.py

# 5. Generate HTML report
python3 generate-report.py

# 6. View report
open report.html
# Or deploy: cp report.html ../../public/multidim-report.html
```

## Report Access

- Local: `open report.html`
- Web: http://localhost:3000/multidim-report.html
- Tailscale: http://mini4:3000/multidim-report.html

## Validation

The test proves the algorithm now correctly:
1. Checks day overlap (must have ≥1 common day)
2. Checks time window overlap (windows must intersect)
3. Checks duration range overlap (ranges must intersect)
4. Validates participant counts (final count satisfies all min/max)

Carol is correctly excluded despite having compatible participant count (3-4) because her days (Day+2/Day+3) don't overlap with the participating group's days (Today/Tomorrow).
