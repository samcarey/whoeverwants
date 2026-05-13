#!/usr/bin/env node
/**
 * Focused benchmark: home-list group card click → destination ready.
 *
 * The legacy bench-navigation.mjs targets `/p/<id>` paths that are now
 * legacy redirect stubs; this one auto-discovers the card's actual href
 * from the home-list DOM and waits for `data-page-ready` matching the
 * canonical `/g/<groupShortId>` route.
 *
 * Usage:
 *   BENCH_URL=https://whoeverwants.com node scripts/bench-group-nav.mjs
 *
 * Env:
 *   BENCH_URL          Target origin. Required.
 *   BENCH_RUNS         Runs per scenario. Default 12.
 *   BENCH_POLLS        How many test polls to seed. Default 6.
 *   BENCH_HEADLESS     "0" to show the browser. Default headless.
 *   BENCH_CPU_THROTTLE CPU slowdown factor. Default 1.
 *   BENCH_JSON         Path to write JSON results.
 *   BENCH_KEEP_POLLS   "1" to skip polls cleanup (debugging).
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE_URL = (process.env.BENCH_URL || 'http://localhost:3000').replace(/\/$/, '');
const RUNS = parseInt(process.env.BENCH_RUNS || '12', 10);
const POLL_COUNT = parseInt(process.env.BENCH_POLLS || '6', 10);
const HEADLESS = process.env.BENCH_HEADLESS !== '0';
const CPU_THROTTLE = parseFloat(process.env.BENCH_CPU_THROTTLE || '1');
const JSON_OUT = process.env.BENCH_JSON;
const KEEP_POLLS = process.env.BENCH_KEEP_POLLS === '1';

function rand() { return Math.random().toString(36).slice(2, 10); }

async function apiCreatePoll(title, creatorSecret) {
  const res = await fetch(`${BASE_URL}/api/polls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      questions: [{
        title,
        question_type: 'yes_no',
        category: 'yes_no',
      }],
      creator_secret: creatorSecret,
      creator_name: 'bench',
      response_deadline: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`Create poll failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiSubmitVote(questionId, name, choice) {
  const res = await fetch(`${BASE_URL}/api/questions/${questionId}/votes`, {
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

function printTable(rows) {
  const cols = ['metric', 'n', 'min', 'p50', 'mean', 'p90', 'max'];
  const widths = cols.map((c) => c.length);
  for (const r of rows) cols.forEach((c, i) => { widths[i] = Math.max(widths[i], String(r[c] ?? '').length); });
  const line = (cells) => cells.map((v, i) => String(v ?? '').padEnd(widths[i])).join('  ');
  console.log(line(cols));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
}

async function main() {
  console.log('\n=== Group Navigation Benchmark ===');
  console.log(`URL:      ${BASE_URL}`);
  console.log(`Runs:     ${RUNS}`);
  console.log(`Polls:    ${POLL_COUNT}`);
  console.log(`Throttle: ${CPU_THROTTLE}x CPU\n`);

  console.log('Creating test polls via API...');
  const creatorSecret = `bench-${Date.now()}-${rand()}`;
  const polls = [];
  for (let i = 0; i < POLL_COUNT; i++) {
    const p = await apiCreatePoll(`Bench poll ${i + 1} ${rand()}`, creatorSecret);
    polls.push(p);
    const qid = p.questions?.[0]?.id;
    if (qid) {
      await apiSubmitVote(qid, `Alice${i}`, 'yes').catch(() => null);
      await apiSubmitVote(qid, `Bob${i}`, 'no').catch(() => null);
    }
  }
  const questionIds = polls.flatMap((p) => p.questions?.map((q) => q.id) ?? []);
  console.log(`Created ${polls.length} polls (${questionIds.length} questions).\n`);

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  if (process.env.BENCH_VERBOSE === '1') {
    page.on('console', msg => console.log(`[console:${msg.type()}]`, msg.text()));
    page.on('pageerror', err => console.log('[pageerror]', err.message));
  }
  if (CPU_THROTTLE > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  }

  // Seed localStorage with accessible question ids + creator secrets so the
  // home page surfaces our test polls.
  await page.goto(BASE_URL);
  await page.evaluate(({ ids, secrets, secret }) => {
    localStorage.setItem('accessible_question_ids', JSON.stringify(ids));
    const out = {};
    for (const id of ids) out[id] = secret;
    localStorage.setItem('question_creator_secrets', JSON.stringify({ ...secrets, ...out }));
  }, { ids: questionIds, secrets: {}, secret: creatorSecret });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-group-root-id]', { timeout: 30_000 });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-page-ready') === '/', { timeout: 30_000 });

  // Warm the group route (first visit triggers any on-demand compile etc.)
  console.log('Warming group route...');
  const firstCard = await page.$('[data-group-root-id]');
  if (firstCard) {
    await firstCard.click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-page-ready')?.startsWith('/g/'), { timeout: 30_000 });
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-group-root-id]');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-page-ready') === '/');
  }

  // === Scenario: home → group (warm) ===
  console.log('\nScenario: home → group (warm cache)');
  const results = [];
  const clickToUrl = [];
  const clickToReady = [];
  const readyAfterUrl = [];
  const clickToFirstFrame = [];
  const clickToTransitionDone = [];
  const transitionAnimation = [];

  for (let i = 0; i < RUNS; i++) {
    await page.goto(BASE_URL);
    await page.waitForSelector('[data-group-root-id]');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-page-ready') === '/');
    // Pick a different card per run if we have multiple
    const cards = await page.$$('[data-group-root-id]');
    if (cards.length === 0) throw new Error('No group cards visible');
    const idx = i % cards.length;
    try {
      const measureResult = await page.evaluate(async ({ idx }) => {
        const targets = document.querySelectorAll('[data-group-root-id]');
        const el = targets[idx];
        if (!el) throw new Error('card not found');

        const startPath = window.location.pathname.replace(/\/$/, '') || '/';
        const startReady = document.documentElement.getAttribute('data-page-ready');
        const pathNow = () => window.location.pathname.replace(/\/$/, '') || '/';
        const readyNow = () => document.documentElement.getAttribute('data-page-ready');
        const directionNow = () => document.documentElement.getAttribute('data-nav-direction');

        return new Promise((resolve, reject) => {
          let urlFlipAt = null;
          let readyAt = null;
          let firstFrameAt = null;
          let transitionDoneAt = null;
          let sawDirection = false;

          const tryFinish = () => {
            const now = performance.now() - start;
            if (urlFlipAt == null && pathNow() !== startPath) urlFlipAt = now;
            if (readyAt == null && readyNow() !== startReady && readyNow() && readyNow() !== '/') {
              readyAt = now;
            }
            if (transitionDoneAt == null) {
              if (sawDirection && !directionNow()) transitionDoneAt = now;
              else if (!sawDirection && readyAt != null && now - readyAt > 100) transitionDoneAt = readyAt;
            }
            if (readyAt != null && transitionDoneAt != null) {
              cleanup();
              resolve({
                clickToUrl: urlFlipAt,
                clickToReady: readyAt,
                readyAfterUrl: urlFlipAt != null ? readyAt - urlFlipAt : null,
                clickToTransitionDone: transitionDoneAt,
                transitionAnimation: sawDirection ? (transitionDoneAt - readyAt) : 0,
                clickToFirstFrame: firstFrameAt,
                sawDirection,
              });
            }
          };

          const obs = new MutationObserver(tryFinish);
          obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-page-ready'] });
          const obsDir = new MutationObserver(() => {
            if (directionNow()) sawDirection = true;
            tryFinish();
          });
          obsDir.observe(document.documentElement, { attributes: true, attributeFilter: ['data-nav-direction'] });
          const urlPoll = setInterval(tryFinish, 25);

          requestAnimationFrame(() => {
            firstFrameAt = performance.now() - start;
          });

          const timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out. startPath=${startPath} path=${pathNow()} ready=${readyNow()} dir=${directionNow()}`));
          }, 30_000);

          const cleanup = () => {
            obs.disconnect();
            obsDir.disconnect();
            clearInterval(urlPoll);
            clearTimeout(timeoutId);
          };

          const start = performance.now();
          if (directionNow()) sawDirection = true;
          // The GroupListItem renders the inner clickable div with the
          // onClick handler. Try clicking the element itself first, fall
          // back to children.
          el.click();
          // Some implementations register onClick on a child div
          const inner = el.querySelector('div[role="button"], button, div');
          if (inner && inner !== el) inner.click();
        });
      }, { idx });

      clickToUrl.push(measureResult.clickToUrl ?? measureResult.clickToReady);
      clickToReady.push(measureResult.clickToReady);
      readyAfterUrl.push(measureResult.readyAfterUrl ?? 0);
      clickToFirstFrame.push(measureResult.clickToFirstFrame ?? 0);
      clickToTransitionDone.push(measureResult.clickToTransitionDone);
      transitionAnimation.push(measureResult.transitionAnimation);
      process.stdout.write(`  run ${i + 1}: click→ready=${Math.round(measureResult.clickToReady)}ms  url=${Math.round(measureResult.clickToUrl ?? 0)}ms  done=${Math.round(measureResult.clickToTransitionDone)}ms\n`);
    } catch (err) {
      console.warn(`  run ${i + 1}: ${err.message.split('\n')[0]}`);
    }
  }

  console.log('\n=== Results (ms) ===\n');
  const rows = [
    { metric: 'click → first frame', ...stats(clickToFirstFrame) },
    { metric: 'click → url flip', ...stats(clickToUrl) },
    { metric: 'click → data-page-ready', ...stats(clickToReady) },
    { metric: 'ready after url flip', ...stats(readyAfterUrl) },
    { metric: 'transition animation', ...stats(transitionAnimation) },
    { metric: 'click → transition done', ...stats(clickToTransitionDone) },
  ];
  printTable(rows);

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({
      base_url: BASE_URL,
      runs: RUNS,
      cpu_throttle: CPU_THROTTLE,
      timestamp: new Date().toISOString(),
      results: rows,
      raw: { clickToUrl, clickToReady, readyAfterUrl, clickToFirstFrame, clickToTransitionDone, transitionAnimation },
    }, null, 2));
    console.log(`\nJSON written to ${JSON_OUT}`);
  }

  await browser.close();
  if (!KEEP_POLLS) {
    console.log('\n(Test polls left in DB; they\'re isolated to the bench creator_secret.)');
  }
  console.log('\nDone.');
}

main().catch((err) => { console.error(err); process.exit(1); });
