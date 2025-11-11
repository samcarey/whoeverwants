#!/usr/bin/env python3
"""Reopen and close poll to trigger recalculation with fixed algorithm"""

import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    test_dir = Path(__file__).parent
    poll_url = "http://localhost:3000/p/ef1f39ce-6925-4655-961b-ab4253b176e3/"

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={'width': 448, 'height': 1800}, locale='en-GB')
        page = await ctx.new_page()

        # Step 1: Reopen poll
        print('🔓 Reopening poll to reset state...')
        await page.goto(poll_url)
        await page.wait_for_timeout(2000)

        reopen_btn = page.locator('button:has-text("Reopen Poll")')
        if await reopen_btn.count() > 0:
            await reopen_btn.click()
            print('✓ Poll reopened')
            await page.wait_for_timeout(3000)
        else:
            print('⚠ Poll already open')

        # Step 2: Close poll to trigger recalculation
        await page.reload()
        await page.wait_for_timeout(2000)

        print('🔒 Closing poll (triggers fixed algorithm)...')
        close_btn = page.locator('button:has-text("Close Poll")')
        if await close_btn.count() > 0:
            await close_btn.click()
            print('✓ Poll closed - algorithm recalculated participants')
            await page.wait_for_timeout(3000)

            # Reload to see fresh results
            await page.reload()
            await page.wait_for_timeout(2000)

        # Step 3: Capture results
        print('📸 Capturing results...')
        await page.screenshot(path=test_dir / '05_results_fixed.png', full_page=True)
        print('✓ Screenshot saved to 05_results_fixed.png')

        # Step 4: Analyze results
        page_text = await page.text_content('body')

        print('\n📊 RESULTS ANALYSIS:')
        print('=' * 60)

        if 'not participating' in page_text.lower():
            # Extract who IS participating
            if 'but these are' in page_text.lower():
                print('✅ Some voters ARE participating')
                # Count participating voters
                import re
                # This is a rough check - we'll verify visually
                print('Check screenshot for participating voters list')
            else:
                print('❌ No one participating (event not happening)')

        # Check for specific voters
        voters = ['Alice Smith', 'Bob Johnson', 'Carol Williams', 'Diana Martinez', 'Eric Thompson']
        print('\nVoter presence in results:')
        for voter in voters:
            if voter in page_text:
                print(f'  ✓ {voter}')
            else:
                print(f'  ✗ {voter} (not found)')

        await browser.close()

        print('\n' + '=' * 60)
        print('✅ COMPLETE - Check 05_results_fixed.png')
        print('🔗 Poll: ' + poll_url)

if __name__ == '__main__':
    asyncio.run(main())
