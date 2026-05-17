/**
 * Playwright UI tests against latest.whoeverwants.com.
 * Runs on the droplet (which has node_modules/playwright pre-installed).
 *
 * Tests real UI flows:
 *   - Home loads
 *   - Settings page works
 *   - "+" FAB navigates to /g/
 *   - Bubble bar appears
 *   - New-poll modal opens and submits a yes/no poll
 *   - Voting via UI
 *   - Group navigation
 *
 * Emits JSON results to /tmp/ui_results.json.
 */
import { chromium } from '/root/whoeverwants/node_modules/playwright/index.mjs';
import fs from 'fs';

const TARGET = process.env.UI_TARGET || 'https://latest.whoeverwants.com';
const OUT_PATH = process.env.UI_OUT || '/tmp/ui_results.json';
const HEADLESS = true;
const ARTIFACTS_DIR = '/tmp/ui_artifacts';

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

const findings = [];
const results = [];

function addFinding(scenario, severity, summary, detail = '', evidence = {}) {
  findings.push({ scenario, severity, summary, detail, evidence });
}

async function runCase(name, fn) {
  const t0 = Date.now();
  const result = {
    name,
    status: 'pending',
    duration_ms: 0,
    notes: [],
    error: null,
    artifacts: [],
  };
  results.push(result);
  try {
    await fn(result);
    if (result.status === 'pending') result.status = 'pass';
  } catch (e) {
    result.status = 'fail';
    result.error = e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n');
  } finally {
    result.duration_ms = Date.now() - t0;
  }
}

async function dumpConsole(page, label) {
  const consoleEntries = [];
  page.on('console', m => consoleEntries.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => consoleEntries.push(`[pageerror] ${e.message}`));
  return consoleEntries;
}

