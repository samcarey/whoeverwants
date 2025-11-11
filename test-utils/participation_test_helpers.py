#!/usr/bin/env python3
"""
Reusable test utilities for participation poll automation.
These helpers encapsulate best practices learned from debugging test failures.
"""

from playwright.async_api import Page
from typing import Optional


async def wait_for_form_ready(page: Page, timeout: int = 30000):
    """
    Wait for React hydration to complete.

    Uses the __FORM_READY__ flag set by the application when hydration is complete.
    This prevents race conditions where tests try to interact with forms before
    React has fully initialized.

    Args:
        page: Playwright page object
        timeout: Maximum time to wait in milliseconds (default: 30000)
    """
    try:
        await page.wait_for_function('window.__FORM_READY__ === true', timeout=timeout)
    except:
        # Fallback: just wait a bit if the flag doesn't get set
        print("  ⚠ __FORM_READY__ not set, using fallback wait")
        await page.wait_for_timeout(2000)


async def fill_duration_range(page: Page, min_val: float, max_val: float):
    """
    Fill duration min/max inputs with deferred validation.

    IMPORTANT: The order matters due to validation logic. Always:
    1. Fill max value first
    2. Then fill min value
    3. Trigger blur events to apply values

    This prevents the min validation from clobbering the max value.

    Args:
        page: Playwright page object
        min_val: Minimum duration in hours (e.g., 0.5, 1, 1.5)
        max_val: Maximum duration in hours

    Example:
        await fill_duration_range(page, 0.5, 1)  # 0.5-1 hour range
    """
    duration_inputs = page.locator('[data-testid="duration-counter"] input[type="number"], [data-testid="duration-counter"] input[inputmode="decimal"]')

    # Fill MAX first (critical: prevents validation from overwriting)
    await duration_inputs.nth(1).fill('')
    await page.wait_for_timeout(100)
    await duration_inputs.nth(1).fill(str(max_val))
    await duration_inputs.nth(1).blur()
    await page.wait_for_timeout(400)

    # Then fill MIN
    await duration_inputs.nth(0).fill('')
    await page.wait_for_timeout(100)
    await duration_inputs.nth(0).fill(str(min_val))
    await duration_inputs.nth(0).blur()
    await page.wait_for_timeout(400)


async def fill_time_range(page: Page, start: str, end: str):
    """
    Fill time window inputs.

    Args:
        page: Playwright page object
        start: Start time in HH:MM format (e.g., "08:00")
        end: End time in HH:MM format (e.g., "11:00")

    Example:
        await fill_time_range(page, "08:00", "11:00")
    """
    time_inputs = page.locator('[data-testid="time-range-input"] input[type="text"][inputmode="numeric"]')

    await time_inputs.nth(0).fill(start)
    await page.wait_for_timeout(200)
    await time_inputs.nth(1).fill(end)
    await page.wait_for_timeout(200)


async def fill_participant_range(page: Page, min_val: int, max_val: Optional[int] = None):
    """
    Fill participant min/max inputs.

    Args:
        page: Playwright page object
        min_val: Minimum number of participants
        max_val: Maximum number of participants (optional, omit for "X+" style)

    Example:
        await fill_participant_range(page, 3, 5)  # 3-5 participants
        await fill_participant_range(page, 4)     # 4+ participants (no max)
    """
    # CounterInput uses type="text" with inputMode="decimal", not type="number"
    participant_inputs = page.locator('[data-testid="participants-counter"] input[type="text"][inputmode="decimal"]')

    # Check if participant inputs exist
    count = await participant_inputs.count()
    if count == 0:
        print("  ⚠ Participant inputs not found, skipping")
        return

    # Fill max first (if provided) to avoid validation issues
    if max_val is not None and count >= 2:
        # Check if max input is disabled (checkbox might need to be enabled)
        max_input = participant_inputs.nth(1)
        is_disabled = await max_input.is_disabled()

        if is_disabled:
            # Find and click the max enable checkbox (there's only one checkbox for max enable)
            max_checkbox = page.locator('[data-testid="participants-counter"] input[type="checkbox"]').first
            checkbox_count = await page.locator('[data-testid="participants-counter"] input[type="checkbox"]').count()
            if checkbox_count > 0:
                await max_checkbox.check()
                await page.wait_for_timeout(500)

        await participant_inputs.nth(1).fill('')
        await page.wait_for_timeout(100)
        await participant_inputs.nth(1).fill(str(max_val))
        await participant_inputs.nth(1).blur()
        await page.wait_for_timeout(400)

    # Then fill min
    await participant_inputs.nth(0).fill('')
    await page.wait_for_timeout(100)
    await participant_inputs.nth(0).fill(str(min_val))
    await participant_inputs.nth(0).blur()
    await page.wait_for_timeout(400)


