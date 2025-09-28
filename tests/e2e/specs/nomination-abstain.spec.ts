import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreatePollPage } from '../pages/CreatePollPage';
import { PollPage } from '../pages/PollPage';

test.describe('Nomination Poll Abstain Restrictions', () => {
  test('should disable abstain button when nominations exist and enable when cleared', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Navigate to create poll page
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    await createPollPage.verifyPageLoaded();
    
    // Create nomination poll with NO initial nominations to test from scratch
    await createPollPage.fillTitle('Abstain Test Poll');
    await createPollPage.selectPollType('nomination');
    await createPollPage.selectDeadline('10min');
    await createPollPage.fillCreatorName('Test User');
    
    // Submit without any options (empty nomination poll)
    await createPollPage.submitPoll();
    await createPollPage.confirmSubmission();
    
    // Wait for redirect and page load
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);
    
    // Empty nomination poll creates empty vote, so we need to click Edit to get to voting interface
    await expect(page.locator('text="All nominations:"')).toBeVisible();
    await expect(page.locator('text="No nominations available"')).toBeVisible();
    
    const editButton = page.locator('button:has-text("Edit")');
    await expect(editButton).toBeVisible();
    await editButton.click();
    await page.waitForTimeout(2000);
    
    // Now should be in voting mode
    await expect(page.locator('text="Add new nominations:"')).toBeVisible();
    
    // Abstain button should be ENABLED initially (no nominations)
    const abstainButton = page.locator('button:has-text("Abstain")');
    await expect(abstainButton).toBeVisible();
    await expect(abstainButton).toBeEnabled();
    
    // Should NOT see the restriction message initially
    const restrictionMessage = page.locator('text="To abstain, you must first remove all your nominations."');
    await expect(restrictionMessage).not.toBeVisible();
    
    await page.screenshot({ path: 'test-results/abstain-01-initial-enabled.png' });
    
    // Add a nomination
    const firstInput = page.locator('input[type="text"]').first();
    await firstInput.fill('Test Nomination');
    await page.waitForTimeout(1000); // Wait for state to update
    
    // Now abstain button should be DISABLED
    await expect(abstainButton).toBeDisabled();
    
    // Should see the restriction message
    await expect(restrictionMessage).toBeVisible();
    
    await page.screenshot({ path: 'test-results/abstain-02-disabled-with-nomination.png' });
    
    // Clear the nomination
    await firstInput.fill('');
    await page.waitForTimeout(1000); // Wait for state to update
    
    // Abstain button should be ENABLED again
    await expect(abstainButton).toBeEnabled();
    
    // Restriction message should be gone
    await expect(restrictionMessage).not.toBeVisible();
    
    await page.screenshot({ path: 'test-results/abstain-03-enabled-after-clear.png' });
    
    // Test that abstain actually works when enabled
    await abstainButton.click();
    
    // Should show abstaining state
    const abstainActiveButton = page.locator('button:has-text("Abstaining (click to cancel)")');
    await expect(abstainActiveButton).toBeVisible();
    
    // Submit vote should be enabled for abstaining
    const submitButton = page.locator('button:has-text("Submit Vote")');
    await expect(submitButton).toBeEnabled();
    
    await page.screenshot({ path: 'test-results/abstain-04-abstaining-active.png' });
  });

  test('should disable abstain when adding multiple nominations and enable when all cleared', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Create empty nomination poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    await createPollPage.verifyPageLoaded();
    
    await createPollPage.fillTitle('Multiple Nominations Abstain Test');
    await createPollPage.selectPollType('nomination');
    await createPollPage.selectDeadline('10min');
    await createPollPage.fillCreatorName('Multi Test User');
    await createPollPage.submitPoll();
    await createPollPage.confirmSubmission();
    
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);
    
    // Click Edit button to enter voting mode (empty polls show results view initially)
    const editButton = page.locator('button:has-text("Edit")');
    await expect(editButton).toBeVisible();
    await editButton.click();
    await page.waitForTimeout(2000);
    
    // Now should be in voting mode
    await expect(page.locator('text="Add new nominations:"')).toBeVisible();
    
    // Add multiple nominations
    const inputs = page.locator('input[type="text"]');
    await inputs.nth(0).fill('Nomination 1');
    await inputs.nth(1).fill('Nomination 2');
    await inputs.nth(2).fill('Nomination 3');
    
    await page.waitForTimeout(1000);
    
    // Abstain should be disabled
    const abstainButton = page.locator('button:has-text("Abstain")');
    await expect(abstainButton).toBeDisabled();
    
    const restrictionMessage = page.locator('text="To abstain, you must first remove all your nominations."');
    await expect(restrictionMessage).toBeVisible();
    
    await page.screenshot({ path: 'test-results/abstain-multiple-01-disabled.png' });
    
    // Clear nominations one by one - should remain disabled until ALL are cleared
    await inputs.nth(0).fill('');
    await page.waitForTimeout(500);
    await expect(abstainButton).toBeDisabled(); // Still disabled
    
    await inputs.nth(1).fill('');
    await page.waitForTimeout(500);
    await expect(abstainButton).toBeDisabled(); // Still disabled
    
    // Clear the last nomination
    await inputs.nth(2).fill('');
    await page.waitForTimeout(1000);
    
    // Now should be enabled
    await expect(abstainButton).toBeEnabled();
    await expect(restrictionMessage).not.toBeVisible();
    
    await page.screenshot({ path: 'test-results/abstain-multiple-02-enabled-after-all-cleared.png' });
  });

  test('should allow abstain after canceling abstain state and clearing nominations', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Create empty nomination poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    await createPollPage.fillTitle('Abstain Cancel Test');
    await createPollPage.selectPollType('nomination');
    await createPollPage.selectDeadline('10min'); 
    await createPollPage.fillCreatorName('Cancel Test User');
    await createPollPage.submitPoll();
    await createPollPage.confirmSubmission();
    
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);
    
    // Click Edit button to enter voting mode (empty polls show results view initially)
    const editButton = page.locator('button:has-text("Edit")');
    await expect(editButton).toBeVisible();
    await editButton.click();
    await page.waitForTimeout(2000);
    
    // Now should be in voting mode
    await expect(page.locator('text="Add new nominations:"')).toBeVisible();
    
    // Start by abstaining
    const abstainButton = page.locator('button:has-text("Abstain")');
    await abstainButton.click();
    
    // Should show abstaining state
    const abstainActiveButton = page.locator('button:has-text("Abstaining (click to cancel)")');
    await expect(abstainActiveButton).toBeVisible();
    
    // Cancel abstain by clicking again
    await abstainActiveButton.click();
    
    // Should be back to normal abstain button
    await expect(abstainButton).toBeVisible();
    await expect(abstainButton).toBeEnabled();
    
    // Add a nomination while not abstaining
    const firstInput = page.locator('input[type="text"]').first();
    await firstInput.fill('Test Nomination');
    await page.waitForTimeout(1000);
    
    // Abstain should be disabled
    await expect(abstainButton).toBeDisabled();
    
    // Clear nomination
    await firstInput.fill('');
    await page.waitForTimeout(1000);
    
    // Abstain should be enabled again
    await expect(abstainButton).toBeEnabled();
    
    // Should be able to abstain successfully
    await abstainButton.click();
    await expect(abstainActiveButton).toBeVisible();
    
    await page.screenshot({ path: 'test-results/abstain-cancel-flow-complete.png' });
  });

  test('should not allow adding nominations while abstaining is active', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Create empty nomination poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    await createPollPage.fillTitle('Abstain vs Nominations Test');
    await createPollPage.selectPollType('nomination');
    await createPollPage.selectDeadline('10min');
    await createPollPage.fillCreatorName('Interaction Test User');
    await createPollPage.submitPoll();
    await createPollPage.confirmSubmission();
    
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);
    
    // Click Edit button to enter voting mode (empty polls show results view initially)
    const editButton = page.locator('button:has-text("Edit")');
    await expect(editButton).toBeVisible();
    await editButton.click();
    await page.waitForTimeout(2000);
    
    // Now should be in voting mode
    await expect(page.locator('text="Add new nominations:"')).toBeVisible();
    
    // Click abstain first
    const abstainButton = page.locator('button:has-text("Abstain")');
    await abstainButton.click();
    
    // Verify abstaining state
    const abstainActiveButton = page.locator('button:has-text("Abstaining (click to cancel)")');
    await expect(abstainActiveButton).toBeVisible();
    
    // Input fields should be disabled when abstaining
    const inputs = page.locator('input[type="text"]');
    const firstInput = inputs.first();
    await expect(firstInput).toBeDisabled();
    
    // Verify input is empty and disabled (can't fill disabled inputs in Playwright)
    const inputValue = await firstInput.inputValue();
    expect(inputValue).toBe(''); // Should still be empty
    
    await page.screenshot({ path: 'test-results/abstain-disables-inputs.png' });
    
    // Cancel abstaining
    await abstainActiveButton.click();
    
    // Inputs should be enabled again
    await expect(firstInput).toBeEnabled();
    
    // Now should be able to add nominations
    await firstInput.fill('Now this works');
    const newValue = await firstInput.inputValue();
    expect(newValue).toBe('Now this works');
    
    await page.screenshot({ path: 'test-results/abstain-inputs-enabled-after-cancel.png' });
  });
});