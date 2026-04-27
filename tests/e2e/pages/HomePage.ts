import { BasePage } from './BasePage';
import { expect } from '@playwright/test';

export class HomePage extends BasePage {
  // Page elements
  get createQuestionButton() {
    return this.page.locator('a[href*="create"], button:has-text("Create"), a:has-text("Create")').first();
  }

  get questionsList() {
    return this.page.locator('[data-testid="questions-list"], .question-item, .question-card');
  }

  get pageHeading() {
    return this.page.locator('h1, .page-title').first();
  }

  // Actions
  async goToHomePage() {
    await this.navigate('/');
    await this.waitForLoad();
  }

  async clickCreateQuestion() {
    await this.createQuestionButton.click();
    await this.waitForLoad();
  }

  async navigateToCreateQuestion() {
    if (await this.createQuestionButton.isVisible()) {
      try {
        await this.clickCreateQuestion();
        // Wait for URL to change after navigation
        await this.page.waitForURL(/create/, { timeout: 10000 });
      } catch (error) {
        // Fallback: navigate directly if button click doesn't work
        await this.navigate('/create-question');
        await this.waitForLoad();
      }
    } else {
      // Navigate directly if no button found
      await this.navigate('/create-question');
      await this.waitForLoad();
    }
  }

  // Assertions
  async verifyPageLoaded() {
    await expect(this.page).toHaveTitle(/WhoeverWants/i);
  }

  async verifyCreateButtonVisible() {
    await expect(this.createQuestionButton).toBeVisible();
  }
}