async def verify_duration_values(page: Page, expected_min: float, expected_max: float) -> bool:
    """
    Verify that duration inputs contain expected values.

    This should be called BEFORE taking screenshots to ensure test validity.

    Args:
        page: Playwright page object
        expected_min: Expected minimum duration
        expected_max: Expected maximum duration

    Returns:
        True if values match, False otherwise

    Example:
        verified = await verify_duration_values(page, 0.5, 1)
        if verified:
            await page.screenshot(path='alice.png')
    """
    duration_inputs = page.locator('[data-testid="duration-counter"] input[type="number"], [data-testid="duration-counter"] input[inputmode="decimal"]')

    actual_min = await duration_inputs.nth(0).input_value()
    actual_max = await duration_inputs.nth(1).input_value()

    min_match = float(actual_min) == expected_min
    max_match = float(actual_max) == expected_max

    if not (min_match and max_match):
        print(f"❌ Duration mismatch: expected {expected_min}-{expected_max}, got {actual_min}-{actual_max}")
        return False

    print(f"✓ Duration verified: {actual_min}-{actual_max}")
    return True


async def click_submit_with_confirmation(page: Page):
    """
    Click submit button and handle confirmation modal.

    The create-poll form shows a confirmation modal before actually submitting.
    This helper handles both clicks automatically.

    Args:
        page: Playwright page object

    Example:
        await click_submit_with_confirmation(page)
        await page.wait_for_url('**/p/**')  # Wait for navigation to poll
    """
    # Click Submit button
    await page.click('button:has-text("Submit")')
    await page.wait_for_timeout(1000)

    # Click Create in confirmation modal
    await page.click('button:has-text("Create")')
    await page.wait_for_timeout(1000)


async def select_days(page: Page, day_offsets: list[int], all_poll_days: list[int] = None, is_creator: bool = False):
    """
    Select multiple days in the DaysSelector calendar.

    IMPORTANT:
    - On CREATION page: Only "Today" is pre-selected. Just select the days you want.
    - ON VOTING page: All poll days are pre-selected. Clear them first, then select subset.

    Args:
        page: Playwright page object
        day_offsets: List of day offsets from today (0=today, 1=tomorrow, 2=day after, etc.)
        all_poll_days: List of all poll day offsets (used to clear pre-selections on voting page)
        is_creator: True if selecting days on creation form, False if voting on existing poll

    Example:
        await select_days(page, [0, 1, 2, 3, 4], is_creator=True)  # Creator selects 5 days
        await select_days(page, [0, 1], all_poll_days=[0,1,2,3,4])  # Voter selects 2 from 5
    """
    from datetime import datetime, timedelta

    # Set up console listener to capture DaysSelector logs
    console_logs = []
    def handle_console(msg):
        if '[DaysSelector]' in msg.text:
            console_logs.append(msg.text)
            print(f"  [CONSOLE] {msg.text}")

    page.on('console', handle_console)

    # Click to open days selector
    days_button = page.locator('text=Possible Days').locator('..').locator('button, div[role="button"]')
    if await days_button.count() == 0:
        # Try alternative selector - click on the days display area
        days_display = page.locator('text=Today').first
        if await days_display.count() > 0:
            await days_display.click()
        else:
            print("  ⚠ Could not find days selector button")
            return
    else:
        await days_button.first.click()

    await page.wait_for_timeout(800)

    today = datetime.now()

    if is_creator:
        # CREATION PAGE: "Today" is pre-selected by default
        # Clear it first to get to a known empty state
        today_date_str = today.strftime('%Y-%m-%d')
        today_button = page.locator(f'button[data-date="{today_date_str}"]')

        try:
            is_disabled = await today_button.is_disabled()
            if not is_disabled:
                print(f"  Clearing pre-selected Today ({today_date_str})")
                await today_button.click()
                await page.wait_for_timeout(200)
        except Exception as e:
            print(f"  Note: Could not clear Today (may not exist): {e}")

    else:
        # VOTING PAGE: All poll days are pre-selected, clear them first
        if all_poll_days is None:
            all_poll_days = [0, 1, 2, 3, 4]  # Default assumption

        print(f"  Clearing pre-selected days: {all_poll_days}")
        for offset in all_poll_days:
            target_date = today + timedelta(days=offset)
            date_str = target_date.strftime('%Y-%m-%d')

            # Use data-date attribute to target exact calendar button
            day_button = page.locator(f'button[data-date="{date_str}"]')

            try:
                is_disabled = await day_button.is_disabled()
                if not is_disabled:
                    print(f"    Deselecting {date_str}")
                    await day_button.click()
                    await page.wait_for_timeout(200)
            except Exception as e:
                print(f"    Error deselecting {date_str}: {e}")

    # Now select only the desired days
    print(f"  Selecting days: {day_offsets}")
    for offset in day_offsets:
        target_date = today + timedelta(days=offset)
        date_str = target_date.strftime('%Y-%m-%d')

        # Use data-date attribute to target exact calendar button
        day_button = page.locator(f'button[data-date="{date_str}"]')

        try:
            is_disabled = await day_button.is_disabled()
            if not is_disabled:
                print(f"    Selecting {date_str}")
                await day_button.click()
                await page.wait_for_timeout(200)
        except Exception as e:
            print(f"    Error selecting {date_str}: {e}")

    # Wait longer before Apply to ensure all clicks are processed
    await page.wait_for_timeout(1000)

    # Click Apply button
    apply_button = page.locator('button:has-text("Apply")')
    if await apply_button.count() > 0:
        print(f"  Clicking Apply button...")
        await apply_button.click()
        await page.wait_for_timeout(1500)

        # Verify the days were actually applied by checking the display
        days_display = page.locator('text=Possible Days').locator('..').locator('div, span')
        if await days_display.count() > 0:
            text = await days_display.first.text_content()
            print(f"  Days display after apply: {text[:100] if text else 'empty'}")
        else:
            print("  ⚠ Could not find days display to verify")
    else:
        print("  ⚠ Could not find Apply button")

    # Clean up console listener
    page.remove_listener('console', handle_console)


