# Testing and Report Generation System

## Overview

This document describes the system for creating automated browser tests with Playwright and generating HTML reports with screenshots to demonstrate and validate poll functionality.

## Purpose

- **Visual Testing**: Capture screenshots of poll creation and voting flows
- **Algorithm Validation**: Prove that constraint algorithms work correctly
- **Documentation**: Generate shareable HTML reports showing test scenarios
- **Regression Testing**: Verify that changes don't break existing functionality

## Directory Structure

```
test-screenshots/
  ├── [test-name]-[timestamp]/     # One directory per test run
  │   ├── 01_creator.png            # Poll creation screenshot
  │   ├── 02_voter1.png             # First voter ballot
  │   ├── 03_voter2.png             # Second voter ballot
  │   ├── 04_voter3.png             # Third voter ballot
  │   ├── 05_results.png            # Final results after close
  │   ├── generate-report.py        # Script to generate HTML report
  │   ├── report.html               # Generated HTML report
  │   └── [helper scripts]          # Test-specific utilities
  │
test-utils/
  ├── participation_test_helpers.py # Reusable Playwright helpers
  └── [other helpers]                # Test utilities
```

## Key Scripts and Usage

### 1. Poll Creation Script

Create a poll via API:

```javascript
// create-poll-api.cjs
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL_TEST,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function createPoll() {
  const { data, error } = await supabase
    .from('polls')
    .insert({
      title: 'Test Poll Title',
      poll_type: 'participation',
      creator_secret: 'test-secret',
      response_deadline: new Date(Date.now() + 86400000).toISOString(),
      is_closed: false,
      possible_dates: ['2025-11-07', '2025-11-08', '2025-11-09'],
      time_window: { minValue: '08:00', maxValue: '20:00' },
      duration_range: { minValue: 0.5, maxValue: 3 }
    })
    .select()
    .single();

  console.log('Poll created:', data.id);
}
```

### 2. Vote Insertion Script

Insert votes directly via API:

```javascript
// insert-votes-api.cjs
async function insertVotes(pollId) {
  const votes = [
    {
      poll_id: pollId,
      vote_type: 'participation',
      yes_no_choice: 'yes',
      is_abstain: false,
      voter_name: 'Alice Smith',
      min_participants: 3,
      max_participants: 5,
      voter_days: ['2025-11-07', '2025-11-08'],
      voter_time: { minValue: '08:00', maxValue: '12:00' },
      voter_duration: { minValue: 0.5, maxValue: 1.5 }
    },
    // ... more voters
  ];

  for (const vote of votes) {
    const { error } = await supabase.from('votes').insert(vote);
    if (error) console.error('Error:', error);
    else console.log(`✓ ${vote.voter_name}`);
  }
}
```

### 3. Screenshot Capture Script

Capture ballot screenshots using Playwright:

```python
#!/usr/bin/env python3
# simple-capture.py
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

async def capture_ballot(page, voter):
    await page.goto(f"http://localhost:3000/p/{poll_id}/")
    await page.wait_for_timeout(2000)

    # Fill voter name
    await page.fill('input[placeholder="Enter your name..."]', voter['name'])
    await page.click('button:has-text("Yes")')
    await page.wait_for_timeout(500)

    # Capture screenshot
    await page.screenshot(path=voter['screenshot'], full_page=True)

async def main():
    voters = [
        {'name': 'Alice Smith', 'screenshot': '02_alice.png'},
        {'name': 'Bob Johnson', 'screenshot': '03_bob.png'},
    ]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={'width': 448, 'height': 1800},
            locale='en-GB'
        )

        for voter in voters:
            await capture_ballot(page, voter)

        await browser.close()

asyncio.run(main())
```

### 4. Results Capture Script

Reopen and close poll to trigger algorithm recalculation:

```python
#!/usr/bin/env python3
# reopen-and-close.py
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
from supabase import create_client

# Reopen poll
supabase.table('polls').update({'is_closed': False}).eq('id', poll_id).execute()

# Close poll (triggers algorithm)
supabase.table('polls').update({'is_closed': True}).eq('id', poll_id).execute()

# Capture results screenshot
async with async_playwright() as p:
    browser = await p.chromium.launch(headless=True)
    page = await browser.new_page(viewport={'width': 448, 'height': 1800})
    await page.goto(f"http://localhost:3000/p/{poll_id}/")
    await page.wait_for_timeout(3000)
    await page.screenshot(path='05_results.png', full_page=True)
    await browser.close()
```

### 5. HTML Report Generator

Generate shareable HTML report from screenshots:

```python
#!/usr/bin/env python3
# generate-report.py
import base64
from pathlib import Path

def encode_image(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode()

test_dir = Path(__file__).parent

# Encode all screenshots
creator_img = encode_image(test_dir / '01_creator.png')
alice_img = encode_image(test_dir / '02_alice.png')
bob_img = encode_image(test_dir / '03_bob.png')
results_img = encode_image(test_dir / '05_results.png')

# Generate HTML with embedded images
html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Test Report</title>
    <style>
        body {{ font-family: system-ui; max-width: 1400px; margin: 0 auto; padding: 20px; }}
        .screenshot {{ max-width: 400px; border: 1px solid #ddd; }}
        .ballot {{ margin: 40px 0; }}
    </style>
</head>
<body>
    <h1>Test Report: [Test Name]</h1>

    <div class="ballot">
        <h2>Poll Creation</h2>
        <img src="data:image/png;base64,{creator_img}" class="screenshot">
    </div>

    <div class="ballot">
        <h2>Alice Smith - Voter 1</h2>
        <img src="data:image/png;base64,{alice_img}" class="screenshot">
    </div>

    <!-- More voters... -->

    <div class="ballot">
        <h2>Final Results</h2>
        <img src="data:image/png;base64,{results_img}" class="screenshot">
    </div>
</body>
</html>
"""

output_path = test_dir / 'report.html'
with open(output_path, 'w') as f:
    f.write(html)

print(f'✓ Report generated: {output_path}')
```

## Complete Testing Workflow

### Step 1: Create Poll

```bash
# Via API (recommended for testing)
node create-poll-api.cjs

# Or via Playwright browser automation
python3 test-create-poll.py
```

**Output**: Poll ID (UUID)

### Step 2: Capture Creation Screenshot

```bash
python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 448, 'height': 1800})
    page.goto('http://localhost:3000/p/{poll_id}/?secret={secret}')
    page.wait_for_timeout(2000)
    page.screenshot(path='01_creator.png', full_page=True)
    browser.close()
"
```

### Step 3: Insert Votes

```bash
# Via API (faster, more reliable)
node insert-votes-api.cjs

# Or via Playwright (captures interaction screenshots)
python3 capture-ballots.py
```

### Step 4: Close Poll and Capture Results

```bash
python3 reopen-and-close.py
```

This script:
1. Reopens poll (clears previous results)
2. Closes poll (triggers algorithm recalculation)
3. Captures results screenshot

### Step 5: Generate HTML Report

```bash
python3 generate-report.py
```

### Step 6: Deploy Report

```bash
# Copy to public directory for web access
cp report.html ../../public/test-report.html

# Access via:
# http://localhost:3000/test-report.html
# http://mini4:3000/test-report.html (Tailscale)
```

## Best Practices Learned

### 1. Screenshot Dimensions

```python
viewport={'width': 448, 'height': 1800}
```

- **Width 448px**: Mobile viewport width, prevents horizontal scrolling
- **Height 1800px**: Tall enough for full forms, use `full_page=True` for actual height
- **Locale 'en-GB'**: Consistent date formatting

### 2. Wait Times

```python
await page.goto(url)
await page.wait_for_timeout(2000)  # Wait for React hydration
await page.click(selector)
await page.wait_for_timeout(300)   # Wait for state updates
```

**Critical**: Always wait after navigation for React hydration to complete.

### 3. Reliable Selectors

Prefer in order of reliability:
1. `data-testid` attributes: `page.locator('[data-testid="min-participants"]')`
2. `data-date` attributes: `page.locator('[data-date="2025-11-07"]')`
3. Placeholder text: `page.locator('input[placeholder="Enter your name..."]')`
4. Button text: `page.click('button:has-text("Yes")')`

### 4. API vs UI Testing

**Use API when**:
- Creating test data quickly
- Setting up complex constraint combinations
- Bypassing UI interaction issues

**Use Playwright when**:
- Capturing actual user interaction flow
- Testing UI behavior and validation
- Generating visual documentation

### 5. Poll State Management

```javascript
// Always set appropriate deadline
response_deadline: new Date(Date.now() + 86400000).toISOString()

// Reopen before closing to reset state
await supabase.from('polls').update({ is_closed: false }).eq('id', pollId)
await supabase.from('polls').update({ is_closed: true }).eq('id', pollId)
```

### 6. Database Constraints

When inserting votes via API:
- `voter_days` must be subset of `poll.possible_dates`
- `voter_time` must be within `poll.time_window`
- `voter_duration` must be within `poll.duration_range`
- All JSONB fields need proper structure: `{ minValue, maxValue, minEnabled, maxEnabled }`

### 7. Report Organization

