import { test, expect } from '@playwright/test';

test.describe('Nomination Poll Edit - Seconding Others', () => {
  test('should allow seconding other nominations when editing ballot', async ({ page, context }) => {
    // Create a nomination poll
    await page.goto('http://localhost:3000/create-poll');
    
    // Wait for page to load
    await page.waitForSelector('input[placeholder="Enter your title..."]');
    
    // Ensure nomination type is selected (it should be default)
    const nominationButton = page.locator('button[role="radio"][aria-checked="true"]').filter({ hasText: 'Suggestions' });
    await expect(nominationButton).toBeVisible();
    
    // Fill poll details
    await page.fill('input[placeholder="Enter your title..."]', 'Test Nomination Edit Seconding');
    
    // Submit the poll
    await page.click('button:has-text("Create Poll")');
    
    // Wait for navigation to poll page
    await page.waitForURL(/\/p\/.+/);
    const pollUrl = page.url();
    console.log('Created poll:', pollUrl);
    
    // First user submits two nominations
    await page.fill('input[placeholder="Enter a nomination"]', 'First user idea 1');
    await page.locator('button:has-text("Add")').click();
    
    await page.fill('input[placeholder="Enter a nomination"]', 'First user idea 2');
    await page.locator('button:has-text("Add")').click();
    
    // Submit the vote
    await page.click('button:has-text("Submit Vote")');
    
    // Wait for success
    await page.waitForSelector('text=/All nominations:/i');
    
    // Verify first user's nominations are displayed
    await expect(page.locator('text="First user idea 1"')).toBeVisible();
    await expect(page.locator('text="First user idea 2"')).toBeVisible();
    
    // Open in new incognito context (second browser)
    const context2 = await context.browser()?.newContext() || context;
    const page2 = await context2.newPage();
    await page2.goto(pollUrl);
    
    // Second user should see existing nominations as buttons
    await expect(page2.locator('h5:has-text("Existing nominations (select to second):")')).toBeVisible();
    await expect(page2.locator('button:has-text("First user idea 1")')).toBeVisible();
    await expect(page2.locator('button:has-text("First user idea 2")')).toBeVisible();
    
    // Second user seconds one existing and adds one new
    await page2.click('button:has-text("First user idea 1")');
    
    // Verify the button shows as selected (green background)
    const selectedButton = page2.locator('button:has-text("First user idea 1")');
    await expect(selectedButton).toHaveClass(/bg-green-100/);
    
    // Add a new nomination
    await page2.fill('input[placeholder="Enter a nomination"]', 'Second user new idea');
    await page2.locator('button:has-text("Add")').click();
    
    // Submit the vote
    await page2.click('button:has-text("Submit Vote")');
    
    // Wait for success
    await page2.waitForSelector('text=/All nominations:/i');
    
    // Verify second user sees all nominations
    await expect(page2.locator('text="First user idea 1"')).toBeVisible();
    await expect(page2.locator('text="First user idea 2"')).toBeVisible();
    await expect(page2.locator('text="Second user new idea"')).toBeVisible();
    
    // Now second user clicks Edit
    await page2.click('button:has-text("Edit")');
    
    // CRITICAL: Verify edit mode shows the correct interface
    // Should see "Other nominations (select to second):" with buttons for all existing nominations
    await expect(page2.locator('h5:has-text("Other nominations (select to second):")')).toBeVisible();
    
    // All existing nominations should be shown as buttons
    const firstIdeaButton = page2.locator('button:has-text("First user idea 1")');
    const secondIdeaButton = page2.locator('button:has-text("First user idea 2")');
    
    await expect(firstIdeaButton).toBeVisible();
    await expect(secondIdeaButton).toBeVisible();
    
    // First user idea 1 should be pre-selected (green) since user seconded it
    await expect(firstIdeaButton).toHaveClass(/bg-green-100/);
    
    // First user idea 2 should NOT be selected (white/gray) since user didn't second it
    await expect(secondIdeaButton).toHaveClass(/bg-white/);
    
    // User's own nomination should be in text field for editing
    const nominationInput = page2.locator('input[value="Second user new idea"]');
    await expect(nominationInput).toBeVisible();
    
    // Now second user can select the nomination they hadn't seconded before
    await page2.click('button:has-text("First user idea 2")');
    
    // Verify it's now selected
    await expect(secondIdeaButton).toHaveClass(/bg-green-100/);
    
    // User can also unselect the one they had seconded
    await page2.click('button:has-text("First user idea 1")');
    
    // Verify it's now unselected
    await expect(firstIdeaButton).toHaveClass(/bg-white/);
    
    // Edit their own nomination
    await nominationInput.clear();
    await nominationInput.fill('Second user edited idea');
    
    // Submit the edited vote
    await page2.click('button:has-text("Submit Vote")');
    
    // Wait for success
    await page2.waitForSelector('text=/All nominations:/i');
    
    // Verify the changes were saved
    await expect(page2.locator('text="Second user edited idea"')).toBeVisible();
    await expect(page2.locator('text="First user idea 2"')).toBeVisible();
    
    // First user idea 1 should no longer be in user's nominations (blue circle indicator)
    const firstIdeaElement = page2.locator('div:has-text("First user idea 1")');
    const blueCircle = firstIdeaElement.locator('.bg-blue-500');
    await expect(blueCircle).not.toBeVisible();
    
    // Clean up
    await context2.close();
  });
  
  test('should preserve distinction between created and seconded nominations', async ({ page, context }) => {
    // Create a nomination poll
    await page.goto('http://localhost:3000/create-poll');
    
    await page.waitForSelector('input[placeholder="Enter your title..."]');
    await page.fill('input[placeholder="Enter your title..."]', 'Test Created vs Seconded');
    await page.click('button:has-text("Create Poll")');
    
    await page.waitForURL(/\/p\/.+/);
    const pollUrl = page.url();
    
    // First user creates nomination
    await page.fill('input[placeholder="Enter a nomination"]', 'Original idea');
    await page.locator('button:has-text("Add")').click();
    await page.click('button:has-text("Submit Vote")');
    await page.waitForSelector('text=/All nominations:/i');
    
    // Second user seconds it and adds their own
    const context2 = await context.browser()?.newContext() || context;
    const page2 = await context2.newPage();
    await page2.goto(pollUrl);
    
    // Second the existing nomination
    await page2.click('button:has-text("Original idea")');
    
    // Add own nomination
    await page2.fill('input[placeholder="Enter a nomination"]', 'My own idea');
    await page2.locator('button:has-text("Add")').click();
    await page2.click('button:has-text("Submit Vote")');
    await page2.waitForSelector('text=/All nominations:/i');
    
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