import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreatePollPage } from '../pages/CreatePollPage';
import { PollPage } from '../pages/PollPage';
import { testPolls, getTomorrowDate, getOneHourFromNow } from '../fixtures/test-data';

test.describe('Nomination Poll Editing', () => {
  test('should create nomination poll with default nominations and show edit functionality', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    const pollPage = new PollPage(page);
    
    // Navigate to create poll page
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    await createPollPage.verifyPageLoaded();
    
    // Create nomination poll with default nominations (creator's initial vote)
    const pollData = {
      title: 'Restaurant recommendations with defaults',
      type: 'nomination' as const,
      options: ['Italian Place Downtown', 'Sushi Bar', 'Thai Restaurant'],
      deadline: '10min',
      creatorName: 'Food Lover'
    };
    
    await createPollPage.createPoll(pollData);
    
    // Verify redirect to poll page
    await createPollPage.verifyRedirectToPoll();
    await pollPage.verifyPollLoaded(pollData.title);
    
    // Wait for page to fully load and check if we're in "has voted" state
    await page.waitForTimeout(2000);
    
    // Should show "All nominations:" with creator's nominations displayed
    await expect(page.locator('text="All nominations:"')).toBeVisible();
    
    // Verify creator's default nominations are shown
    await expect(page.locator('text="Italian Place Downtown"')).toBeVisible();
    await expect(page.locator('text="Sushi Bar"')).toBeVisible();
    await expect(page.locator('text="Thai Restaurant"')).toBeVisible();
    
    // Verify Edit button is present and enabled (creator should be able to edit)
    const editButton = page.locator('button:has-text("Edit")');
    await expect(editButton).toBeVisible();
    await expect(editButton).toBeEnabled();
    
    await page.screenshot({ path: 'test-results/nomination-with-defaults-created.png' });
  });

  test('should allow editing nominations and persist changes', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    const pollPage = new PollPage(page);
    
    // Create nomination poll with initial nominations
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    const pollData = {
      title: 'Editable Nomination Poll',
      type: 'nomination' as const,
      options: ['Option A', 'Option B'],
      deadline: '10min',
      creatorName: 'Test Creator'
    };
    
    await createPollPage.createPoll(pollData);
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(2000);
    
    // Click Edit button
    const editButton = page.locator('button:has-text("Edit")');
    await editButton.click();
    
    // Should now be in edit mode - verify we can see input fields
    await expect(page.locator('text="Add new nominations:"')).toBeVisible();
    
    // The existing nominations should be pre-filled in input fields
    const inputs = page.locator('input[type="text"]');
    
    // Verify existing nominations are in input fields
    await expect(inputs.nth(0)).toHaveValue('Option A');
    await expect(inputs.nth(1)).toHaveValue('Option B');
    
    // Edit the nominations - change first option and add a new one
    await inputs.nth(0).fill('Updated Option A');
    await inputs.nth(2).fill('New Option C');
    
    // Submit the edited vote
    const submitButton = page.locator('button:has-text("Submit Vote")');
    await submitButton.click();
    
    // Handle confirmation modal
    const modalSubmitButton = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    await modalSubmitButton.click();
    
    // Wait for submission to complete
    await page.waitForTimeout(3000);
    
    // Should return to view mode and show updated nominations
    await expect(page.locator('text="All nominations:"')).toBeVisible();
    await expect(page.locator('text="Updated Option A"')).toBeVisible();
    await expect(page.locator('text="Option B"')).toBeVisible();
    await expect(page.locator('text="New Option C"')).toBeVisible();
    
    // Original "Option A" should no longer be visible
    await expect(page.locator('text="Option A"').first()).not.toBeVisible();
    
    await page.screenshot({ path: 'test-results/nomination-edited-successfully.png' });
  });

  test('should allow selecting/unselecting others nominations in edit mode', async ({ page, browser }) => {
    // This test requires simulating multiple users, so we'll use two browser contexts
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    const pollPage = new PollPage(page);
    
    // Creator creates poll with initial nominations
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    const pollData = {
      title: 'Multi-User Nomination Test',
      type: 'nomination' as const,
      options: ['Creator Option 1', 'Creator Option 2'],
      deadline: '10min',
      creatorName: 'Creator'
    };
    
    await createPollPage.createPoll(pollData);
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(2000);
    
    // Get the poll URL for the second user
    const pollUrl = page.url();
    
    // Second user adds their nominations
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(pollUrl);
    await page2.waitForTimeout(2000);
    
    // Second user should see existing nominations and be able to vote
    await expect(page2.locator('text="Existing nominations"')).toBeVisible();
    
    // Select existing nominations and add new ones
    const creatorOption1 = page2.locator('text="Creator Option 1"');
    await creatorOption1.click();
    
    // Add their own nomination
    const newNominationInput = page2.locator('input[type="text"]').first();
    await newNominationInput.fill('Second User Option');
    
    // Fill voter name and submit
    await page2.fill('input[placeholder*="name"]', 'Second User');
    await page2.click('button:has-text("Submit Vote")');
    await page2.waitForTimeout(2000);
    
    // Now go back to creator and test editing with ability to unselect others' nominations
    await page.reload();
    await page.waitForTimeout(2000);
    
    // Click Edit button
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(1000);
    
    // Should see "Other nominations" section with second user's nomination
    await expect(page.locator('text="Other nominations"')).toBeVisible();
    await expect(page.locator('text="Second User Option"')).toBeVisible();
    
    // Should be able to select/unselect the other user's nomination
    const otherNomination = page.locator('button:has-text("Second User Option")');
    
    // Click to select it
    await otherNomination.click();
    await expect(otherNomination).toHaveClass(/bg-green/);
    
    // Click to unselect it
    await otherNomination.click();
    await expect(otherNomination).not.toHaveClass(/bg-green/);
    
    await page.screenshot({ path: 'test-results/nomination-unselect-others.png' });
    
    await context2.close();
  });

  test('should show changes to other users in real-time', async ({ page, browser }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Creator creates poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    const pollData = {
      title: 'Real-time Changes Test',
      type: 'nomination' as const,
      options: ['Initial Option'],
      deadline: '10min',
      creatorName: 'Creator'
    };
    
    await createPollPage.createPoll(pollData);
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(2000);
    
    const pollUrl = page.url();
    
    // Second user opens the same poll
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(pollUrl);
    await page2.waitForTimeout(2000);
    
    // Second user should see the initial option
    await expect(page2.locator('text="Initial Option"')).toBeVisible();
    
    // Creator edits their nomination
    await page.click('button:has-text("Edit")');
    await page.waitForTimeout(1000);
    
    // Change the nomination
    const input = page.locator('input[type="text"]').first();
    await input.fill('Changed Option');
    
    // Submit the change
    await page.click('button:has-text("Submit Vote")');
    await page.waitForTimeout(2000);
    
    // Verify creator sees the change
    await expect(page.locator('text="Changed Option"')).toBeVisible();
    await expect(page.locator('text="Initial Option"')).not.toBeVisible();
    
    // Second user reloads and should see the change
    await page2.reload();
    await page2.waitForTimeout(2000);
    
    await expect(page2.locator('text="Changed Option"')).toBeVisible();
    await expect(page2.locator('text="Initial Option"')).not.toBeVisible();
    
    await page.screenshot({ path: 'test-results/nomination-changes-creator-view.png' });
    await page2.screenshot({ path: 'test-results/nomination-changes-other-user-view.png' });
    
    await context2.close();
  });

  test('should hide edit button when poll is closed', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Create nomination poll with short deadline (1 minute for testing)
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    const pollData = {
      title: 'Poll to be Closed',
      type: 'nomination' as const,
      options: ['Test Option'],
      deadline: '10min', // We'll close it manually
      creatorName: 'Creator'
    };
    
    await createPollPage.createPoll(pollData);
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(2000);
    
    // Verify Edit button is initially present
    const editButton = page.locator('button:has-text("Edit")');
    await expect(editButton).toBeVisible();
    
    // Close the poll manually (creator action)
    const closeButton = page.locator('button:has-text("Close Poll")');
    await expect(closeButton).toBeVisible();
    await closeButton.click();
    
    // Wait for poll to close
    await page.waitForTimeout(3000);
    
    // Verify poll is closed
    await expect(page.locator('text="Poll Closed"')).toBeVisible();
    
    // Edit button should no longer be visible
    await expect(editButton).not.toBeVisible();
    
    // But nominations should still be visible in read-only mode
    await expect(page.locator('text="Test Option"')).toBeVisible();
    
    await page.screenshot({ path: 'test-results/nomination-poll-closed-no-edit.png' });
  });
});