import { test, expect } from '@playwright/test';

/**
 * Smoke tests against the current architecture.
 *
 * The app no longer has a /create-question route — questions are created
 * via a bottom-sheet modal opened from category bubble buttons on /g/.
 * Tests here verify the basic surfaces load and the modal can be opened.
 */

test.describe('Smoke', () => {
  test('home page loads with correct title', async ({ page }) => {
    const resp = await page.goto('/');
    expect(resp?.status()).toBe(200);
    await expect(page).toHaveTitle(/WhoeverWants/i);
  });

  test('settings page loads with theme switcher', async ({ page }) => {
    await page.goto('/settings/');
    await page.waitForLoadState('domcontentloaded');
    // The 3-option theme switcher uses System / Light / Dark labels (via aria-label or text).
    const themeRow = page.getByText(/Theme/i).first();
    await expect(themeRow).toBeVisible({ timeout: 10_000 });
  });

  test('/g/ (empty group placeholder) shows bubble bar', async ({ page }) => {
    await page.goto('/g/');
    // Wait for the Yes/No bubble specifically — it's the first BUILT_IN_TYPES
    // entry and signals the portal-driven bubble bar has hydrated.
    await expect(page.getByRole('button', { name: /Add Yes\s*\/\s*No question/i }))
      .toBeVisible({ timeout: 10_000 });
    expect(await page.locator('button').count()).toBeGreaterThanOrEqual(5);
  });

  test('PWA manifest.json is reachable and valid', async ({ page }) => {
    const resp = await page.goto('/manifest.json');
    expect(resp?.status()).toBe(200);
    const text = await page.content();
    // The page contains the JSON as text
    const body = await resp!.body();
    const json = JSON.parse(body.toString());
    expect(json.name).toBeTruthy();
    expect(json.icons.length).toBeGreaterThan(0);
  });

  test('AASA file is served as JSON', async ({ request }) => {
    const resp = await request.get('/.well-known/apple-app-site-association');
    expect(resp.status()).toBe(200);
    const ct = resp.headers()['content-type'] || '';
    expect(ct).toContain('json');
    const json = await resp.json();
    expect(json.applinks?.details?.length).toBeGreaterThan(0);
  });

  test('non-existent group route shows graceful "not found"', async ({ page }) => {
    await page.goto('/g/DEFINITELY-NOT-A-REAL-ID');
    await expect(page.locator('body')).toContainText(/group not found|not found/i, { timeout: 10_000 });
  });
});
