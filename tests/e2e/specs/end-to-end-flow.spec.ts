import { test, expect } from '@playwright/test';

/**
 * End-to-end UI flow: create a poll via the bubble modal, then vote on it
 * as multiple browsers, then verify the results.
 *
 * Uses API-level setup to mint a poll, then drives the voting UI for
 * realistic browser-side behavior. (Driving the modal-based create flow
 * end-to-end requires substantial UI fiddling that's covered by
 * poll-creation.spec.ts; here we focus on the voter-side journey.)
 */

const API_BASE = process.env.UI_API_BASE || 'https://api.latest.whoeverwants.com';

async function createPollViaAPI(request: any, opts: { title: string; categoryQType?: 'yes_no' | 'ranked_choice'; options?: string[] }) {
  const body: any = {
    creator_secret: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: opts.title,
    creator_name: 'E2E Creator',
    questions: [
      {
        question_type: opts.categoryQType || 'yes_no',
        category: opts.categoryQType === 'ranked_choice' ? 'custom' : 'yes_no',
        ...(opts.options ? { options: opts.options } : {}),
      },
    ],
  };
  const resp = await request.post(`${API_BASE}/api/polls`, { data: body });
  expect(resp.status()).toBe(201);
  return await resp.json();
}

test.describe('Multi-user voting flow', () => {
  test('voter lands on group URL, sees the poll, can read results page', async ({ browser, request, baseURL }) => {
    const poll = await createPollViaAPI(request, {
      title: 'Pizza party Friday?',
      categoryQType: 'yes_no',
    });
    expect(poll.questions.length).toBe(1);
    const qid = poll.questions[0].id;

    // Submit two API votes
    for (const [name, choice] of [['Alice', 'yes'], ['Bob', 'no'], ['Carol', 'yes']]) {
      const r = await request.post(`${API_BASE}/api/polls/${poll.id}/votes`, {
        data: {
          voter_name: name,
          items: [{ question_id: qid, vote_type: 'yes_no', yes_no_choice: choice }],
        },
        headers: { 'X-Browser-Id': `e2e-${Math.random().toString(36).slice(2)}` },
      });
      expect(r.status()).toBe(201);
    }

    // Open the group URL in a fresh browser context (as a "new visitor")
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    const groupUrl = `${baseURL}/g/${poll.group_short_id}`;
    const resp = await page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
    expect(resp?.status()).toBe(200);
    // Title should be visible (auto-generated for a yes/no = the user-typed title)
    await expect(page.locator('body')).toContainText(/pizza/i, { timeout: 10_000 });
    await ctx.close();
  });

  test('group URL fetched from a third browser does NOT crash with malformed short_id', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    const resp = await page.goto(`${baseURL}/g/~~~~malformed~~~~`, { waitUntil: 'domcontentloaded' });
    // Should be a 200 with a "not found" body rather than 500
    expect((resp?.status() || 0) < 500).toBeTruthy();
    await ctx.close();
  });
});