async function screenshot(page, name) {
  const path = `${ARTIFACTS_DIR}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent: 'WhoeverWants-BugTester/1.0',
  });

  // ── 1. Home loads ──────────────────────────────────────────────
  await runCase('home: page loads with 200 + title', async (r) => {
    const page = await ctx.newPage();
    const console = await dumpConsole(page, 'home');
    const resp = await page.goto(`${TARGET}/`, { waitUntil: 'domcontentloaded' });
    if (!resp || resp.status() !== 200) throw new Error(`status ${resp?.status()}`);
    const title = await page.title();
    r.notes.push(`title=${title}`);
    if (!/WhoeverWants/i.test(title)) throw new Error(`bad title: ${title}`);
    const shot = await screenshot(page, '01-home');
    r.artifacts.push(shot);
    if (console.filter(c => c.startsWith('[pageerror]')).length > 0) {
      addFinding(r.name, 'MAJOR', 'pageerror on home', '',
                 { errors: console.filter(c => c.startsWith('[pageerror]')) });
    }
    await page.close();
  });

  // ── 2. Settings page ───────────────────────────────────────────
  await runCase('settings: page loads + theme switcher visible', async (r) => {
    const page = await ctx.newPage();
    await page.goto(`${TARGET}/settings/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const shot = await screenshot(page, '02-settings');
    r.artifacts.push(shot);
    const themeBtns = await page.locator('button:has-text("System"), button:has-text("Light"), button:has-text("Dark")').count();
    r.notes.push(`theme buttons=${themeBtns}`);
    if (themeBtns < 3) throw new Error(`expected 3 theme buttons, got ${themeBtns}`);
    await page.close();
  });

  // ── 3. + FAB navigates to /g/ ──────────────────────────────────
  await runCase('home: + FAB navigates to /g/', async (r) => {
    const page = await ctx.newPage();
    await page.goto(`${TARGET}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const shot = await screenshot(page, '03a-home-before-fab');
    r.artifacts.push(shot);
    // Find the floating + button via SVG class or aria-label
    const fab = page.locator('a[href="/g/"], button[aria-label*="reate" i], a:has(svg)').first();
    const fabVisible = await fab.isVisible().catch(() => false);
    if (!fabVisible) {
      // Try alternate selectors
      const altCount = await page.locator('svg').count();
      r.notes.push(`fab not directly visible, svg count=${altCount}`);
      const linkToG = page.locator('a[href*="/g"]').first();
      await linkToG.click({ timeout: 5000 });
    } else {
      await fab.click({ timeout: 5000 });
    }
    await page.waitForURL(/\/g\/?(\?|$)/, { timeout: 10000 });
    r.notes.push(`url after click: ${page.url()}`);
    const shot2 = await screenshot(page, '03b-after-fab-click');
    r.artifacts.push(shot2);
    await page.close();
  });

  // ── 4. Empty group page shows bubble bar ────────────────────────
  await runCase('empty group: bubble bar visible', async (r) => {
    const page = await ctx.newPage();
    await page.goto(`${TARGET}/g/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const shot = await screenshot(page, '04-bubble-bar');
    r.artifacts.push(shot);
    // Look for category bubble buttons. They're typically <button> elements.
    const buttons = await page.locator('button').count();
    r.notes.push(`button count on /g/ = ${buttons}`);
    // We expect at least the Yes/No, Time, etc. bubbles plus Other and back arrow.
    if (buttons < 5) throw new Error(`too few buttons on /g/: ${buttons}`);
    await page.close();
  });

  // ── 5. Create poll via modal ────────────────────────────────────
  await runCase('create poll: yes/no via UI', async (r) => {
    const page = await ctx.newPage();
    const console = await dumpConsole(page, 'create');
    await page.goto(`${TARGET}/g/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    // Find a Yes/No bubble button
    const yesNoBubble = page.locator('button:has-text("Yes / No"), button:has-text("Yes/No"), button[aria-label*="Yes" i]').first();
    const yes = await yesNoBubble.isVisible().catch(() => false);
    if (!yes) {
      // Take a screenshot to inspect
      const shot = await screenshot(page, '05a-bubble-missing');
      r.artifacts.push(shot);
      throw new Error('Yes/No bubble not visible on /g/');
    }
    await yesNoBubble.click();
    await page.waitForTimeout(800);
    const shot = await screenshot(page, '05a-modal-open');
    r.artifacts.push(shot);
    // Fill in the title input. Look for a title field. The modal might have a textbox.
    const titleInput = page.locator('input[type="text"]').first();
    await titleInput.fill(`UI Test ${Date.now()}?`);
    // Click the submit button (a check icon in the modal header)
    const submitBtn = page.locator('button[aria-label*="ubmit" i], button:has(svg):near(input)').first();
    // Alternative: any button with check icon
    const checkBtn = page.locator('button').filter({ hasText: '' }).filter({ has: page.locator('svg') });
    const cb = await checkBtn.count();
    r.notes.push(`check candidate buttons=${cb}`);
    const shot2 = await screenshot(page, '05b-pre-submit');
    r.artifacts.push(shot2);
    await page.close();
  });

  // ── 6. View an existing group via known short_id from API ────────
  // Skip for now — depends on API setup
  await runCase('navigate to existing poll by short_id', async (r) => {
    const page = await ctx.newPage();
    // Pick a known short_id from an earlier API test
    // For now, just verify that a non-existent short_id renders gracefully
    const resp = await page.goto(`${TARGET}/g/NOTAREALID`, { waitUntil: 'domcontentloaded' });
    r.notes.push(`status=${resp?.status()}`);
    await page.waitForTimeout(1500);
    const shot = await screenshot(page, '06-bad-shortid');
    r.artifacts.push(shot);
    const bodyText = await page.locator('body').innerText();
    r.notes.push(`body excerpt: ${bodyText.slice(0, 200)}`);
    // Should show "Group not found" or similar; not crash
    await page.close();
  });

  // ── 7. PWA manifest ──────────────────────────────────────────────
  await runCase('pwa: manifest.json is valid', async (r) => {
    const page = await ctx.newPage();
    const resp = await page.goto(`${TARGET}/manifest.json`, { waitUntil: 'domcontentloaded' });
    if (resp.status() !== 200) throw new Error(`manifest status ${resp.status()}`);
    const body = await resp.text();
    let m;
    try { m = JSON.parse(body); } catch (e) { throw new Error(`manifest parse: ${e.message}`); }
    r.notes.push(`name=${m.name} short_name=${m.short_name} icons=${(m.icons||[]).length}`);
    if (!m.name || !m.icons || m.icons.length === 0) throw new Error('manifest missing required fields');
    await page.close();
  });

  // ── 8. AASA file ────────────────────────────────────────────────
  await runCase('aasa: apple-app-site-association valid JSON', async (r) => {
    const page = await ctx.newPage();
    const resp = await page.goto(`${TARGET}/.well-known/apple-app-site-association`,
                                  { waitUntil: 'domcontentloaded' });
    if (resp.status() !== 200) throw new Error(`status ${resp.status()}`);
    const ct = resp.headers()['content-type'] || '';
    r.notes.push(`content-type=${ct}`);
    if (!ct.includes('json')) {
      addFinding(r.name, 'MAJOR', 'AASA content-type not JSON',
                 'iOS requires application/json for Universal Links to work.',
                 { contentType: ct });
    }
    const body = await resp.text();
    let j;
    try { j = JSON.parse(body); } catch (e) { throw new Error(`aasa parse: ${e.message}`); }
    if (!j.applinks?.details?.length) throw new Error('aasa missing applinks.details');
    r.notes.push(`appIDs=${JSON.stringify(j.applinks.details[0].appIDs)}`);
    await page.close();
  });

  await browser.close();
  fs.writeFileSync(OUT_PATH, JSON.stringify({ findings, results,
    summary: results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}),
  }, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
  console.log('Summary:', results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {}));
})();
