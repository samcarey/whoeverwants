import { BasePage } from './BasePage';
import { expect } from '@playwright/test';

export class PollPage extends BasePage {
  constructor(page: any, private pollId?: string) {
    super(page);
  }

  // Page elements
  get pollTitle() {
    return this.page.locator('h1, .poll-title').first();
  }

  get pollDescription() {
    return this.page.locator('.poll-description, .description');
  }

  get votingInterface() {
    // Different interfaces for different poll types - look for any voting interface
    return this.page.locator('text="Select your preference"').or(
      this.page.locator('text="All nominations:"')
    ).or(
      this.page.locator('text="Add new nominations:"')
    ).or(
      this.page.locator('text="Reorder from most to least preferred"')
    ).first();
  }

  get submitVoteButton() {
    return this.page.locator('button:has-text("Submit Vote")');
  }

  get resultsSection() {
    return this.page.locator('.results, [data-testid="results"], .poll-results').first();
  }

  get voteOptions() {
    return this.page.locator('input[type="radio"], input[type="checkbox"], .vote-option');
  }

  get deadlineInfo() {
    return this.page.locator('text=/Closing in/').first();
  }

  get loadingSpinner() {
    return this.page.locator('svg.animate-spin, .loading, .spinner');
  }

  // Nomination-specific elements
  get editButton() {
    return this.page.locator('button:has-text("Edit")');
  }

  get closePollButton() {
    return this.page.locator('button:has-text("Close Poll")');
  }

  get allNominationsHeader() {
    return this.page.locator('text="All nominations:"');
  }

  get nominationInputs() {
    return this.page.locator('input[type="text"]');
  }

  get existingNominationsSection() {
    return this.page.locator('text="Existing nominations"');
  }

  get otherNominationsSection() {
    return this.page.locator('text="Other nominations"');
  }

  // Abstain-specific elements
  get abstainButton() {
    return this.page.locator('button:has-text("Abstain")');
  }

  get abstainActiveButton() {
    return this.page.locator('button:has-text("Abstaining (click to cancel)")');
  }

  get abstainRestrictionMessage() {
    return this.page.locator('text="To abstain, you must first remove all your nominations."');
  }

  // Actions
  async goToPollPage(pollId?: string) {
    const id = pollId || this.pollId;
    if (!id) {
      throw new Error('Poll ID is required to navigate to poll page');
    }
    await this.navigate(`/p/${id}`);
    await this.waitForLoad();
  }

  async selectVoteOption(optionText: string) {
    const option = this.page.locator(`text="${optionText}"`);
    await option.click();
  }

  async submitVote() {
    await this.submitVoteButton.click();
    await this.waitForNoLoading();
  }

  // Nomination-specific actions
  async enterEditMode() {
    await this.editButton.click();
    await this.page.waitForTimeout(1000); // Wait for edit mode to activate
  }

  async selectExistingNomination(nominationText: string) {
    const nomination = this.page.locator(`button:has-text("${nominationText}")`);
    await nomination.click();
  }

  async editNominationInput(index: number, newText: string) {
    const input = this.nominationInputs.nth(index);
    await input.fill(newText);
  }

  async addNewNomination(text: string) {
    // Find first empty input or add to the last input
    const inputs = this.nominationInputs;
    const count = await inputs.count();
    const lastInput = inputs.nth(count - 1);
    await lastInput.fill(text);
  }

  async closePoll() {
    await this.closePollButton.click();
    await this.page.waitForTimeout(3000); // Wait for poll to close
  }

  // Abstain-specific actions
  async clickAbstain() {
    await this.abstainButton.click();
    await this.page.waitForTimeout(1000); // Wait for state change
  }

  async cancelAbstain() {
    await this.abstainActiveButton.click();
    await this.page.waitForTimeout(1000); // Wait for state change
  }

  async clearAllNominations() {
    const inputs = this.nominationInputs;
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      await inputs.nth(i).fill('');
    }
    await this.page.waitForTimeout(1000); // Wait for state updates
  }

  // Assertions
  async verifyPollLoaded(expectedTitle?: string) {
    await expect(this.pollTitle).toBeVisible();
    if (expectedTitle) {
      await expect(this.pollTitle).toContainText(expectedTitle);
    }
  }

  async verifyVotingInterfaceVisible() {
    await expect(this.votingInterface).toBeVisible();
  }

  async verifyResultsVisible() {
    await expect(this.resultsSection).toBeVisible();
  }

  async verifyPollClosed() {
    // Check for poll closed message or results being shown
    const pollClosedText = this.page.locator('text=/poll.*closed/i');
    await expect(pollClosedText).toBeVisible();
  }

  async verifyDeadlineShown() {
    await expect(this.deadlineInfo).toBeVisible();
  }

  // Nomination-specific assertions
  async verifyNominationsDisplayed(nominations: string[]) {
    await expect(this.allNominationsHeader).toBeVisible();
    for (const nomination of nominations) {
      await expect(this.page.locator(`text="${nomination}"`)).toBeVisible();
    }
  }

  async verifyEditButtonVisible(shouldBeVisible: boolean = true) {
    if (shouldBeVisible) {
      await expect(this.editButton).toBeVisible();
      await expect(this.editButton).toBeEnabled();
    } else {
      await expect(this.editButton).not.toBeVisible();
    }
  }

  async verifyInEditMode() {
    await expect(this.page.locator('text="Add new nominations:"')).toBeVisible();
    await expect(this.nominationInputs.first()).toBeVisible();
  }

  async verifyNominationSelected(nominationText: string, shouldBeSelected: boolean = true) {
    const nomination = this.page.locator(`button:has-text("${nominationText}")`);
    if (shouldBeSelected) {
      await expect(nomination).toHaveClass(/bg-green/);
    } else {
      await expect(nomination).not.toHaveClass(/bg-green/);
    }
  }

  // Abstain-specific assertions
  async verifyAbstainButtonState(shouldBeEnabled: boolean = true) {
    if (shouldBeEnabled) {
      await expect(this.abstainButton).toBeEnabled();
    } else {
      await expect(this.abstainButton).toBeDisabled();
    }
  }

  async verifyAbstainRestrictionMessage(shouldBeVisible: boolean = true) {
    if (shouldBeVisible) {
      await expect(this.abstainRestrictionMessage).toBeVisible();
    } else {
      await expect(this.abstainRestrictionMessage).not.toBeVisible();
    }
  }

  async verifyAbstainActiveState(shouldBeActive: boolean = true) {
    if (shouldBeActive) {
      await expect(this.abstainActiveButton).toBeVisible();
      await expect(this.abstainButton).not.toBeVisible();
    } else {
      await expect(this.abstainButton).toBeVisible();
      await expect(this.abstainActiveButton).not.toBeVisible();
    }
  }

  async verifyInputsDisabledWhenAbstaining(shouldBeDisabled: boolean = true) {
    const firstInput = this.nominationInputs.first();
    if (shouldBeDisabled) {
      await expect(firstInput).toBeDisabled();
    } else {
      await expect(firstInput).toBeEnabled();
    }
  }
}