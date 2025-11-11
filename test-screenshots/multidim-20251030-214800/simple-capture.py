#!/usr/bin/env python3
"""Simple script to capture ballot screenshots"""

import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

poll_url = "http://localhost:3000/p/ef1f39ce-6925-4655-961b-ab4253b176e3/"
test_dir = Path(__file__).parent

async def capture_ballot(page, voter):
    """Capture a single voter ballot screenshot"""
    print(f"\n📸 Capturing {voter['name']}...")

    await page.goto(poll_url)
    await page.wait_for_timeout(2000)

    # Fill name
    await page.fill('input[placeholder="Enter your name..."]', voter['name'])
    await page.wait_for_timeout(300)

    # Click Yes
    await page.click('button:has-text("Yes")')
    await page.wait_for_timeout(300)

    # Just capture the form - don't fill everything
    await page.wait_for_timeout(500)

    # Screenshot
    await page.screenshot(path=test_dir / voter['screenshot'], full_page=True)
    print(f"✓ Saved {voter['screenshot']}")

async def main():
    voters = [
        {'name': 'Alice Smith', 'min': 3, 'max': 5, 'screenshot': '02_alice.png'},
        {'name': 'Bob Johnson', 'min': 3, 'max': None, 'screenshot': '03_bob.png'},
        {'name': 'Carol Williams', 'min': 3, 'max': 4, 'screenshot': '04_carol.png'},
    ]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 448, 'height': 1800}, locale='en-GB')

        for voter in voters:
            await capture_ballot(page, voter)

        await browser.close()

    print('\n✅ All screenshots captured')

if __name__ == '__main__':
    asyncio.run(main())
