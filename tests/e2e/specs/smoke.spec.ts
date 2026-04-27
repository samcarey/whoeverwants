import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreateQuestionPage } from '../pages/CreateQuestionPage';

test.describe('Smoke Tests', () => {
  test('should load the home page', async ({ page }) => {
    const homePage = new HomePage(page);
    
    await homePage.goToHomePage();
    await homePage.verifyPageLoaded();
    
    // Take a screenshot for debugging
    await homePage.takeScreenshot('home-page-smoke');
  });

  test('should navigate to create question page', async ({ page }) => {
    const homePage = new HomePage(page);
    const createQuestionPage = new CreateQuestionPage(page);
    
    await homePage.goToHomePage();
    await homePage.navigateToCreateQuestion();
    
    // Should be on create question page
    await expect(page).toHaveURL(/create/);
    await createQuestionPage.verifyPageLoaded();
    
    // Take a screenshot for debugging
    await createQuestionPage.takeScreenshot('create-question-smoke');
  });
});