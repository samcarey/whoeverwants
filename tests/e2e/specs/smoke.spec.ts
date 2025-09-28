import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreatePollPage } from '../pages/CreatePollPage';

test.describe('Smoke Tests', () => {
  test('should load the home page', async ({ page }) => {
    const homePage = new HomePage(page);
    
    await homePage.goToHomePage();
    await homePage.verifyPageLoaded();
    
    // Take a screenshot for debugging
    await homePage.takeScreenshot('home-page-smoke');
  });

  test('should navigate to create poll page', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    // Should be on create poll page
    await expect(page).toHaveURL(/create/);
    await createPollPage.verifyPageLoaded();
    
    // Take a screenshot for debugging
    await createPollPage.takeScreenshot('create-poll-smoke');
  });
});