import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreatePollPage } from '../pages/CreatePollPage';
import { PollPage } from '../pages/PollPage';

test.describe('Nomination Ownership Integrity', () => {
  test('should preserve nomination ownership during edit operations', async ({ page, browser }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    const pollPage = new PollPage(page);

    // Step 1: Browser 1 creates a nomination poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    await createPollPage.verifyPageLoaded();

    // Select "Suggestions" type
    await page.click('button:has-text("Suggestions")');
    
    // Enter poll title
    await page.fill('input[placeholder*="title"]', 'Nomination Ownership Test');
    
    // Submit the poll
    await page.click('button:has-text("Submit")');
    
    // Wait for navigation to poll page
    await page.waitForTimeout(2000);
    const pollUrl = page.url();

    // Step 2: Browser 1 submits first nomination
    // Wait for the voting interface to appear
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    
    // Add first nomination using the first available text input
    const nominationInput = page.locator('input[type="text"]').first();
    await nominationInput.fill('First User Nomination');
    
    // Fill voter name
    await page.fill('input[placeholder*="name"]', 'User One');
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(3000);

    // Verify vote was submitted successfully
    await expect(page.locator('button:has-text("Edit")')).toBeVisible();

    // Step 3: Browser 2 opens the poll and votes
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(pollUrl);
    await page2.waitForTimeout(2000);

    // Second the existing nomination from Browser 1
    await page2.click('button:has-text("First User Nomination")');
    
    // Add own nomination - find the first available text input for nominations
    const newNominationInput = page2.locator('input[type="text"]').first();
    await newNominationInput.fill('Second User Nomination');
    await page2.fill('input[placeholder*="name"]', 'User Two');
    await page2.click('button:has-text("Submit Vote")');
    await page2.waitForTimeout(3000);

    // Step 4: Verify Browser 1 edit mode shows correct ownership
    await page.reload();
    await page.waitForTimeout(2000);
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(1000);

    // Browser 1 should see their own nomination in editable text field
    await expect(page.locator('label:has-text("Your nominations:")')).toBeVisible();
    const browser1OwnInput = page.locator('input[value="First User Nomination"]');
    await expect(browser1OwnInput).toBeVisible();

    // Browser 1 should see Browser 2's nomination as a clickable button (not editable)
    const browser2NominationButton = page.locator('button:has-text("Second User Nomination")');
    await expect(browser2NominationButton).toBeVisible();
    
    // Verify "Other nominations" section exists
    await expect(page.locator('h5:has-text("Other nominations")')).toBeVisible();

    // Browser 1 should NOT have an input field for Browser 2's nomination
    const browser2Input = page.locator('input[value="Second User Nomination"]');
    await expect(browser2Input).not.toBeVisible();

    // Step 5: Verify Browser 2 edit mode shows correct ownership  
    await page2.click('button:has-text("Edit")');
    await page2.waitForTimeout(1000);

    // Browser 2 should see their own nomination in editable text field
    await expect(page2.locator('label:has-text("Your nominations:")')).toBeVisible();
    const browser2OwnInput = page2.locator('input[value="Second User Nomination"]');
    await expect(browser2OwnInput).toBeVisible();

    // Browser 2 should see Browser 1's nomination as a selected button (they seconded it)
    const browser1NominationButton = page2.locator('button:has-text("First User Nomination")');
    await expect(browser1NominationButton).toBeVisible();
    
    // Verify it's selected (has green background)
    await expect(browser1NominationButton).toHaveClass(/bg-green/);

    // Browser 2 should NOT have an input field for Browser 1's nomination
    const browser1Input = page2.locator('input[value="First User Nomination"]');
    await expect(browser1Input).not.toBeVisible();

    // Step 6: Test that Browser 2 can deselect but not edit the seconded nomination
    await browser1NominationButton.click();
    await expect(browser1NominationButton).not.toHaveClass(/bg-green/);
    
    // Re-select it
    await browser1NominationButton.click();
    await expect(browser1NominationButton).toHaveClass(/bg-green/);

    // Step 7: Test that only own nominations can be modified
    // Browser 1 modifies their own nomination
    await browser1OwnInput.fill('Modified First Nomination');
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(3000);

    // Browser 2 modifies their own nomination
    await browser2OwnInput.fill('Modified Second Nomination');
    await page2.click('button:has-text("Submit Vote")');
    await page2.waitForTimeout(3000);

    // Step 8: Verify modifications are preserved correctly
    await page.reload();
    await page2.reload();
    await page.waitForTimeout(2000);
    await page2.waitForTimeout(2000);

    // Both browsers should see the updated nominations
    await expect(page.locator('text="Modified First Nomination"')).toBeVisible();
    await expect(page.locator('text="Modified Second Nomination"')).toBeVisible();
    await expect(page2.locator('text="Modified First Nomination"')).toBeVisible();
    await expect(page2.locator('text="Modified Second Nomination"')).toBeVisible();

    // Original nominations should no longer exist
    await expect(page.locator('text="First User Nomination"')).not.toBeVisible();
    await expect(page.locator('text="Second User Nomination"')).not.toBeVisible();

    // Step 9: Verify edit mode still maintains ownership after modifications
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(1000);

    // Browser 1 should still only see their modified nomination as editable
    await expect(page.locator('input[value="Modified First Nomination"]')).toBeVisible();
    await expect(page.locator('input[value="Modified Second Nomination"]')).not.toBeVisible();
    await expect(page.locator('button:has-text("Modified Second Nomination")')).toBeVisible();

    await page2.click('button:has-text("Edit")');
    await page2.waitForTimeout(1000);

    // Browser 2 should still only see their modified nomination as editable  
    await expect(page2.locator('input[value="Modified Second Nomination"]')).toBeVisible();
    await expect(page2.locator('input[value="Modified First Nomination"]')).not.toBeVisible();
    await expect(page2.locator('button:has-text("Modified First Nomination")')).toBeVisible();

    await page.screenshot({ path: 'test-results/nomination-ownership-browser1.png' });
    await page2.screenshot({ path: 'test-results/nomination-ownership-browser2.png' });

    await context2.close();
  });

  test('should prevent users from accidentally editing others nominations', async ({ page, browser }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);

    // Create poll with Browser 1
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    await page.click('button:has-text("Suggestions")');
    await page.fill('input[placeholder*="title"]', 'Edit Prevention Test');
    await page.click('button:has-text("Submit")');
    await page.waitForTimeout(2000);

    const pollUrl = page.url();

    // Browser 1 submits nomination
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    const originalNominationInput = page.locator('input[type="text"]').first();
    await originalNominationInput.fill('Original Important Idea');
    await page.fill('input[placeholder*="name"]', 'Original Author');
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(3000);

    // Browser 2 seconds the nomination
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(pollUrl);
    await page2.waitForTimeout(2000);

    await page2.click('button:has-text("Original Important Idea")');
    await page2.fill('input[placeholder*="name"]', 'Second User');
    await page2.click('button:has-text("Submit Vote")');
    await page2.waitForTimeout(3000);

    // Browser 2 attempts to edit - should NOT be able to modify the original idea text
    await page2.click('button:has-text("Edit")');
    await page2.waitForTimeout(1000);

    // Critical test: Browser 2 should not have any input field containing "Original Important Idea"
    const dangerousInput = page2.locator('input[value="Original Important Idea"]');
    await expect(dangerousInput).not.toBeVisible();

    // Instead, it should appear as a selected button that can be deselected
    const safeButton = page2.locator('button:has-text("Original Important Idea")');
    await expect(safeButton).toBeVisible();
    await expect(safeButton).toHaveClass(/bg-green/);

    // Browser 2 should only be able to add their own new nominations
    await expect(page2.locator('label:has-text("Your nominations:")')).toBeVisible();
    const newNominationInput = page2.locator('input[type="text"]').first();
    await newNominationInput.fill('My Own Idea');

    // Submit and verify both nominations exist separately
    await page2.click('button:has-text("Submit Vote")');
    await page2.waitForTimeout(3000);

    // Both ideas should exist and be intact
    await expect(page2.locator('text="Original Important Idea"')).toBeVisible();
    await expect(page2.locator('text="My Own Idea"')).toBeVisible();

    // Verify Browser 1 still owns their original nomination
    await page.reload();
    await page.waitForTimeout(2000);
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(1000);

    // Browser 1 should still be able to edit their original nomination
    const originalOwnerInput = page.locator('input[value="Original Important Idea"]');
    await expect(originalOwnerInput).toBeVisible();

    // And see Browser 2's nomination as a button
    await expect(page.locator('button:has-text("My Own Idea")')).toBeVisible();
    await expect(page.locator('input[value="My Own Idea"]')).not.toBeVisible();

    await context2.close();
  });
});