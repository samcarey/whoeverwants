import { BasePage } from './BasePage';
import { expect } from '@playwright/test';

export class HomePage extends BasePage {
  // Page elements
  get createPollButton() {
    return this.page.locator('a[href*="create"], button:has-text("Create"), a:has-text("Create")').first();
  }

  get pollsList() {
    return this.page.locator('[data-testid="polls-list"], .poll-item, .poll-card');
  }

  get pageHeading() {
    return this.page.locator('h1, .page-title').first();
  }

  // Actions
  async goToHomePage() {
    await this.navigate('/');
    await this.waitForLoad();
  }

  async clickCreatePoll() {
    await this.createPollButton.click();
    await this.waitForLoad();
  }

  async navigateToCreatePoll() {
    if (await this.createPollButton.isVisible()) {
      try {
        await this.clickCreatePoll();
        // Wait for URL to change after navigation
        await this.page.waitForURL(/create/, { timeout: 10000 });
      } catch (error) {
        // Fallback: navigate directly if button click doesn't work
        await this.navigate('/create-poll');
        await this.waitForLoad();
      }
    } else {
      // Navigate directly if no button found
      await this.navigate('/create-poll');
      await this.waitForLoad();
    }
  }

  // Assertions
  async verifyPageLoaded() {
    await expect(this.page).toHaveTitle(/WhoeverWants/i);
  }

  async verifyCreateButtonVisible() {
    await expect(this.createPollButton).toBeVisible();
  }
}