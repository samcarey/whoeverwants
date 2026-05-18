import { test, expect } from '@playwright/test';

/**
 * Poll-creation UI tests against the current architecture.
 *
 * The current flow:
 *   1. User lands on /g/ (empty placeholder) — typically via the new group button.
 *   2. Bubble bar shows one button per BUILT_IN_TYPES entry plus "Other".
 *      Each bubble has aria-label="Add <Category> question" (or "Add Other"
 *      for the custom-text fallback).
 *   3. Tapping a bubble opens the bottom-sheet new-poll modal seeded with
 *      that category.
 */

test.describe('Poll creation via bubble modal', () => {
  test('opening Yes/No bubble opens the modal with title input', async ({ page }) => {
    await page.goto('/g/');
    const yesNoBubble = page.getByRole('button', { name: /^Add Yes\s*\/\s*No question$/i });
    await expect(yesNoBubble).toBeVisible({ timeout: 10_000 });
    await yesNoBubble.click();
    const titleInput = page.locator('input[type="text"]').first();
    await expect(titleInput).toBeVisible({ timeout: 5_000 });
  });

  test('all built-in category bubbles are present on /g/', async ({ page }) => {
    await page.goto('/g/');
    // Categories from components/TypeFieldInput.tsx BUILT_IN_TYPES + Other.
    const expectedAriaPatterns = [
      /^Add Yes\s*\/\s*No question$/i,
      /^Add Time question$/i,
      /^Add Restaurant question$/i,
      /^Add Place question$/i,
      /^Add Movie question$/i,
      /^Add Video Game question$/i,
      /^Add Other question$/i,
    ];
    for (const pat of expectedAriaPatterns) {
      const btn = page.getByRole('button', { name: pat });
      await expect(btn, `expected bubble matching ${pat} to be visible`).toBeVisible({ timeout: 10_000 });
    }
  });
});