Structure HTML reports with:
1. **Overview section**: High-level description of test scenario
2. **Constraint summary**: Table/list showing all voter constraints
3. **Sequential screenshots**: Creation → Voters → Results
4. **Analysis section**: Explain why results are correct
5. **Embedded images**: Base64-encoded for single-file portability

## Common Issues and Solutions

### Issue: "Name input not found"

**Cause**: Poll is closed or expired

**Solution**:
```javascript
await supabase.from('polls')
  .update({
    is_closed: false,
    response_deadline: new Date(Date.now() + 86400000).toISOString()
  })
  .eq('id', pollId)
```

### Issue: Hydration errors in screenshots

**Cause**: Capturing before React finishes hydration

**Solution**: Wait 2-3 seconds after navigation
```python
await page.goto(url)
await page.wait_for_load_state('networkidle')
await page.wait_for_timeout(2000)
```

### Issue: Playwright timeout on interactions

**Cause**: Element disabled or not yet rendered

**Solution**: Check element state first
```python
# Wait for element to be enabled
await page.wait_for_selector('button:not([disabled])', timeout=5000)
await page.click('button')
```

### Issue: Screenshots show wrong constraints

**Cause**: Cached data or votes not inserted correctly

**Solution**:
1. Delete existing votes: `DELETE FROM votes WHERE poll_id = '{poll_id}'`
2. Re-insert with correct constraints
3. Force browser cache clear in Playwright: `context.clear_cookies()`

## Testing Multidimensional Constraints

For participation polls with complex constraints:

```javascript
// Example: Testing that algorithm correctly excludes incompatible voters
const votes = [
  {
    voter_name: 'Alice',
    voter_days: ['2025-11-07', '2025-11-08'],  // Today, Tomorrow
    voter_time: { minValue: '08:00', maxValue: '12:00' },
    // ...
  },
  {
    voter_name: 'Bob',
    voter_days: ['2025-11-09', '2025-11-10'],  // Different days - incompatible!
    voter_time: { minValue: '15:00', maxValue: '19:00' },
    // ...
  }
];
```

**Expected result**: Alice and Bob should NOT both participate (zero overlapping days).

**Validation**: Check results screenshot shows only one participating, or neither if min participant requirements not met.

## Reusable Helper Functions

Located in `test-utils/participation_test_helpers.py`:

```python
async def select_days(page, day_offsets, all_poll_days=None, is_creator=False):
    """Select multiple days in the DaysSelector calendar"""
    # Handles creator vs voter day selection differences
    # Uses data-date attributes for reliable selection

async def fill_participation_ballot(page, voter_name, time_start, time_end, ...):
    """Fill entire participation ballot form"""
    # Complete form filling including all constraint dimensions
```

## Example Test Scenarios

### 1. Basic Participation Flow
- 3 voters, all compatible constraints
- Event should happen with all 3 participating

### 2. Multidimensional Constraint Validation
- 5 voters with variety across all dimensions
- Some compatible, some incompatible
- Verify algorithm finds correct stable configuration

### 3. Edge Cases
- All voters require min participants that can't be satisfied → No event
- Voters with restrictive max constraints → Lower priority
- No overlapping availability → Empty participating set

## Output Artifacts

Each test produces:
- **Screenshots**: PNG files showing UI state
- **HTML Report**: Self-contained documentation
- **Console logs**: Test execution details
- **Database state**: Votes and poll configuration for debugging

## Maintenance

### Updating Screenshots for UI Changes

When UI changes:
1. Re-run capture scripts to get new screenshots
2. Verify constraints still display correctly
3. Update report generator if layout changed significantly

### Adding New Test Scenarios

1. Create new directory: `test-screenshots/[scenario-name]-[timestamp]/`
2. Copy and adapt existing scripts (create-poll, insert-votes, capture)
3. Create custom `generate-report.py` for scenario-specific analysis
4. Document new scenario in this file

## Deployment

### Local Testing
```bash
open test-screenshots/[test-name]/report.html
```

### Web Access
```bash
cp report.html public/[test-name]-report.html
# Access at: http://localhost:3000/[test-name]-report.html
# Or via Tailscale: http://mini4:3000/[test-name]-report.html
```

### Sharing
HTML reports are self-contained with embedded base64 images, so they can be:
- Emailed as single file
- Hosted on any web server
- Committed to git for documentation
- Shared via file sharing services

## Future Improvements

- [ ] Automated test suite that runs all scenarios
- [ ] Diff tool to compare results before/after algorithm changes
- [ ] Integration with CI/CD pipeline
- [ ] Screenshot comparison tool to detect unintended UI regressions
- [ ] Test data generator for random valid constraint combinations
- [ ] Performance benchmarking for large polls (50+ voters)
