import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreatePollPage } from '../pages/CreatePollPage';
import { PollPage } from '../pages/PollPage';

test.describe('Suggestion Ownership Integrity', () => {
  test('should preserve suggestion ownership during edit operations', async ({ page, browser }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    const pollPage = new PollPage(page);

    // Step 1: Browser 1 creates a suggestion poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    await createPollPage.verifyPageLoaded();

    // Select "Suggestions" type
    await page.click('button:has-text("Suggestions")');

    // Enter poll title
    await page.fill('input[placeholder*="title"]', 'Suggestion Ownership Test');

    // Submit the poll
    await page.click('button:has-text("Submit")');

    // Wait for navigation to poll page
    await page.waitForTimeout(2000);
    const pollUrl = page.url();

    // Step 2: Browser 1 submits first suggestion
    // Wait for the voting interface to appear
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });

    // Add first suggestion using the first available text input
    const suggestionInput = page.locator('input[type="text"]').first();
    await suggestionInput.fill('First User Suggestion');

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

    // Second the existing suggestion from Browser 1
    await page2.click('button:has-text("First User Suggestion")');

    // Add own suggestion - find the first available text input for suggestions
    const newSuggestionInput = page2.locator('input[type="text"]').first();
    await newSuggestionInput.fill('Second User Suggestion');
    await page2.fill('input[placeholder*="name"]', 'User Two');
    await page2.click('button:has-text("Submit Vote")');
    await page2.waitForTimeout(3000);

    // Step 4: Verify Browser 1 edit mode shows correct ownership
    await page.reload();
    await page.waitForTimeout(2000);
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(1000);

    // Browser 1 should see their own suggestion in editable text field
    await expect(page.locator('label:has-text("Your suggestions:")')).toBeVisible();
    const browser1OwnInput = page.locator('input[value="First User Suggestion"]');
    await expect(browser1OwnInput).toBeVisible();

    // Browser 1 should see Browser 2's suggestion as a clickable button (not editable)
    const browser2SuggestionButton = page.locator('button:has-text("Second User Suggestion")');
    await expect(browser2SuggestionButton).toBeVisible();

    // Verify "Other suggestions" section exists
    await expect(page.locator('h5:has-text("Other suggestions")')).toBeVisible();

    // Browser 1 should NOT have an input field for Browser 2's suggestion
    const browser2Input = page.locator('input[value="Second User Suggestion"]');
    await expect(browser2Input).not.toBeVisible();

    // Step 5: Verify Browser 2 edit mode shows correct ownership
    await page2.click('button:has-text("Edit")');
    await page2.waitForTimeout(1000);

    // Browser 2 should see their own suggestion in editable text field
    await expect(page2.locator('label:has-text("Your suggestions:")')).toBeVisible();
    const browser2OwnInput = page2.locator('input[value="Second User Suggestion"]');
    await expect(browser2OwnInput).toBeVisible();

    // Browser 2 should see Browser 1's suggestion as a selected button (they seconded it)
    const browser1SuggestionButton = page2.locator('button:has-text("First User Suggestion")');
    await expect(browser1SuggestionButton).toBeVisible();

    // Verify it's selected (has green background)
    await expect(browser1SuggestionButton).toHaveClass(/bg-green/);

    // Browser 2 should NOT have an input field for Browser 1's suggestion
    const browser1Input = page2.locator('input[value="First User Suggestion"]');
    await expect(browser1Input).not.toBeVisible();

    // Step 6: Test that Browser 2 can deselect but not edit the seconded suggestion
    await browser1SuggestionButton.click();
    await expect(browser1SuggestionButton).not.toHaveClass(/bg-green/);

    // Re-select it
    await browser1SuggestionButton.click();
    await expect(browser1SuggestionButton).toHaveClass(/bg-green/);

    // Step 7: Test that only own suggestions can be modified
    // Browser 1 modifies their own suggestion
    await browser1OwnInput.fill('Modified First Suggestion');
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(3000);

    // Browser 2 modifies their own suggestion
    await browser2OwnInput.fill('Modified Second Suggestion');
    await page2.click('button:has-text("Submit Vote")');
    await page2.waitForTimeout(3000);

    // Step 8: Verify modifications are preserved correctly
    await page.reload();
    await page2.reload();
    await page.waitForTimeout(2000);
    await page2.waitForTimeout(2000);

    // Both browsers should see the updated suggestions
    await expect(page.locator('text="Modified First Suggestion"')).toBeVisible();
    await expect(page.locator('text="Modified Second Suggestion"')).toBeVisible();
    await expect(page2.locator('text="Modified First Suggestion"')).toBeVisible();
    await expect(page2.locator('text="Modified Second Suggestion"')).toBeVisible();

    // Original suggestions should no longer exist
    await expect(page.locator('text="First User Suggestion"')).not.toBeVisible();
    await expect(page.locator('text="Second User Suggestion"')).not.toBeVisible();

    // Step 9: Verify edit mode still maintains ownership after modifications
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(1000);

    // Browser 1 should still only see their modified suggestion as editable
    await expect(page.locator('input[value="Modified First Suggestion"]')).toBeVisible();
    await expect(page.locator('input[value="Modified Second Suggestion"]')).not.toBeVisible();
    await expect(page.locator('button:has-text("Modified Second Suggestion")')).toBeVisible();

    await page2.click('button:has-text("Edit")');
    await page2.waitForTimeout(1000);

    // Browser 2 should still only see their modified suggestion as editable
    await expect(page2.locator('input[value="Modified Second Suggestion"]')).toBeVisible();
    await expect(page2.locator('input[value="Modified First Suggestion"]')).not.toBeVisible();
    await expect(page2.locator('button:has-text("Modified First Suggestion")')).toBeVisible();

    await page.screenshot({ path: 'test-results/suggestion-ownership-browser1.png' });
    await page2.screenshot({ path: 'test-results/suggestion-ownership-browser2.png' });

    await context2.close();
  });

  test('should prevent users from accidentally editing others suggestions', async ({ page, browser }) => {
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

    // Browser 1 submits suggestion
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    const originalSuggestionInput = page.locator('input[type="text"]').first();
    await originalSuggestionInput.fill('Original Important Idea');
    await page.fill('input[placeholder*="name"]', 'Original Author');
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(3000);

    // Browser 2 seconds the suggestion
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

    // Browser 2 should only be able to add their own new suggestions
    await expect(page2.locator('label:has-text("Your suggestions:")')).toBeVisible();
    const newSuggestionInput = page2.locator('input[type="text"]').first();
    await newSuggestionInput.fill('My Own Idea');

    // Submit and verify both suggestions exist separately
    await page2.click('button:has-text("Submit Vote")');
    await page2.waitForTimeout(3000);

    // Both ideas should exist and be intact
    await expect(page2.locator('text="Original Important Idea"')).toBeVisible();
    await expect(page2.locator('text="My Own Idea"')).toBeVisible();

    // Verify Browser 1 still owns their original suggestion
    await page.reload();
    await page.waitForTimeout(2000);
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(1000);

    // Browser 1 should still be able to edit their original suggestion
    const originalOwnerInput = page.locator('input[value="Original Important Idea"]');
    await expect(originalOwnerInput).toBeVisible();

    // And see Browser 2's suggestion as a button
    await expect(page.locator('button:has-text("My Own Idea")')).toBeVisible();
    await expect(page.locator('input[value="My Own Idea"]')).not.toBeVisible();

    await context2.close();
  });
});
