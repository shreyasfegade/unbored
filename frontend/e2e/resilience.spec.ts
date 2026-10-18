import { expect, test } from '@playwright/test';
import { asReturningVisitor, getPick } from './helpers';

test('a failed catalog download shows a retry that works', async ({ page }) => {
  await asReturningVisitor(page);
  await page.route('**/api/ai/quota', (r) => r.fulfill({ json: { free_tier: false } }));
  let fail = true;
  await page.route('**/data/cards.*.json', (r) => (fail ? r.fulfill({ status: 503, body: 'down' }) : r.fallback()));
  await page.goto('/');
  const banner = page.getByRole('alert').filter({ hasText: /catalog didn.t load/i });
  await expect(banner).toBeVisible();
  fail = false;
  await banner.getByRole('button', { name: /retry/i }).click();
  await expect(banner).toBeHidden();
  await getPick(page);
});

test('the free AI tier picks and says so', async ({ page }) => {
  await asReturningVisitor(page);
  await page.route('**/api/ai/quota', (r) => r.fulfill({ json: { free_tier: true, limit: 20, remaining: 7 } }));
  await page.route('**/api/ai/curate', (r) =>
    r.fulfill({
      json: {
        ai_status: 'used', tier: 'free', provider: 'gemini', remaining: 6,
        curated: { primary_index: 1, alternate_indices: [0, 2], why: 'Stubbed reason from the AI.', why_by_index: { 1: 'Stubbed reason from the AI.' } },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByText(/free tier/i).first()).toBeVisible();
  await getPick(page);
  await expect(page.getByText('Stubbed reason from the AI.')).toBeVisible();
  await expect(page.getByText(/AI pick · Gemini, shared free tier/)).toBeVisible();
});

test('an AI timeout falls back to the engine, honestly', async ({ page }) => {
  await asReturningVisitor(page);
  await page.route('**/api/ai/quota', (r) => r.fulfill({ json: { free_tier: true, limit: 20, remaining: 7 } }));
  await page.route('**/api/ai/curate', (r) => r.fulfill({ json: { ai_status: 'timeout', tier: 'free', remaining: 6 } }));
  await page.goto('/');
  await getPick(page);
  await expect(page.getByText('Engine pick', { exact: true })).toBeVisible();
  await expect(page.getByText(/AI was slow to respond/i)).toBeVisible();
});

test('an unknown route gets a real 404 page', async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto('/no/such/page');
  await expect(page.getByRole('heading', { name: /nothing.s playing here/i })).toBeVisible();
  await page.getByRole('link', { name: /get a pick/i }).click();
  await expect(page.getByText(/how are you feeling/i)).toBeVisible();
});
