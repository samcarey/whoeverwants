import { test, expect } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { CreatePollPage } from '../pages/CreatePollPage';

test.describe('Nomination Poll Cross-Browser Identity', () => {
  test('should not allow second browser to edit nominations from first browser', async ({ page, browser }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Browser 1: Create nomination poll and vote
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    await createPollPage.verifyPageLoaded();
    
    const pollData = {
      title: 'Cross-Browser Identity Test',
      type: 'nomination' as const,
      options: ['Browser 1 Nomination A', 'Browser 1 Nomination B'],
      deadline: '10min',
      creatorName: 'Browser 1 User'
    };
    
    await createPollPage.createPoll(pollData);
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);
    
    const pollUrl = page.url();
    console.log('Poll created at:', pollUrl);
    
    // With the fix, Browser 1 now correctly sees the voting interface, not results
    // The nominations exist as "Existing nominations" that can be selected
    await expect(page.locator('text="Existing nominations (select to second):"')).toBeVisible();
    await expect(page.locator('text="Browser 1 Nomination A"')).toBeVisible();
    await expect(page.locator('text="Browser 1 Nomination B"')).toBeVisible();
    
    // Browser 1 should be able to vote by selecting existing nominations
    const nomination1Button = page.locator('button:has-text("Browser 1 Nomination A")');
    const nomination2Button = page.locator('button:has-text("Browser 1 Nomination B")');
    await nomination1Button.click();
    await nomination2Button.click();
    
    // Submit Browser 1's vote
    const browser1SubmitButton = page.locator('button:has-text("Submit Vote")');
    await browser1SubmitButton.click();
    
    const modalSubmitButton1 = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalSubmitButton1.isVisible({ timeout: 2000 })) {
      await modalSubmitButton1.click();
    }
    
    await page.waitForTimeout(3000);
    
    // Now Browser 1 should see results view with Edit button
    await expect(page.locator('text="All nominations:"')).toBeVisible();
    const browser1EditButton = page.locator('button:has-text("Edit")');
    await expect(browser1EditButton).toBeVisible();
    
    await page.screenshot({ path: 'test-results/cross-browser-01-browser1-view.png' });
    
    // Browser 2: Open the same poll in a fresh context (simulates different browser/incognito)
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(pollUrl);
    await page2.waitForTimeout(3000);
    
    await page2.screenshot({ path: 'test-results/cross-browser-02-browser2-initial.png' });
    
    // ✅ FIXED: Browser 2 now correctly sees the voting interface, not results
    // This proves Browser 2 doesn't think it owns Browser 1's nominations
    await expect(page2.locator('text="Existing nominations (select to second):"')).toBeVisible();
    await expect(page2.locator('text="Browser 1 Nomination A"')).toBeVisible();
    await expect(page2.locator('text="Browser 1 Nomination B"')).toBeVisible();
    
    // CRITICAL TEST: Browser 2 should NOT have an Edit button available
    // because these nominations were created by Browser 1
    const browser2EditButton = page2.locator('button:has-text("Edit")');
    
    // ✅ FIXED: Edit button should not exist - Browser 2 sees voting interface instead
    await expect(browser2EditButton).not.toBeVisible();
    
    // Browser 2 should see voting interface, proving it recognizes it hasn't voted
    await expect(page2.locator('text="Add new nominations:"')).toBeVisible();
    
    console.log('✅ CROSS-BROWSER IDENTITY FIX VERIFIED: Browser 2 correctly sees voting interface');
    
    // Browser 2 can add their own nominations
    const inputs = page2.locator('input[type="text"]');
    await inputs.nth(0).fill('Browser 2 Nomination X');
    await inputs.nth(1).fill('Browser 2 Nomination Y');
    
    // Submit Browser 2's vote
    const submitButton = page2.locator('button:has-text("Submit Vote")');
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
    
    // Handle confirmation modal if present
    const modalSubmitButton = page2.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalSubmitButton.isVisible({ timeout: 2000 })) {
      await modalSubmitButton.click();
    }
    
    await page2.waitForTimeout(3000);
    
    // Now Browser 2 should see all nominations in results view
    await expect(page2.locator('text="All nominations:"')).toBeVisible();
    await expect(page2.locator('text="Browser 1 Nomination A"')).toBeVisible();
    await expect(page2.locator('text="Browser 1 Nomination B"')).toBeVisible();
    await expect(page2.locator('text="Browser 2 Nomination X"')).toBeVisible();
    await expect(page2.locator('text="Browser 2 Nomination Y"')).toBeVisible();
    
    // Browser 2 should now have Edit button for THEIR OWN nominations only
    const browser2EditButtonAfterVote = page2.locator('button:has-text("Edit")');
    await expect(browser2EditButtonAfterVote).toBeVisible();
    
    await page2.screenshot({ path: 'test-results/cross-browser-03-browser2-after-vote.png' });
    
    // Clean up
    await context2.close();
  });

  test('should maintain separate vote identities for different browser contexts', async ({ page, browser }) => {
    const homePage = new HomePage(page);
    const createPollPage = new CreatePollPage(page);
    
    // Browser 1: Create empty nomination poll
    await homePage.goToHomePage();
    await homePage.navigateToCreatePoll();
    
    await createPollPage.fillTitle('Multi-Browser Vote Identity Test');
    await createPollPage.selectPollType('nomination');
    await createPollPage.selectDeadline('10min');
    await createPollPage.fillCreatorName('Poll Creator');
    await createPollPage.submitPoll();
    await createPollPage.confirmSubmission();
    
    await createPollPage.verifyRedirectToPoll();
    await page.waitForTimeout(3000);
    
    const pollUrl = page.url();
    
    // Browser 1: Vote with nominations
    const editButton = page.locator('button:has-text("Edit")');
    await expect(editButton).toBeVisible();
    await editButton.click();
    await page.waitForTimeout(2000);
    
    await expect(page.locator('text="Add new nominations:"')).toBeVisible();
    
    const browser1Inputs = page.locator('input[type="text"]');
    await browser1Inputs.nth(0).fill('Browser 1 Choice A');
    await browser1Inputs.nth(1).fill('Browser 1 Choice B');
    
    const browser1SubmitButton = page.locator('button:has-text("Submit Vote")');
    await browser1SubmitButton.click();
    
    const modalSubmitButton1 = page.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalSubmitButton1.isVisible({ timeout: 2000 })) {
      await modalSubmitButton1.click();
    }
    
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'test-results/multi-browser-01-browser1-voted.png' });
    
    // Browser 2: Open same poll in different context
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await page2.goto(pollUrl);
    await page2.waitForTimeout(3000);
    
    // Browser 2 should see Browser 1's nominations but be able to add their own
    await expect(page2.locator('text="Browser 1 Choice A"')).toBeVisible();
    await expect(page2.locator('text="Browser 1 Choice B"')).toBeVisible();
    
    // Browser 2 should see voting interface (not results) because it hasn't voted
    await expect(page2.locator('text="Add new nominations:"')).toBeVisible();
    
    const browser2Inputs = page2.locator('input[type="text"]');
    await browser2Inputs.nth(0).fill('Browser 2 Choice X');
    await browser2Inputs.nth(1).fill('Browser 2 Choice Y');
    
    const browser2SubmitButton = page2.locator('button:has-text("Submit Vote")');
    await browser2SubmitButton.click();
    
    const modalSubmitButton2 = page2.locator('div[role="dialog"] button:has-text("Submit Vote"), .fixed button:has-text("Submit Vote")').last();
    if (await modalSubmitButton2.isVisible({ timeout: 2000 })) {
      await modalSubmitButton2.click();
    }
    
    await page2.waitForTimeout(3000);
    
    // Now both browsers should see all nominations
    await expect(page2.locator('text="Browser 1 Choice A"')).toBeVisible();
    await expect(page2.locator('text="Browser 1 Choice B"')).toBeVisible();
    await expect(page2.locator('text="Browser 2 Choice X"')).toBeVisible();
    await expect(page2.locator('text="Browser 2 Choice Y"')).toBeVisible();
    
    await page2.screenshot({ path: 'test-results/multi-browser-02-browser2-voted.png' });
    
    // Browser 1: Refresh to see all nominations
    await page.reload();
    await page.waitForTimeout(3000);
    
    await expect(page.locator('text="Browser 1 Choice A"')).toBeVisible();
    await expect(page.locator('text="Browser 1 Choice B"')).toBeVisible();
    await expect(page.locator('text="Browser 2 Choice X"')).toBeVisible();
    await expect(page.locator('text="Browser 2 Choice Y"')).toBeVisible();
    
    // Both browsers should be able to edit only their own nominations
    const browser1EditButton = page.locator('button:has-text("Edit")');
    await expect(browser1EditButton).toBeVisible();
    
    const browser2EditButton = page2.locator('button:has-text("Edit")');
    await expect(browser2EditButton).toBeVisible();
    
    await page.screenshot({ path: 'test-results/multi-browser-03-browser1-final.png' });
    
    await context2.close();
  });
});