import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreateQuestionPage } from '../pages/CreateQuestionPage';
import { QuestionPage } from '../pages/QuestionPage';
import { testQuestions, getTomorrowDate, getOneHourFromNow } from '../fixtures/test-data';

test.describe('Question Creation', () => {
  test('should create a yes/no question', async ({ page }) => {
    const homePage = new HomePage(page);
    const createQuestionPage = new CreateQuestionPage(page);
    const questionPage = new QuestionPage(page);
    
    // Navigate to create question page
    await homePage.goToHomePage();
    await homePage.navigateToCreateQuestion();
    await createQuestionPage.verifyPageLoaded();
    
    // Create a yes/no question (no options = yes/no question)
    await createQuestionPage.createQuestion({
      title: testQuestions.yesNo.title,
      type: testQuestions.yesNo.type,
      deadline: testQuestions.yesNo.deadline,
      creatorName: testQuestions.yesNo.creatorName
    });
    
    // Verify redirect to question page
    await createQuestionPage.verifyRedirectToQuestion();
    
    // Verify question was created successfully
    await questionPage.verifyQuestionLoaded(testQuestions.yesNo.title);
    await questionPage.verifyVotingInterfaceVisible();
    
    await page.screenshot({ path: 'test-results/yes-no-question-created.png' });
  });

  test('should create a ranked choice question', async ({ page }) => {
    const homePage = new HomePage(page);
    const createQuestionPage = new CreateQuestionPage(page);
    const questionPage = new QuestionPage(page);
    
    await homePage.goToHomePage();
    await homePage.navigateToCreateQuestion();
    
    // Create ranked choice question with multiple options
    await createQuestionPage.createQuestion({
      title: testQuestions.rankedChoice.title,
      type: testQuestions.rankedChoice.type,
      options: testQuestions.rankedChoice.options,
      deadline: testQuestions.rankedChoice.deadline,
      creatorName: testQuestions.rankedChoice.creatorName
    });
    
    await createQuestionPage.verifyRedirectToQuestion();
    await questionPage.verifyQuestionLoaded(testQuestions.rankedChoice.title);
    await questionPage.verifyVotingInterfaceVisible();
    
    await page.screenshot({ path: 'test-results/ranked-choice-question-created.png' });
  });

  test('should create question with custom deadline', async ({ page }) => {
    const homePage = new HomePage(page);
    const createQuestionPage = new CreateQuestionPage(page);
    const questionPage = new QuestionPage(page);
    
    await homePage.goToHomePage();
    await homePage.navigateToCreateQuestion();
    
    // Use dynamic dates to avoid past deadline issues
    const customDate = getTomorrowDate();
    const customTime = getOneHourFromNow();
    
    await createQuestionPage.createQuestion({
      title: testQuestions.customDeadline.title,
      type: testQuestions.customDeadline.type,
      options: testQuestions.customDeadline.options,
      deadline: 'custom',
      customDate: customDate,
      customTime: customTime,
      creatorName: testQuestions.customDeadline.creatorName
    });
    
    await createQuestionPage.verifyRedirectToQuestion();
    await questionPage.verifyQuestionLoaded(testQuestions.customDeadline.title);
    await questionPage.verifyDeadlineShown();
    
    await page.screenshot({ path: 'test-results/custom-deadline-question-created.png' });
  });

  test('should validate required fields', async ({ page }) => {
    const homePage = new HomePage(page);
    const createQuestionPage = new CreateQuestionPage(page);
    
    await homePage.goToHomePage();
    await homePage.navigateToCreateQuestion();
    
    // Verify submit button is disabled without title
    const submitButton = createQuestionPage.submitButton;
    await expect(submitButton).toBeDisabled();
    
    // Verify the validation message appears (match actual error text from UI)
    const errorMsg = page.locator('text="Please enter a category or title."');
    await expect(errorMsg).toBeVisible();
    
    await page.screenshot({ path: 'test-results/validation-error.png' });
  });

  test('should prevent duplicate options', async ({ page }) => {
    const homePage = new HomePage(page);
    const createQuestionPage = new CreateQuestionPage(page);
    
    await homePage.goToHomePage();
    await homePage.navigateToCreateQuestion();
    
    // Fill form with duplicate options
    await createQuestionPage.fillTitle('Test Question with Duplicates');
    await createQuestionPage.fillOptions(['Option A', 'Option B', 'Option A']); // Duplicate
    
    // The duplicate option should be highlighted in red
    const duplicateInput = createQuestionPage.optionInputs.nth(2);
    await expect(duplicateInput).toHaveClass(/border-red/);
    
    // Verify submit button is disabled with duplicates
    await expect(createQuestionPage.submitButton).toBeDisabled();
    
    // Verify error message appears below form (match actual error text from UI)
    const errorMsg = page.locator('text="All question options must be unique (no duplicates)."');
    await expect(errorMsg).toBeVisible();
    
    await page.screenshot({ path: 'test-results/duplicate-options-error.png' });
  });
});