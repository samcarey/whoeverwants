import { test, expect } from '@playwright/test';

test.describe('Suggestion Question Edit - Seconding Others', () => {
  test('should allow seconding other suggestions when editing ballot', async ({ page, context }) => {
    // Create a suggestion question
    await page.goto('http://localhost:3000/create-question');

    // Wait for page to load
    await page.waitForSelector('input[placeholder="Enter your title..."]');

    // Ensure suggestion type is selected (it should be default)
    const suggestionButton = page.locator('button[role="radio"][aria-checked="true"]').filter({ hasText: 'Suggestions' });
    await expect(suggestionButton).toBeVisible();

    // Fill question details
    await page.fill('input[placeholder="Enter your title..."]', 'Test Suggestion Edit Seconding');

    // Submit the question
    await page.click('button:has-text("Create Question")');

    // Wait for navigation to question page
    await page.waitForURL(/\/p\/.+/);
    const questionUrl = page.url();
    console.log('Created question:', questionUrl);

    // First user submits two suggestions
    await page.fill('input[placeholder="Enter a suggestion"]', 'First user idea 1');
    await page.locator('button:has-text("Add")').click();

    await page.fill('input[placeholder="Enter a suggestion"]', 'First user idea 2');
    await page.locator('button:has-text("Add")').click();

    // Submit the vote
    await page.click('button:has-text("Submit Vote")');

    // Wait for success
    await page.waitForSelector('text=/All suggestions:/i');

    // Verify first user's suggestions are displayed
    await expect(page.locator('text="First user idea 1"')).toBeVisible();
    await expect(page.locator('text="First user idea 2"')).toBeVisible();

    // Open in new incognito context (second browser)
    const context2 = await context.browser()?.newContext() || context;
    const page2 = await context2.newPage();
    await page2.goto(questionUrl);

    // Second user should see existing suggestions as buttons
    await expect(page2.locator('h5:has-text("Existing suggestions (select to second):")')).toBeVisible();
    await expect(page2.locator('button:has-text("First user idea 1")')).toBeVisible();
    await expect(page2.locator('button:has-text("First user idea 2")')).toBeVisible();

    // Second user seconds one existing and adds one new
    await page2.click('button:has-text("First user idea 1")');

    // Verify the button shows as selected (green background)
    const selectedButton = page2.locator('button:has-text("First user idea 1")');
    await expect(selectedButton).toHaveClass(/bg-green-100/);

    // Add a new suggestion
    await page2.fill('input[placeholder="Enter a suggestion"]', 'Second user new idea');
    await page2.locator('button:has-text("Add")').click();

    // Submit the vote
    await page2.click('button:has-text("Submit Vote")');

    // Wait for success
    await page2.waitForSelector('text=/All suggestions:/i');

    // Verify second user sees all suggestions
    await expect(page2.locator('text="First user idea 1"')).toBeVisible();
    await expect(page2.locator('text="First user idea 2"')).toBeVisible();
    await expect(page2.locator('text="Second user new idea"')).toBeVisible();

    // Now second user clicks Edit
    await page2.click('button:has-text("Edit")');

    // CRITICAL: Verify edit mode shows the correct interface
    // Should see "Other suggestions (select to second):" with buttons for all existing suggestions
    await expect(page2.locator('h5:has-text("Other suggestions (select to second):")')).toBeVisible();

    // All existing suggestions should be shown as buttons
    const firstIdeaButton = page2.locator('button:has-text("First user idea 1")');
    const secondIdeaButton = page2.locator('button:has-text("First user idea 2")');

    await expect(firstIdeaButton).toBeVisible();
    await expect(secondIdeaButton).toBeVisible();

    // First user idea 1 should be pre-selected (green) since user seconded it
    await expect(firstIdeaButton).toHaveClass(/bg-green-100/);

    // First user idea 2 should NOT be selected (white/gray) since user didn't second it
    await expect(secondIdeaButton).toHaveClass(/bg-white/);

    // User's own suggestion should be in text field for editing
    const suggestionInput = page2.locator('input[value="Second user new idea"]');
    await expect(suggestionInput).toBeVisible();

    // Now second user can select the suggestion they hadn't seconded before
    await page2.click('button:has-text("First user idea 2")');

    // Verify it's now selected
    await expect(secondIdeaButton).toHaveClass(/bg-green-100/);

    // User can also unselect the one they had seconded
    await page2.click('button:has-text("First user idea 1")');

    // Verify it's now unselected
    await expect(firstIdeaButton).toHaveClass(/bg-white/);

    // Edit their own suggestion
    await suggestionInput.clear();
    await suggestionInput.fill('Second user edited idea');

    // Submit the edited vote
    await page2.click('button:has-text("Submit Vote")');

    // Wait for success
    await page2.waitForSelector('text=/All suggestions:/i');

    // Verify the changes were saved
    await expect(page2.locator('text="Second user edited idea"')).toBeVisible();
    await expect(page2.locator('text="First user idea 2"')).toBeVisible();

    // First user idea 1 should no longer be in user's suggestions (blue circle indicator)
    const firstIdeaElement = page2.locator('div:has-text("First user idea 1")');
    const blueCircle = firstIdeaElement.locator('.bg-blue-500');
    await expect(blueCircle).not.toBeVisible();

    // Clean up
    await context2.close();
  });

  test('should preserve distinction between created and seconded suggestions', async ({ page, context }) => {
    // Create a suggestion question
    await page.goto('http://localhost:3000/create-question');

    await page.waitForSelector('input[placeholder="Enter your title..."]');
    await page.fill('input[placeholder="Enter your title..."]', 'Test Created vs Seconded');
    await page.click('button:has-text("Create Question")');

    await page.waitForURL(/\/p\/.+/);
    const questionUrl = page.url();

    // First user creates suggestion
    await page.fill('input[placeholder="Enter a suggestion"]', 'Original idea');
    await page.locator('button:has-text("Add")').click();
    await page.click('button:has-text("Submit Vote")');
    await page.waitForSelector('text=/All suggestions:/i');

    // Second user seconds it and adds their own
    const context2 = await context.browser()?.newContext() || context;
    const page2 = await context2.newPage();
    await page2.goto(questionUrl);

    // Second the existing suggestion
    await page2.click('button:has-text("Original idea")');

    // Add own suggestion
    await page2.fill('input[placeholder="Enter a suggestion"]', 'My own idea');
    await page2.locator('button:has-text("Add")').click();
    await page2.click('button:has-text("Submit Vote")');
    await page2.waitForSelector('text=/All suggestions:/i');

    // Edit mode
    await page2.click('button:has-text("Edit")');

    // "Original idea" should appear as a selectable button (pre-selected)
    const originalIdeaButton = page2.locator('button:has-text("Original idea")');
    await expect(originalIdeaButton).toBeVisible();
    await expect(originalIdeaButton).toHaveClass(/bg-green-100/);

    // "My own idea" should appear as an editable text field
    const myIdeaInput = page2.locator('input[value="My own idea"]');
    await expect(myIdeaInput).toBeVisible();

    // User should NOT see their own idea as a button
    const myIdeaButton = page2.locator('button:has-text("My own idea")');
    await expect(myIdeaButton).not.toBeVisible();

    await context2.close();
  });
});
