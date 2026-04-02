import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreatePollPage } from '../pages/CreatePollPage';

test.describe('Suggestion Poll Creator Workflow', () => {
  test('should not show options field for suggestion polls and allow creator to vote after creation', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);

    // Navigate to create poll page
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    await createPollPage.verifyPageLoaded();

    // Fill in basic poll details
    await createPollPage.fillTitle('Creator Suggestion Test Poll');
    await createPollPage.fillCreatorName('Test Creator');
    await createPollPage.selectDeadline('10min');

    // Initially, Poll type should be selected (not Suggestion)
    // Verify options field is visible for regular polls
    const optionsLabel = page.locator('text="Poll Options"');
    await expect(optionsLabel).toBeVisible();

    // Switch to Suggestion poll type
    await createPollPage.selectPollType('suggestion');

    // CRITICAL TEST: Options field should now be HIDDEN for suggestion polls
    await expect(optionsLabel).not.toBeVisible();

    // There should be no input fields for initial suggestions
    const optionInputs = page.locator('input[placeholder*="Add an option"]');
    await expect(optionInputs).toHaveCount(0);

    await page.screenshot({ path: 'test-results/creator-workflow-01-no-options-field.png' });

    // Submit the poll without any initial suggestions
    await createPollPage.submitPoll();
    await createPollPage.confirmSubmission();

    // Wait for redirect to poll page
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);

    const pollUrl = page.url();
    console.log('Created suggestion poll at:', pollUrl);

    // Creator should see voting interface, NOT results view
    await expect(page.locator('text="Add new suggestions:"')).toBeVisible();
    await expect(page.locator('text="Abstain"')).toBeVisible();

    // Creator should NOT see "All suggestions:" (which would indicate results view)
    await expect(page.locator('text="All suggestions:"')).not.toBeVisible();

    await page.screenshot({ path: 'test-results/creator-workflow-02-voting-interface.png' });

    // Test creator can vote with suggestions
    const suggestionInputs = page.locator('input[type="text"]');
    await suggestionInputs.nth(0).fill('Creator Suggestion 1');
    await suggestionInputs.nth(1).fill('Creator Suggestion 2');
    await suggestionInputs.nth(2).fill('Creator Suggestion 3');

    // Set voter name
    const voterNameInput = page.locator('input[placeholder*="Enter your name"]');
    await voterNameInput.fill('Creator Voter Name');

    // Submit vote
    const submitButton = page.locator('button:has-text("Submit Vote")');
    await submitButton.click();

    // Handle confirmation modal if present
    const modalSubmitButton = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalSubmitButton.isVisible({ timeout: 2000 })) {
      await modalSubmitButton.click();
    }

    await page.waitForTimeout(3000);

    // Now creator should see results view with their suggestions
    await expect(page.locator('text="All suggestions:"')).toBeVisible();
    await expect(page.locator('text="Creator Suggestion 1"')).toBeVisible();
    await expect(page.locator('text="Creator Suggestion 2"')).toBeVisible();
    await expect(page.locator('text="Creator Suggestion 3"')).toBeVisible();

    // Creator should have Edit button
    const editButton = page.locator('button:has-text("Edit")');
    await expect(editButton).toBeVisible();

    await page.screenshot({ path: 'test-results/creator-workflow-03-after-voting.png' });
  });

  test('creator can edit their vote to add more suggestions', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);

    // Create a suggestion poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();

    await createPollPage.fillTitle('Edit Suggestions Test');
    await createPollPage.selectPollType('suggestion');
    await createPollPage.selectDeadline('10min');
    await createPollPage.fillCreatorName('Edit Test Creator');

    await createPollPage.submitPoll();
    await createPollPage.confirmSubmission();

    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);

    // Vote with initial suggestions
    const suggestionInputs = page.locator('input[type="text"]');
    await suggestionInputs.nth(0).fill('Initial Suggestion 1');
    await suggestionInputs.nth(1).fill('Initial Suggestion 2');

    const submitButton = page.locator('button:has-text("Submit Vote")');
    await submitButton.click();

    const modalSubmitButton = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalSubmitButton.isVisible({ timeout: 2000 })) {
      await modalSubmitButton.click();
    }

    await page.waitForTimeout(3000);

    // Click Edit to modify vote
    const editButton = page.locator('button:has-text("Edit")');
    await editButton.click();
    await page.waitForTimeout(2000);

    // Should be back in voting mode with existing suggestions pre-filled
    await expect(page.locator('text="Add new suggestions:"')).toBeVisible();

    // Add a third suggestion
    const editInputs = page.locator('input[type="text"]');
    const emptyInput = editInputs.nth(2);
    await emptyInput.fill('Added Suggestion 3');

    await page.screenshot({ path: 'test-results/creator-workflow-04-editing-vote.png' });

    // Submit updated vote
    const updateButton = page.locator('button:has-text("Submit Vote")');
    await updateButton.click();

    const modalUpdateButton = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalUpdateButton.isVisible({ timeout: 2000 })) {
      await modalUpdateButton.click();
    }

    await page.waitForTimeout(3000);

    // Verify all three suggestions are now visible
    await expect(page.locator('text="Initial Suggestion 1"')).toBeVisible();
    await expect(page.locator('text="Initial Suggestion 2"')).toBeVisible();
    await expect(page.locator('text="Added Suggestion 3"')).toBeVisible();

    await page.screenshot({ path: 'test-results/creator-workflow-05-after-edit.png' });
  });

  test('creator can abstain by removing all suggestions', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);

    // Create a suggestion poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();

    await createPollPage.fillTitle('Abstain Test Poll');
    await createPollPage.selectPollType('suggestion');
    await createPollPage.selectDeadline('10min');
    await createPollPage.fillCreatorName('Abstain Test Creator');

    await createPollPage.submitPoll();
    await createPollPage.confirmSubmission();

    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);

    // Initially vote with suggestions
    const suggestionInputs = page.locator('input[type="text"]');
    await suggestionInputs.nth(0).fill('Temporary Suggestion 1');
    await suggestionInputs.nth(1).fill('Temporary Suggestion 2');

    const submitButton = page.locator('button:has-text("Submit Vote")');
    await submitButton.click();

    const modalSubmitButton = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalSubmitButton.isVisible({ timeout: 2000 })) {
      await modalSubmitButton.click();
    }

    await page.waitForTimeout(3000);

    // Verify suggestions are visible
    await expect(page.locator('text="Temporary Suggestion 1"')).toBeVisible();
    await expect(page.locator('text="Temporary Suggestion 2"')).toBeVisible();

    // Click Edit to change vote
    const editButton = page.locator('button:has-text("Edit")');
    await editButton.click();
    await page.waitForTimeout(2000);

    // Clear all suggestions - only clear the ones with values, skip voter name field
    const editSuggestionInputs = page.locator('input[type="text"]:not([placeholder*="name"]):not([placeholder*="Name"])');
    const count = await editSuggestionInputs.count();
    console.log(`Found ${count} suggestion inputs to clear`);

    for (let i = 0; i < count; i++) {
      const input = editSuggestionInputs.nth(i);
      try {
        const value = await input.inputValue({ timeout: 2000 });
        if (value && value.trim()) {
          console.log(`Clearing input ${i}: "${value}"`);
          await input.fill('');
        }
      } catch (error) {
        console.log(`Skipping input ${i} - not accessible:`, (error as Error).message);
        break;
      }
    }

    await page.waitForTimeout(1000);

    // Abstain button should now be enabled
    const abstainButton = page.locator('button:has-text("Abstain")');
    await expect(abstainButton).toBeEnabled();

    // Click abstain
    await abstainButton.click();

    // Should show abstaining state
    await expect(page.locator('text="Abstaining (click to cancel)"')).toBeVisible();

    await page.screenshot({ path: 'test-results/creator-workflow-06-abstaining.png' });

    // Submit abstain vote
    const abstainSubmitButton = page.locator('button:has-text("Submit Vote")');
    await abstainSubmitButton.click();

    const modalAbstainButton = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalAbstainButton.isVisible({ timeout: 2000 })) {
      await modalAbstainButton.click();
    }

    await page.waitForTimeout(3000);

    // Should see abstained state
    await expect(page.locator('text="You abstained from this vote"')).toBeVisible();

    await page.screenshot({ path: 'test-results/creator-workflow-07-abstained.png' });
  });

  test('options field is completely hidden when suggestion poll is selected', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);

    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    await createPollPage.verifyPageLoaded();

    // Start with Poll type
    const pollTypeButton = page.locator('button:has-text("Poll")').first();
    await expect(pollTypeButton).toBeVisible();

    // Options field should be visible for regular polls
    await expect(page.locator('text="Poll Options"')).toBeVisible();
    const optionInputs = page.locator('input[placeholder*="Add an option"], input[placeholder*="Add another option"]');
    const initialCount = await optionInputs.count();
    expect(initialCount).toBeGreaterThan(0);

    // Switch to Suggestion type
    await createPollPage.selectPollType('suggestion');

    // Options field should be completely hidden
    await expect(page.locator('text="Poll Options"')).not.toBeVisible();
    await expect(page.locator('text="Starting Options"')).not.toBeVisible();

    // No option input fields should exist
    const suggestionOptionInputs = page.locator('input[placeholder*="Add an option"], input[placeholder*="Add another option"]');
    await expect(suggestionOptionInputs).toHaveCount(0);

    // Switch back to Poll type
    await createPollPage.selectPollType('poll');

    // Options field should reappear
    await expect(page.locator('text="Poll Options"')).toBeVisible();
    const reappearedInputs = page.locator('input[placeholder*="Add an option"], input[placeholder*="Add another option"]');
    const finalCount = await reappearedInputs.count();
    expect(finalCount).toBeGreaterThan(0);

    await page.screenshot({ path: 'test-results/creator-workflow-08-toggle-poll-types.png' });
  });
});
