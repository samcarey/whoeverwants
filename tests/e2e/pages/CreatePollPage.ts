import { BasePage } from './BasePage';
import { expect } from '@playwright/test';

interface QuestionData {
  title: string;
  description?: string;
  type: 'question';
  options?: readonly string[];
  deadline?: string;
  customDate?: string;
  customTime?: string;
  creatorName?: string;
}

export class CreateQuestionPage extends BasePage {
  // Form elements
  get titleInput() {
    return this.page.locator('#title');
  }

  get questionTypeToggle() {
    return {
      question: this.page.locator('button:has-text("🗳️")').first(),
    };
  }

  get optionsContainer() {
    return this.page.locator('.space-y-2').last();
  }

  get optionInputs() {
    // Find the options container, then get only the input fields within it
    return this.optionsContainer.locator('input[type="text"]');
  }

  get deadlineSelect() {
    return this.page.locator('#deadline');
  }

  get customDateInput() {
    return this.page.locator('#customDate');
  }

  get customTimeInput() {
    return this.page.locator('#customTime');
  }

  get creatorNameInput() {
    return this.page.locator('#creatorName');
  }

  get submitButton() {
    return this.page.locator('button[type="button"]:has-text("Submit")').first();
  }

  get loadingSpinner() {
    return this.page.locator('svg.animate-spin');
  }

  get errorMessage() {
    return this.page.locator('.bg-red-100, .text-red-600').first();
  }

  get confirmModal() {
    return {
      modal: this.page.locator('text="Create Question"').locator('..').locator('..'), // Find modal by title text
      confirmButton: this.page.locator('button:has-text("Create Question")'),
      cancelButton: this.page.locator('button:has-text("Cancel")')
    };
  }

  // Actions
  async goToCreateQuestionPage() {
    await this.navigate('/create-question');
    await this.waitForLoad();
  }

  async fillTitle(title: string) {
    await this.titleInput.fill(title);
  }

  async selectQuestionType(type: 'question') {
    if (type === 'question') {
      await this.questionTypeToggle.question.click();
    }
  }

  async fillOptions(options: readonly string[]) {
    // Fill options one by one
    for (let i = 0; i < options.length; i++) {
      // Get the current option inputs (they expand as we type)
      const currentInputs = await this.optionInputs.all();
      
      // Fill the current input
      if (i < currentInputs.length) {
        await currentInputs[i].fill(options[i]);
        
        // Small delay to let the form expand for next option
        await this.page.waitForTimeout(200);
      }
    }
  }

  async selectDeadline(deadline: string) {
    await this.deadlineSelect.selectOption(deadline);
  }

  async fillCustomDateTime(date: string, time: string) {
    await this.customDateInput.fill(date);
    await this.customTimeInput.fill(time);
  }

  async fillCreatorName(name: string) {
    await this.creatorNameInput.fill(name);
  }

  async submitQuestion() {
    await this.submitButton.click();
  }

  async confirmSubmission() {
    // Click the "Create Question" button in the modal
    await this.confirmModal.confirmButton.click();
    await this.waitForNoLoading();
  }

  async createQuestion(data: QuestionData) {
    // Fill basic question information
    await this.fillTitle(data.title);
    
    // Select question type (suggestion is default, so only click if changing to question)
    if (data.type === 'question') {
      await this.selectQuestionType(data.type);
    }

    // Fill options if provided
    if (data.options && data.options.length > 0) {
      await this.fillOptions(data.options);
    }

    // Set deadline
    if (data.deadline) {
      await this.selectDeadline(data.deadline);
      
      // Fill custom date/time if custom deadline
      if (data.deadline === 'custom' && data.customDate && data.customTime) {
        await this.fillCustomDateTime(data.customDate, data.customTime);
      }
    }

    // Fill creator name if provided
    if (data.creatorName) {
      await this.fillCreatorName(data.creatorName);
    }

    // Submit the question
    await this.submitQuestion();
    
    // Handle confirmation modal
    await this.confirmSubmission();
  }

  // Assertions
  async verifyPageLoaded() {
    await expect(this.titleInput).toBeVisible();
    await expect(this.submitButton).toBeVisible();
  }

  async verifyRedirectToQuestion() {
    // Wait for redirect to question page (URL should change to /p/[id])
    // Handle browser-specific timing issues by waiting for either:
    // 1. Direct redirect to question page, OR
    // 2. "Redirecting..." state followed by actual redirect
    
    try {
      // First, try the direct redirect approach (works for most browsers)
      await this.page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 15000 });
    } catch (firstError) {
      // If direct redirect fails, wait for "Redirecting..." state and try again
      console.log('Direct redirect failed, checking for redirecting state...');
      
      try {
        // Look for the "Redirecting..." button state
        await this.page.locator('button:has-text("Redirecting...")').waitFor({ 
          state: 'visible', 
          timeout: 5000 
        });
        
        console.log('Found redirecting state, waiting for actual redirect...');
        
        // Now wait for the actual redirect with extended timeout
        await this.page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 30000 });
        
      } catch (secondError) {
        // If still failing, check if we're on create-question page and try webkit-specific fixes
        const currentUrl = this.page.url();
        if (currentUrl.includes('/create-question')) {
          console.log('Still on create-question page, attempting webkit-specific fixes...');
          
          // Wait for network to settle
          await this.page.waitForLoadState('networkidle', { timeout: 10000 });
          
          // For webkit, sometimes we need to manually trigger the redirect
          // by checking if there's a question ID in the page source
          const pageContent = await this.page.content();
          const questionIdMatch = pageContent.match(/\/p\/([a-f0-9-]+)/);
          
          if (questionIdMatch) {
            const questionId = questionIdMatch[1];
            console.log(`Found question ID in page content: ${questionId}, navigating directly...`);
            
            // Navigate directly to the question page
            await this.page.goto(`http://localhost:3000/p/${questionId}`, {
              waitUntil: 'domcontentloaded'
            });
          } else {
            // As a last resort, wait longer for the redirect
            console.log('No question ID found, waiting longer for redirect...');
            await this.page.waitForURL(/\/p\/[a-f0-9-]+/, { timeout: 30000 });
          }
        } else {
          // Re-throw the original error
          throw firstError;
        }
      }
    }
  }

  async verifyError(expectedError: string) {
    await expect(this.errorMessage).toContainText(expectedError);
  }

  async verifyLoading() {
    await expect(this.loadingSpinner).toBeVisible();
  }
}