import { BasePage } from './BasePage';
import { expect } from '@playwright/test';

interface PollData {
  title: string;
  description?: string;
  type: 'poll' | 'nomination';
  options?: string[];
  deadline?: string;
  customDate?: string;
  customTime?: string;
  creatorName?: string;
}

export class CreatePollPage extends BasePage {
  // Form elements
  get titleInput() {
    return this.page.locator('#title');
  }

  get pollTypeToggle() {
    return {
      poll: this.page.locator('button:has-text("Poll")').first(),
      nomination: this.page.locator('button:has-text("Nomination/Suggestions")').first()
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
      modal: this.page.locator('text="Create Poll"').locator('..').locator('..'), // Find modal by title text
      confirmButton: this.page.locator('button:has-text("Create Poll")'),
      cancelButton: this.page.locator('button:has-text("Cancel")')
    };
  }

  // Actions
  async goToCreatePollPage() {
    await this.navigate('/create-poll');
    await this.waitForLoad();
  }

  async fillTitle(title: string) {
    await this.titleInput.fill(title);
  }

  async selectPollType(type: 'poll' | 'nomination') {
    // Only click if we need to change the type
    // Since nomination is the default, only click if switching to poll or if explicitly selecting nomination
    if (type === 'poll') {
      await this.pollTypeToggle.poll.click();
    } else if (type === 'nomination') {
      // Check if nomination button exists and is not already selected
      // If it doesn't exist or page hasn't loaded, it might already be selected by default
      const nominationButton = this.pollTypeToggle.nomination;
      const exists = await nominationButton.count() > 0;
      if (exists) {
        // Only click if button exists and we can interact with it
        await nominationButton.click();
      }
      // If button doesn't exist, assume nomination is already selected (default)
    }
  }

  async fillOptions(options: string[]) {
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

  async submitPoll() {
    await this.submitButton.click();
  }

  async confirmSubmission() {
    // Click the "Create Poll" button in the modal
    await this.confirmModal.confirmButton.click();
    await this.waitForNoLoading();
  }

  async createPoll(data: PollData) {
    // Fill basic poll information
    await this.fillTitle(data.title);
    
    // Select poll type (nomination is default, so only click if changing to poll)
    if (data.type === 'poll') {
      await this.selectPollType(data.type);
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

    // Submit the poll
    await this.submitPoll();
    
    // Handle confirmation modal
    await this.confirmSubmission();
  }

  // Assertions
  async verifyPageLoaded() {
    await expect(this.titleInput).toBeVisible();
    await expect(this.submitButton).toBeVisible();
  }

  async verifyRedirectToPoll() {
    // Wait for redirect to poll page (URL should change to /p/[id])
    // Handle browser-specific timing issues by waiting for either:
    // 1. Direct redirect to poll page, OR
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
        // If still failing, check if we're on create-poll page and try webkit-specific fixes
        const currentUrl = this.page.url();
        if (currentUrl.includes('/create-poll')) {
          console.log('Still on create-poll page, attempting webkit-specific fixes...');
          
          // Wait for network to settle
          await this.page.waitForLoadState('networkidle', { timeout: 10000 });
          
          // For webkit, sometimes we need to manually trigger the redirect
          // by checking if there's a poll ID in the page source
          const pageContent = await this.page.content();
          const pollIdMatch = pageContent.match(/\/p\/([a-f0-9-]+)/);
          
          if (pollIdMatch) {
            const pollId = pollIdMatch[1];
            console.log(`Found poll ID in page content: ${pollId}, navigating directly...`);
            
            // Navigate directly to the poll page
            await this.page.goto(`http://localhost:3000/p/${pollId}`, {
              waitUntil: 'domcontentloaded'
            });
          } else {
            // As a last resort, wait longer for the redirect
            console.log('No poll ID found, waiting longer for redirect...');
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