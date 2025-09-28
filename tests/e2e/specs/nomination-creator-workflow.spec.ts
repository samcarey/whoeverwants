import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreatePollPage } from '../pages/CreatePollPage';

test.describe('Nomination Poll Creator Workflow', () => {
  test('should not show options field for nomination polls and allow creator to vote after creation', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Navigate to create poll page
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    await createPollPage.verifyPageLoaded();
    
    // Fill in basic poll details
    await createPollPage.fillTitle('Creator Nomination Test Poll');
    await createPollPage.fillCreatorName('Test Creator');
    await createPollPage.selectDeadline('10min');
    
    // Initially, Poll type should be selected (not Nomination)
    // Verify options field is visible for regular polls
    const optionsLabel = page.locator('text="Poll Options"');
    await expect(optionsLabel).toBeVisible();
    
    // Switch to Nomination poll type
    await createPollPage.selectPollType('nomination');
    
    // CRITICAL TEST: Options field should now be HIDDEN for nomination polls
    await expect(optionsLabel).not.toBeVisible();
    
    // There should be no input fields for initial nominations
    const optionInputs = page.locator('input[placeholder*="Add an option"]');
    await expect(optionInputs).toHaveCount(0);
    
    await page.screenshot({ path: 'test-results/creator-workflow-01-no-options-field.png' });
    
    // Submit the poll without any initial nominations
    await createPollPage.submitPoll();
    await createPollPage.confirmSubmission();
    
    // Wait for redirect to poll page
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);
    
    const pollUrl = page.url();
    console.log('Created nomination poll at:', pollUrl);
    
    // Creator should see voting interface, NOT results view
    await expect(page.locator('text="Add new nominations:"')).toBeVisible();
    await expect(page.locator('text="Abstain"')).toBeVisible();
    
    // Creator should NOT see "All nominations:" (which would indicate results view)
    await expect(page.locator('text="All nominations:"')).not.toBeVisible();
    
    await page.screenshot({ path: 'test-results/creator-workflow-02-voting-interface.png' });
    
    // Test creator can vote with nominations
    const nominationInputs = page.locator('input[type="text"]');
    await nominationInputs.nth(0).fill('Creator Nomination 1');
    await nominationInputs.nth(1).fill('Creator Nomination 2');
    await nominationInputs.nth(2).fill('Creator Nomination 3');
    
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
    
    // Now creator should see results view with their nominations
    await expect(page.locator('text="All nominations:"')).toBeVisible();
    await expect(page.locator('text="Creator Nomination 1"')).toBeVisible();
    await expect(page.locator('text="Creator Nomination 2"')).toBeVisible();
    await expect(page.locator('text="Creator Nomination 3"')).toBeVisible();
    
    // Creator should have Edit button
    const editButton = page.locator('button:has-text("Edit")');
    await expect(editButton).toBeVisible();
    
    await page.screenshot({ path: 'test-results/creator-workflow-03-after-voting.png' });
  });

  test('creator can edit their vote to add more nominations', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Create a nomination poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    await createPollPage.fillTitle('Edit Nominations Test');
    await createPollPage.selectPollType('nomination');
    await createPollPage.selectDeadline('10min');
    await createPollPage.fillCreatorName('Edit Test Creator');
    
    await createPollPage.submitPoll();
    await createPollPage.confirmSubmission();
    
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);
    
    // Vote with initial nominations
    const nominationInputs = page.locator('input[type="text"]');
    await nominationInputs.nth(0).fill('Initial Nomination 1');
    await nominationInputs.nth(1).fill('Initial Nomination 2');
    
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
    
    // Should be back in voting mode with existing nominations pre-filled
    await expect(page.locator('text="Add new nominations:"')).toBeVisible();
    
    // Add a third nomination
    const editInputs = page.locator('input[type="text"]');
    const emptyInput = editInputs.nth(2);
    await emptyInput.fill('Added Nomination 3');
    
    await page.screenshot({ path: 'test-results/creator-workflow-04-editing-vote.png' });
    
    // Submit updated vote
    const updateButton = page.locator('button:has-text("Submit Vote")');
    await updateButton.click();
    
    const modalUpdateButton = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalUpdateButton.isVisible({ timeout: 2000 })) {
      await modalUpdateButton.click();
    }
    
    await page.waitForTimeout(3000);
    
    // Verify all three nominations are now visible
    await expect(page.locator('text="Initial Nomination 1"')).toBeVisible();
    await expect(page.locator('text="Initial Nomination 2"')).toBeVisible();
    await expect(page.locator('text="Added Nomination 3"')).toBeVisible();
    
    await page.screenshot({ path: 'test-results/creator-workflow-05-after-edit.png' });
  });

  test('creator can abstain by removing all nominations', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Create a nomination poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    await createPollPage.fillTitle('Abstain Test Poll');
    await createPollPage.selectPollType('nomination');
    await createPollPage.selectDeadline('10min');
    await createPollPage.fillCreatorName('Abstain Test Creator');
    
    await createPollPage.submitPoll();
    await createPollPage.confirmSubmission();
    
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);
    
    // Initially vote with nominations
    const nominationInputs = page.locator('input[type="text"]');
    await nominationInputs.nth(0).fill('Temporary Nomination 1');
    await nominationInputs.nth(1).fill('Temporary Nomination 2');
    
    const submitButton = page.locator('button:has-text("Submit Vote")');
    await submitButton.click();
    
    const modalSubmitButton = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalSubmitButton.isVisible({ timeout: 2000 })) {
      await modalSubmitButton.click();
    }
    
    await page.waitForTimeout(3000);
    
    // Verify nominations are visible
    await expect(page.locator('text="Temporary Nomination 1"')).toBeVisible();
    await expect(page.locator('text="Temporary Nomination 2"')).toBeVisible();
    
    // Click Edit to change vote
    const editButton = page.locator('button:has-text("Edit")');
    await editButton.click();
    await page.waitForTimeout(2000);
    
    // Clear all nominations - only clear the ones with values, skip voter name field
    const editNominationInputs = page.locator('input[type="text"]:not([placeholder*="name"]):not([placeholder*="Name"])');
    const count = await editNominationInputs.count();
    console.log(`Found ${count} nomination inputs to clear`);
    
    for (let i = 0; i < count; i++) {
      const input = editNominationInputs.nth(i);
      try {
        const value = await input.inputValue({ timeout: 2000 });
        if (value && value.trim()) {
          console.log(`Clearing input ${i}: "${value}"`);
          await input.fill('');
        }
      } catch (error) {
        console.log(`Skipping input ${i} - not accessible:`, error.message);
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

  test('options field is completely hidden when nomination poll is selected', async ({ page }) => {
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
    
    // Switch to Nomination type
    await createPollPage.selectPollType('nomination');
    
    // Options field should be completely hidden
    await expect(page.locator('text="Poll Options"')).not.toBeVisible();
    await expect(page.locator('text="Starting Options"')).not.toBeVisible();
    
    // No option input fields should exist
    const nominationOptionInputs = page.locator('input[placeholder*="Add an option"], input[placeholder*="Add another option"]');
    await expect(nominationOptionInputs).toHaveCount(0);
    
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