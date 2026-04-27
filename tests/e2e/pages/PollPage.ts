import { BasePage } from './BasePage';
import { expect } from '@playwright/test';

export class QuestionPage extends BasePage {
  constructor(page: any, private questionId?: string) {
    super(page);
  }

  // Page elements
  get questionTitle() {
    return this.page.locator('h1, .question-title').first();
  }

  get questionDescription() {
    return this.page.locator('.question-description, .description');
  }

  get votingInterface() {
    // Different interfaces for different question types - look for any voting interface
    return this.page.locator('text="Select your preference"').or(
      this.page.locator('text="All suggestions:"')
    ).or(
      this.page.locator('text="Add new suggestions:"')
    ).or(
      this.page.locator('text="Reorder from most to least preferred"')
    ).first();
  }

  get submitVoteButton() {
    return this.page.locator('button:has-text("Submit Vote")');
  }

  get resultsSection() {
    return this.page.locator('.results, [data-testid="results"], .question-results').first();
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

  // Suggestion-specific elements
  get editButton() {
    return this.page.locator('button:has-text("Edit")');
  }

  get closeQuestionButton() {
    return this.page.locator('button:has-text("Close Question")');
  }

  get allSuggestionsHeader() {
    return this.page.locator('text="All suggestions:"');
  }

  get suggestionInputs() {
    return this.page.locator('input[type="text"]');
  }

  get existingSuggestionsSection() {
    return this.page.locator('text="Existing suggestions"');
  }

  get otherSuggestionsSection() {
    return this.page.locator('text="Other suggestions"');
  }

  // Abstain-specific elements
  get abstainButton() {
    return this.page.locator('button:has-text("Abstain")');
  }

  get abstainActiveButton() {
    return this.page.locator('button:has-text("Abstaining (click to cancel)")');
  }

  get abstainRestrictionMessage() {
    return this.page.locator('text="To abstain, you must first remove all your suggestions."');
  }

  // Actions
  async goToQuestionPage(questionId?: string) {
    const id = questionId || this.questionId;
    if (!id) {
      throw new Error('Question ID is required to navigate to question page');
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

  // Suggestion-specific actions
  async enterEditMode() {
    await this.editButton.click();
    await this.page.waitForTimeout(1000); // Wait for edit mode to activate
  }

  async selectExistingSuggestion(suggestionText: string) {
    const suggestion = this.page.locator(`button:has-text("${suggestionText}")`);
    await suggestion.click();
  }

  async editSuggestionInput(index: number, newText: string) {
    const input = this.suggestionInputs.nth(index);
    await input.fill(newText);
  }

  async addNewSuggestion(text: string) {
    // Find first empty input or add to the last input
    const inputs = this.suggestionInputs;
    const count = await inputs.count();
    const lastInput = inputs.nth(count - 1);
    await lastInput.fill(text);
  }

  async closeQuestion() {
    await this.closeQuestionButton.click();
    await this.page.waitForTimeout(3000); // Wait for question to close
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

  async clearAllSuggestions() {
    const inputs = this.suggestionInputs;
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      await inputs.nth(i).fill('');
    }
    await this.page.waitForTimeout(1000); // Wait for state updates
  }

  // Assertions
  async verifyQuestionLoaded(expectedTitle?: string) {
    await expect(this.questionTitle).toBeVisible();
    if (expectedTitle) {
      await expect(this.questionTitle).toContainText(expectedTitle);
    }
  }

  async verifyVotingInterfaceVisible() {
    await expect(this.votingInterface).toBeVisible();
  }

  async verifyResultsVisible() {
    await expect(this.resultsSection).toBeVisible();
  }

  async verifyQuestionClosed() {
    // Check for question closed message or results being shown
    const questionClosedText = this.page.locator('text=/question.*closed/i');
    await expect(questionClosedText).toBeVisible();
  }

  async verifyDeadlineShown() {
    await expect(this.deadlineInfo).toBeVisible();
  }

  // Suggestion-specific assertions
  async verifySuggestionsDisplayed(suggestions: string[]) {
    await expect(this.allSuggestionsHeader).toBeVisible();
    for (const suggestion of suggestions) {
      await expect(this.page.locator(`text="${suggestion}"`)).toBeVisible();
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
    await expect(this.page.locator('text="Add new suggestions:"')).toBeVisible();
    await expect(this.suggestionInputs.first()).toBeVisible();
  }

  async verifySuggestionSelected(suggestionText: string, shouldBeSelected: boolean = true) {
    const suggestion = this.page.locator(`button:has-text("${suggestionText}")`);
    if (shouldBeSelected) {
      await expect(suggestion).toHaveClass(/bg-green/);
    } else {
      await expect(suggestion).not.toHaveClass(/bg-green/);
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
    const firstInput = this.suggestionInputs.first();
    if (shouldBeDisabled) {
      await expect(firstInput).toBeDisabled();
    } else {
      await expect(firstInput).toBeEnabled();
    }
  }
}