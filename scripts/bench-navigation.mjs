#!/usr/bin/env node
/**
 * Navigation performance benchmark.
 *
 * Measures the time from a synthesized click to the destination signaling
 * `data-page-ready`. That's the metric that determines whether a view
 * transition captures a fully-rendered "new" snapshot or a stale one (the
 * "old page slides to same old page" bug).
 *
 * All timing is done inside the browser via `performance.now()` so we don't
 * pay Playwright's CDP round-trip overhead per measurement. The click is
 * synthesized with `element.click()` — good enough because the app's
 * navigation handlers are standard onClick handlers.
 *
 * Scenarios covered:
 *   1. Cold home load          — page.goto + reload baseline
 *   2. Home → Thread (warm)    — same session, cache populated
 *   3. Home → Thread (cold)    — reload before each run, in-memory cache gone
 *   4. Thread → Home (back)    — in-app back button
 *   5. Rapid Home ⇄ Thread     — per-hop during a fast flow
 *
 * Usage:
 *   BENCH_URL=https://<slug>.dev.whoeverwants.com node scripts/bench-navigation.mjs
 *   BENCH_URL=... BENCH_RUNS=10 BENCH_HEADLESS=0 node scripts/bench-navigation.mjs
 *
 * Env:
 *   BENCH_URL          Target origin. Default http://localhost:3000
 *   BENCH_RUNS         Runs per scenario. Default 8
 *   BENCH_HEADLESS     "0" to show the browser. Default headless.
 *   BENCH_CPU_THROTTLE CPU slowdown factor (e.g. "4" = 4x slower). Default 1.
 *   BENCH_JSON         Path to write machine-readable results.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE_URL = (process.env.BENCH_URL || 'http://localhost:3000').replace(/\/$/, '');
const RUNS = parseInt(process.env.BENCH_RUNS || '8', 10);
const HEADLESS = process.env.BENCH_HEADLESS !== '0';
const CPU_THROTTLE = parseFloat(process.env.BENCH_CPU_THROTTLE || '1');
const JSON_OUT = process.env.BENCH_JSON;
const POLL_COUNT = 6;
const NAV_READY_TIMEOUT = 30_000;

function rand() { return Math.random().toString(36).slice(2, 10); }

async function apiCreatePoll(title, creatorSecret) {
  const res = await fetch(`${BASE_URL}/api/polls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      poll_type: 'yes_no',
      creator_secret: creatorSecret,
      creator_name: 'bench',
      response_deadline: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`Create poll failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiSubmitVote(pollId, name, choice) {
  const res = await fetch(`${BASE_URL}/api/polls/${pollId}/votes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vote_type: 'yes_no',
      yes_no_choice: choice,
      voter_name: name,
    }),
  });
  if (!res.ok) throw new Error(`Submit vote failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function stats(samples) {
  if (samples.length === 0) return { n: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const pick = (q) => sorted[Math.min(n - 1, Math.floor(n * q))];
  return {
    n,
    min: Math.round(sorted[0]),
    p50: Math.round(pick(0.5)),
    mean: Math.round(mean),
    p90: Math.round(pick(0.9)),
    max: Math.round(sorted[n - 1]),
  };
}

function normalize(path) {
  return path.replace(/\/$/, '') || '/';
}

async function waitForReady(page, targetPath, timeout = NAV_READY_TIMEOUT) {
  const target = normalize(targetPath);
  try {
    await page.waitForFunction(
      (t) => document.documentElement.getAttribute('data-page-ready') === t,
      target,
      { timeout },
    );
  } catch (err) {
    const diag = await page.evaluate(() => ({
      ready: document.documentElement.getAttribute('data-page-ready'),
      path: window.location.pathname,
      body: document.body?.innerText?.slice(0, 200) || '',
    }));
    throw new Error(`waitForReady(${target}) timed out. State: ${JSON.stringify(diag)}`);
  }
}

/**
 * Measure click-to-ready inside the browser. Returns:
 *   - clickToReady: ms from click until data-page-ready matches target
 *   - clickToUrl:   ms from click until location.pathname matches target
 *   - readyAfterUrl: ms that "ready" lagged the URL flip. Large values on a
 *     well-behaved run mean the destination compiled/fetched slowly.
 */
