import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreatePollPage } from '../pages/CreatePollPage';
import { PollPage } from '../pages/PollPage';
import { testPolls, getTomorrowDate, getOneHourFromNow } from '../fixtures/test-data';

test.describe('Poll Creation', () => {
  test('should create a yes/no poll', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    const pollPage = new PollPage(page);
    
    // Navigate to create poll page
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    await createPollPage.verifyPageLoaded();
    
    // Create a yes/no poll (no options = yes/no poll)
    await createPollPage.createPoll({
      title: testPolls.yesNo.title,
      type: testPolls.yesNo.type,
      deadline: testPolls.yesNo.deadline,
      creatorName: testPolls.yesNo.creatorName
    });
    
    // Verify redirect to poll page
    await createPollPage.verifyRedirectToPoll();
    
    // Verify poll was created successfully
    await pollPage.verifyPollLoaded(testPolls.yesNo.title);
    await pollPage.verifyVotingInterfaceVisible();
    
    await page.screenshot({ path: 'test-results/yes-no-poll-created.png' });
  });

  test('should create a ranked choice poll', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    const pollPage = new PollPage(page);
    
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    // Create ranked choice poll with multiple options
    await createPollPage.createPoll({
      title: testPolls.rankedChoice.title,
      type: testPolls.rankedChoice.type,
      options: testPolls.rankedChoice.options,
      deadline: testPolls.rankedChoice.deadline,
      creatorName: testPolls.rankedChoice.creatorName
    });
    
    await createPollPage.verifyRedirectToPoll();
    await pollPage.verifyPollLoaded(testPolls.rankedChoice.title);
    await pollPage.verifyVotingInterfaceVisible();
    
    await page.screenshot({ path: 'test-results/ranked-choice-poll-created.png' });
  });

  test('should create a nomination poll', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    const pollPage = new PollPage(page);
    
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    // Create nomination poll
    await createPollPage.createPoll({
      title: testPolls.nomination.title,
      type: testPolls.nomination.type,
      options: testPolls.nomination.options,
      deadline: testPolls.nomination.deadline,
      creatorName: testPolls.nomination.creatorName
    });
    
    await createPollPage.verifyRedirectToPoll();
    await pollPage.verifyPollLoaded(testPolls.nomination.title);
    await pollPage.verifyVotingInterfaceVisible();
    
    await page.screenshot({ path: 'test-results/nomination-poll-created.png' });
  });

  test('should create poll with custom deadline', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    const pollPage = new PollPage(page);
    
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    // Use dynamic dates to avoid past deadline issues
    const customDate = getTomorrowDate();
    const customTime = getOneHourFromNow();
    
    await createPollPage.createPoll({
      title: testPolls.customDeadline.title,
      type: testPolls.customDeadline.type,
      options: testPolls.customDeadline.options,
      deadline: 'custom',
      customDate: customDate,
      customTime: customTime,
      creatorName: testPolls.customDeadline.creatorName
    });
    
    await createPollPage.verifyRedirectToPoll();
    await pollPage.verifyPollLoaded(testPolls.customDeadline.title);
    await pollPage.verifyDeadlineShown();
    
    await page.screenshot({ path: 'test-results/custom-deadline-poll-created.png' });
  });

  test('should validate required fields', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    // Verify submit button is disabled without title
    const submitButton = createPollPage.submitButton;
    await expect(submitButton).toBeDisabled();
    
    // Verify the validation message appears (match actual error text from UI)
    const errorMsg = page.locator('text="Please enter a poll title."');
    await expect(errorMsg).toBeVisible();
    
    await page.screenshot({ path: 'test-results/validation-error.png' });
  });

  test('should prevent duplicate options', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    // Fill form with duplicate options
    await createPollPage.fillTitle('Test Poll with Duplicates');
    await createPollPage.fillOptions(['Option A', 'Option B', 'Option A']); // Duplicate
    
    // The duplicate option should be highlighted in red
    const duplicateInput = createPollPage.optionInputs.nth(2);
    await expect(duplicateInput).toHaveClass(/border-red/);
    
    // Verify submit button is disabled with duplicates
    await expect(createPollPage.submitButton).toBeDisabled();
    
    // Verify error message appears below form (match actual error text from UI)
    const errorMsg = page.locator('text="All poll options must be unique (no duplicates)."');
    await expect(errorMsg).toBeVisible();
    
    await page.screenshot({ path: 'test-results/duplicate-options-error.png' });
  });
});