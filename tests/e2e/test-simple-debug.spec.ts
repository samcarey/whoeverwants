import { test, expect } from '@playwright/test';

test('debug: check create poll page elements', async ({ page }) => {
  await page.goto('http://localhost:3000/create-poll');
  
  // Wait for page to load with a longer timeout
  await page.waitForLoadState('networkidle');
  
  // Log all input elements on the page
  const inputs = await page.locator('input').all();
  console.log(`Found ${inputs.length} input elements`);
  
  for (let i = 0; i < inputs.length; i++) {
    const placeholder = await inputs[i].getAttribute('placeholder');
    const type = await inputs[i].getAttribute('type');
    const value = await inputs[i].getAttribute('value');
    console.log(`Input ${i}: type="${type}", placeholder="${placeholder}", value="${value}"`);
  }
  
  // Try to find the title input using different selectors
  const titleInput = page.locator('input').filter({ hasText: /title/i }).first();
  const titleInputByPlaceholder = page.locator('input[placeholder*="title"]').first();
  const titleInputByName = page.locator('input[name*="title"]').first();
  
  // Check which one exists
  if (await titleInput.count() > 0) {
    console.log('Found title input by text filter');
  }
  if (await titleInputByPlaceholder.count() > 0) {
    console.log('Found title input by placeholder');
    const placeholder = await titleInputByPlaceholder.getAttribute('placeholder');
    console.log('Actual placeholder:', placeholder);
  }
  if (await titleInputByName.count() > 0) {
    console.log('Found title input by name');
  }
  
  // Check for buttons
  const createButton = page.locator('button').filter({ hasText: 'Create' });
  console.log(`Found ${await createButton.count()} buttons with "Create" text`);
  
  // Take a screenshot for debugging
  await page.screenshot({ path: 'test-results/debug-create-poll-page.png' });
});