async function measureClickNav(page, clickSelector, targetPath) {
  const target = normalize(targetPath);
  return page.evaluate(
    ({ clickSelector, target }) =>
      new Promise((resolve, reject) => {
        const el = document.querySelector(clickSelector);
        if (!el) { reject(new Error('element not found: ' + clickSelector)); return; }

        let urlFlipAt = null;
        const pathNow = () => window.location.pathname.replace(/\/$/, '') || '/';
        const readyNow = () => document.documentElement.getAttribute('data-page-ready');

        const tryResolve = () => {
          if (readyNow() === target) {
            obs.disconnect();
            clearInterval(urlPoll);
            clearTimeout(timeoutId);
            resolve({
              clickToReady: performance.now() - start,
              clickToUrl: urlFlipAt,
              readyAfterUrl: urlFlipAt != null ? (performance.now() - start) - urlFlipAt : null,
            });
          }
        };

        const obs = new MutationObserver(tryResolve);
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-page-ready'] });

        const urlPoll = setInterval(() => {
          if (urlFlipAt == null && pathNow() === target) {
            urlFlipAt = performance.now() - start;
          }
          tryResolve();
        }, 5);

        const timeoutId = setTimeout(() => {
          obs.disconnect();
          clearInterval(urlPoll);
          reject(new Error(`Timed out waiting for ${target}; ready=${readyNow()} path=${pathNow()}`));
        }, 30_000);

        const start = performance.now();
        el.click();
      }),
    { clickSelector, target },
  );
}

function printTable(rows) {
  const cols = ['scenario', 'metric', 'n', 'min', 'p50', 'mean', 'p90', 'max'];
  const widths = cols.map((c) => c.length);
  for (const r of rows) {
    cols.forEach((c, i) => { widths[i] = Math.max(widths[i], String(r[c] ?? '').length); });
  }
  const line = (cells) => cells.map((v, i) => String(v ?? '').padEnd(widths[i])).join('  ');
  console.log(line(cols));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
}

function addResult(results, scenario, metric, samples) {
  const s = stats(samples);
  results.push({ scenario, metric, ...s });
}