async def fill_participation_ballot(
    page: Page,
    voter_name: str,
    time_start: str,
    time_end: str,
    duration_min: float,
    duration_max: float,
    participants_min: int,
    participants_max: Optional[int] = None,
    day_offsets: Optional[list[int]] = None,
    verify: bool = True
):
    """
    Complete helper to fill an entire participation poll ballot.

    This encapsulates all best practices:
    - Waits for form readiness
    - Fills inputs in correct order
    - Optionally verifies values before submission

    Args:
        page: Playwright page object
        voter_name: Name to enter in voter name field
        time_start: Start time (HH:MM)
        time_end: End time (HH:MM)
        duration_min: Minimum duration in hours
        duration_max: Maximum duration in hours
        participants_min: Minimum participants
        participants_max: Maximum participants (optional)
        day_offsets: Days to select as offsets from today (optional, e.g., [0, 1, 2] for today/tomorrow/day after)
        verify: Whether to verify duration values (default: True)

    Returns:
        True if successful (and verification passed if enabled)

    Example:
        success = await fill_participation_ballot(
            page,
            voter_name="Alice Smith",
            time_start="08:00",
            time_end="11:00",
            duration_min=0.5,
            duration_max=1,
            participants_min=3,
            participants_max=5,
            day_offsets=[0, 1, 2]  # Today, tomorrow, day after tomorrow
        )
    """
    # Wait for form to be ready
    await wait_for_form_ready(page)

    # Wait for participation conditions to render (with longer timeout for slower loads)
    try:
        await page.wait_for_selector('[data-testid="participation-conditions"]', timeout=45000)
        await page.wait_for_timeout(500)
    except:
        print("  ⚠ Participation conditions not found, page might have different state")
        # Take a debug screenshot
        await page.screenshot(path='/tmp/debug-no-conditions.png')
        raise

    # Fill all fields
    await fill_time_range(page, time_start, time_end)
    await fill_duration_range(page, duration_min, duration_max)
    await fill_participant_range(page, participants_min, participants_max)

    # Select days if specified
    if day_offsets is not None:
        # Pass all_poll_days=[0,1,2,3,4] to clear the 5-day poll defaults first
        await select_days(page, day_offsets, all_poll_days=[0, 1, 2, 3, 4])

    # Enter voter name
    await page.fill('input[placeholder*="name"]', voter_name)

    # Verify if requested
    if verify:
        if not await verify_duration_values(page, duration_min, duration_max):
            return False

    # Click Yes to indicate participation
    await page.click('button:has-text("Yes")')
    await page.wait_for_timeout(500)

    # Actually submit the vote to database
    submit_button = page.locator('button:has-text("Submit Vote")')
    if await submit_button.count() > 0:
        await submit_button.click()
        # Wait for submission to complete
        await page.wait_for_timeout(2000)
        print(f"  ✓ Vote submitted for {voter_name}")
    else:
        print(f"  ⚠ Submit Vote button not found")
        return False

    return True


# Export all helpers
__all__ = [
    'wait_for_form_ready',
    'fill_duration_range',
    'fill_time_range',
    'fill_participant_range',
    'select_days',
    'verify_duration_values',
    'click_submit_with_confirmation',
    'fill_participation_ballot',
]
