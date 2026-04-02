import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreatePollPage } from '../pages/CreatePollPage';

test.describe('Suggestion Edit Refresh Issue', () => {
  test('should immediately show updated suggestions after edit without page refresh', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);

    // Create suggestion poll with initial suggestions
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    await createPollPage.verifyPageLoaded();

    const pollData = {
      title: 'Refresh Test Poll',
      type: 'suggestion' as const,
      options: ['Initial Option 1', 'Initial Option 2'],
      deadline: '10min',
      creatorName: 'Refresh Test User'
    };

    await createPollPage.createPoll(pollData);
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);

    // Verify initial state shows original suggestions
    await expect(page.locator('text="All suggestions:"')).toBeVisible();
    await expect(page.locator('text="Initial Option 1"')).toBeVisible();
    await expect(page.locator('text="Initial Option 2"')).toBeVisible();

    await page.screenshot({ path: 'test-results/refresh-01-initial-suggestions.png' });

    // Click Edit
    const editButton = page.locator('button:has-text("Edit")');
    await editButton.click();
    await page.waitForTimeout(2000);

    // Verify in edit mode
    await expect(page.locator('text="Add new suggestions:"')).toBeVisible();

    // Edit the suggestions - change first option
    const inputs = page.locator('input[type="text"]');
    await inputs.nth(0).fill('Updated Option 1');
    await inputs.nth(1).fill('Updated Option 2');

    await page.screenshot({ path: 'test-results/refresh-02-in-edit-mode.png' });

    // Submit the changes
    const submitButton = page.locator('button:has-text("Submit Vote")');
    await submitButton.click();

    // Handle confirmation modal if present
    const modalSubmitButton = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalSubmitButton.isVisible({ timeout: 2000 })) {
      await modalSubmitButton.click();
    }

    // Wait for submission
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'test-results/refresh-03-after-submit.png' });

    // The page should now show updated suggestions WITHOUT requiring refresh
    // Test expectation: Updated suggestions should be visible immediately
    await expect(page.locator('text="All suggestions:"')).toBeVisible();

    const updatedOption1 = page.locator('text="Updated Option 1"');
    const updatedOption2 = page.locator('text="Updated Option 2"');
    const oldOption1 = page.locator('text="Initial Option 1"');

    // Test that updated suggestions appear immediately
    await expect(updatedOption1).toBeVisible({ timeout: 5000 });
    await expect(updatedOption2).toBeVisible({ timeout: 5000 });

    // Test that old suggestions are gone
    await expect(oldOption1).not.toBeVisible();

    await page.screenshot({ path: 'test-results/refresh-04-updated-suggestions-visible.png' });

    // Additional verification: Page should show the updated state without manual refresh
    const pageUrl = page.url();
    console.log('Current URL after edit:', pageUrl);

    // Verify we're not in edit mode anymore (returned to view mode)
    await expect(page.locator('text="Add new suggestions:"')).not.toBeVisible();
    await expect(editButton).toBeVisible(); // Edit button should be back
  });

  test('should show updated suggestions to other users immediately after edit', async ({ page, browser }) => {
    // This test simulates two users - creator and observer
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);

    // Creator creates poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();

    const pollData = {
      title: 'Multi-User Refresh Test',
      type: 'suggestion' as const,
      options: ['Creator Option A', 'Creator Option B'],
      deadline: '10min',
      creatorName: 'Creator User'
    };

    await createPollPage.createPoll(pollData);
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);

    const pollUrl = page.url();

    // Second user (observer) opens the same poll
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(pollUrl);
    await page2.waitForTimeout(3000);

    // Observer should see initial suggestions
    await expect(page2.locator('text="Creator Option A"')).toBeVisible();
    await expect(page2.locator('text="Creator Option B"')).toBeVisible();

    await page2.screenshot({ path: 'test-results/refresh-observer-01-initial.png' });

    // Creator edits their suggestions
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(2000);

    const inputs = page.locator('input[type="text"]');
    await inputs.nth(0).fill('Modified Option A');
    await inputs.nth(1).fill('Modified Option B');

    await page.click('button:has-text("Submit Vote")');

    // Handle modal
    const modalSubmitButton = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalSubmitButton.isVisible({ timeout: 2000 })) {
      await modalSubmitButton.click();
    }

    await page.waitForTimeout(3000);

    // Observer refreshes their page to see changes (simulating real user behavior)
    await page2.reload();
    await page2.waitForTimeout(3000);

    // Observer should now see updated suggestions
    await expect(page2.locator('text="Modified Option A"')).toBeVisible();
    await expect(page2.locator('text="Modified Option B"')).toBeVisible();
    await expect(page2.locator('text="Creator Option A"')).not.toBeVisible();

    await page2.screenshot({ path: 'test-results/refresh-observer-02-updated.png' });

    await context2.close();
  });
});