async function main() {
  console.log('\n=== Navigation Benchmark ===');
  console.log(`URL:      ${BASE_URL}`);
  console.log(`Runs:     ${RUNS}`);
  console.log(`Throttle: ${CPU_THROTTLE}x CPU\n`);

  // Seed test data
  console.log('Creating test polls via API...');
  const creatorSecret = `bench-${Date.now()}-${rand()}`;
  const polls = [];
  for (let i = 0; i < POLL_COUNT; i++) {
    const p = await apiCreatePoll(`Bench poll ${i + 1}`, creatorSecret);
    polls.push(p);
    await apiSubmitVote(p.id, `Alice${i}`, 'yes').catch(() => null);
    await apiSubmitVote(p.id, `Bob${i}`, 'no').catch(() => null);
  }
  const pollIds = polls.map((p) => p.id);
  console.log(`Created ${polls.length} polls.\n`);

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  if (process.env.BENCH_VERBOSE === '1') {
    page.on('console', msg => console.log(`[console:${msg.type()}]`, msg.text()));
    page.on('pageerror', err => console.log('[pageerror]', err.message));
  }

  if (CPU_THROTTLE > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  }

  // Seed localStorage
  await page.goto(BASE_URL);
  await page.evaluate(({ ids, secret }) => {
    localStorage.setItem('accessible_poll_ids', JSON.stringify(ids));
    const secrets = {};
    for (const id of ids) secrets[id] = secret;
    localStorage.setItem('poll_creator_secrets', JSON.stringify(secrets));
  }, { ids: pollIds, secret: creatorSecret });
  await page.reload();
  await waitForReady(page, '/');
  await page.waitForSelector(`[data-thread-root-id]`);

  const results = [];

  // --- Scenario 1: Cold home load ---
  // Each run creates a fresh browser context (no localStorage, no HTTP cache)
  // and measures goto + reload-with-populated-localStorage + ready. On dev
  // servers the first hit of any route incurs Next.js on-demand compile —
  // expect huge variance; cold compile can exceed 30s. Fewer runs here since
  // the context creation + goto is itself the expensive part.
  console.log('Scenario 1: cold home load');
  {
    const samples = [];
    const coldRuns = Math.min(RUNS, 3);
    for (let i = 0; i < coldRuns; i++) {
      const c2 = await browser.newContext({ viewport: { width: 430, height: 932 } });
      const p2 = await c2.newPage();
      if (CPU_THROTTLE > 1) {
        const cdp = await c2.newCDPSession(p2);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
      }
      try {
        await p2.goto(BASE_URL, { timeout: 60_000 });
        await p2.evaluate(({ ids, secret }) => {
          localStorage.setItem('accessible_poll_ids', JSON.stringify(ids));
          const secrets = {};
          for (const id of ids) secrets[id] = secret;
          localStorage.setItem('poll_creator_secrets', JSON.stringify(secrets));
        }, { ids: pollIds, secret: creatorSecret });
        const t0 = Date.now();
        await p2.reload({ timeout: 60_000 });
        await waitForReady(p2, '/', 60_000);
        await p2.waitForSelector(`[data-thread-root-id]`, { timeout: 60_000 });
        samples.push(Date.now() - t0);
      } finally {
        await c2.close();
      }
    }
    addResult(results, 'cold home load', 'goto+ready', samples);
  }

  // Pre-warm the thread route: on dev servers, the first hit of
  // `/thread/[id]` triggers Next.js on-demand compile (can exceed 30s).
  // Hitting it once here lets the real scenarios measure warm-compile
  // timings; otherwise the first click in every scenario eats the compile.
  console.log('Warming up thread route...');
  {
    const thread = polls[0];
    const threadPath = `/thread/${thread.short_id || thread.id}`;
    await page.goto(`${BASE_URL}${threadPath}`, { timeout: 60_000 });
    await waitForReady(page, threadPath, 60_000);
  }

  // --- Scenario 2: Home → Thread (warm cache) ---
  console.log('Scenario 2: home → thread (warm)');
  {
    const readySamples = [];
    const urlSamples = [];
    const readyLagSamples = [];
    for (let i = 0; i < RUNS; i++) {
      await page.goto(BASE_URL);
      await waitForReady(page, '/');
      await page.waitForSelector(`[data-thread-root-id]`);
      const thread = polls[i % polls.length];
      const threadPath = `/thread/${thread.short_id || thread.id}`;
      const m = await measureClickNav(page, `[data-thread-root-id="${thread.id}"] > div`, threadPath);
      readySamples.push(m.clickToReady);
      urlSamples.push(m.clickToUrl ?? m.clickToReady);
      readyLagSamples.push(m.readyAfterUrl ?? 0);
    }
    addResult(results, 'home → thread (warm)', 'click → ready', readySamples);
    addResult(results, 'home → thread (warm)', 'click → url', urlSamples);
    addResult(results, 'home → thread (warm)', 'ready after url', readyLagSamples);
  }

  // --- Scenario 3: Home → Thread (cold cache) ---
  // `page.goto(BASE_URL)` fully tears down the page (cache, in-flight requests)
  // on each run, simulating a first-time visitor. `reload()` alone would keep
  // whatever URL we ended on from the previous scenario.
  console.log('Scenario 3: home → thread (cold)');
  {
    const readySamples = [];
    for (let i = 0; i < RUNS; i++) {
      await page.goto(BASE_URL);
      await waitForReady(page, '/');
      await page.waitForSelector(`[data-thread-root-id]`);
      const thread = polls[i % polls.length];
      const threadPath = `/thread/${thread.short_id || thread.id}`;
      const m = await measureClickNav(page, `[data-thread-root-id="${thread.id}"] > div`, threadPath);
      readySamples.push(m.clickToReady);
    }
    addResult(results, 'home → thread (cold)', 'click → ready', readySamples);
  }

  // Back nav (`navigateBackWithTransition` → `window.history.back`) can
  // destroy the page.evaluate execution context mid-call, so scenarios 4/5
  // use Node-side timing with Playwright's context-aware click + wait.
  async function measureBackToHome() {
    const t0 = Date.now();
    const btn = page.locator('button[aria-label="Go back"]').first();
    if (await btn.count() > 0) {
      await btn.click();
    } else {
      await page.evaluate(() => window.history.back());
    }
    await waitForReady(page, '/');
    return Date.now() - t0;
  }

  async function measureHomeToThread(thread) {
    const threadPath = `/thread/${thread.short_id || thread.id}`;
    const t0 = Date.now();
    await page.locator(`[data-thread-root-id="${thread.id}"] > div`).click();
    await waitForReady(page, threadPath);
    return Date.now() - t0;
  }

  // --- Scenario 4: Thread → Home (back button) ---
  console.log('Scenario 4: thread → home (back)');
  {
    const samples = [];
    for (let i = 0; i < RUNS; i++) {
      const thread = polls[i % polls.length];
      const threadPath = `/thread/${thread.short_id || thread.id}`;
      await page.goto(BASE_URL);
      await waitForReady(page, '/');
      await page.waitForSelector(`[data-thread-root-id]`);
      await page.locator(`[data-thread-root-id="${thread.id}"] > div`).click();
      await waitForReady(page, threadPath);
      samples.push(await measureBackToHome());
    }
    addResult(results, 'thread → home (back)', 'click → ready', samples);
  }

  // --- Scenario 5: Rapid Home ⇄ Thread ---
  console.log('Scenario 5: rapid home ⇄ thread');
  {
    const samples = [];
    await page.goto(BASE_URL);
    await waitForReady(page, '/');
    await page.waitForSelector(`[data-thread-root-id]`);
    for (let i = 0; i < RUNS; i++) {
      const thread = polls[i % polls.length];
      samples.push(await measureHomeToThread(thread));
      samples.push(await measureBackToHome());
    }
    addResult(results, 'rapid home ⇄ thread', 'click → ready', samples);
  }

  // --- Report ---
  console.log('\n=== Results (milliseconds) ===\n');
  printTable(results);

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({
      base_url: BASE_URL,
      runs: RUNS,
      cpu_throttle: CPU_THROTTLE,
      timestamp: new Date().toISOString(),
      results,
    }, null, 2));
    console.log(`\nJSON written to ${JSON_OUT}`);
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch((err) => { console.error(err); process.exit(1); });
