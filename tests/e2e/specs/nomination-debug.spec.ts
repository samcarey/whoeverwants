import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreatePollPage } from '../pages/CreatePollPage';

test.describe('Nomination Debug', () => {
  test('debug nomination editing flow', async ({ page }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Create nomination poll with initial nominations
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    const pollData = {
      title: 'Debug Nomination Poll',
      type: 'nomination' as const,
      options: ['Initial Option 1', 'Initial Option 2'],
      deadline: '10min',
      creatorName: 'Debug User'
    };
    
    await createPollPage.createPoll(pollData);
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);
    
    // Take screenshot of initial state
    await page.screenshot({ path: 'test-results/debug-01-initial-state.png' });
    
    // Verify we're in "has voted" state with nominations visible
    await expect(page.locator('text="All nominations:"')).toBeVisible();
    await expect(page.locator('text="Initial Option 1"')).toBeVisible();
    await expect(page.locator('text="Initial Option 2"')).toBeVisible();
    
    // Click Edit button
    const editButton = page.locator('button:has-text("Edit")');
    await expect(editButton).toBeVisible();
    await editButton.click();
    await page.waitForTimeout(2000);
    
    // Take screenshot of edit mode
    await page.screenshot({ path: 'test-results/debug-02-edit-mode.png' });
    
    // Verify edit mode is active
    await expect(page.locator('text="Add new nominations:"')).toBeVisible();
    
    // Check what's in the input fields
    const inputs = page.locator('input[type="text"]');
    const inputCount = await inputs.count();
    console.log('Input count:', inputCount);
    
    // Log current input values
    for (let i = 0; i < inputCount; i++) {
      const value = await inputs.nth(i).inputValue();
      console.log(`Input ${i} value: "${value}"`);
    }
    
    // Try simple edit - just change first input
    await inputs.nth(0).fill('Updated Option 1');
    await page.waitForTimeout(1000);
    
    // Take screenshot after editing
    await page.screenshot({ path: 'test-results/debug-03-after-edit.png' });
    
    // Submit
    const submitButton = page.locator('button:has-text("Submit Vote")');
    await submitButton.click();
    await page.waitForTimeout(1000);
    
    // Take screenshot of any modal
    await page.screenshot({ path: 'test-results/debug-04-modal.png' });
    
    // Handle confirmation modal if present
    const modalSubmitButton = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalSubmitButton.isVisible()) {
      await modalSubmitButton.click();
    }
    
    await page.waitForTimeout(3000);
    
    // Take screenshot of final result
    await page.screenshot({ path: 'test-results/debug-05-final-result.png' });
    
    // Check what we have now
    const hasAllNominations = await page.locator('text="All nominations:"').isVisible();
    const hasNoNominations = await page.locator('text="No nominations available"').isVisible();
    
    console.log('Has "All nominations:":', hasAllNominations);
    console.log('Has "No nominations available":', hasNoNominations);
    
    if (hasAllNominations) {
      // Log all visible nominations
      const nominations = page.locator('text="All nominations:"').locator('..').locator('div').locator('span');
      const nominationCount = await nominations.count();
      console.log('Nomination count:', nominationCount);
      
      for (let i = 0; i < nominationCount; i++) {
        const text = await nominations.nth(i).textContent();
        console.log(`Nomination ${i}: "${text}"`);
      }
    }
  });
});