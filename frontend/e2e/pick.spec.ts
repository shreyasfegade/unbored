import { expect, test } from '@playwright/test';
import { asReturningVisitor, getPick, noAI } from './helpers';

test('onboarding → pick → reveal → watchlist → library', async ({ page }) => {
  await noAI(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();

  // Five favourites from the first rail.
  const posters = page.locator('button[aria-pressed="false"]');
  for (let i = 0; i < 5; i++) await posters.first().click();
  await expect(page.getByText(/5 of 5 selected/)).toBeVisible();
  await page.getByRole('button', { name: /continue with 5/i }).click();

  // Account (if configured) and AI steps are skippable.
  for (const name of [/skip/i, /skip/i]) {
    const skip = page.getByRole('button', { name }).first();
    if (await skip.isVisible().catch(() => false)) await skip.click();
  }

  await expect(page.getByText(/how are you feeling/i)).toBeVisible();
  const title = await getPick(page);
  expect(title.length).toBeGreaterThan(0);

  // No server involved: every request stayed on this origin or the image CDNs.
  await page.getByRole('button', { name: /watchlist|save/i }).first().click();
  await page.getByRole('link', { name: /^library$/i }).click();
  await expect(page.getByRole('heading', { name: /your library/i })).toBeVisible();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
});

test('try again never repeats the pick', async ({ page }) => {
  await asReturningVisitor(page);
  await noAI(page);
  await page.goto('/');
  const first = await getPick(page);
  await page.getByRole('button', { name: /try again|another/i }).first().click();
  await expect(page.locator('h2').first()).not.toHaveText(first, { timeout: 20_000 });
});

test('makes no request to any API server', async ({ page }) => {
  await asReturningVisitor(page);
  await noAI(page);
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  await page.goto('/');
  await getPick(page);
  for (const h of hosts) expect(['localhost:4173', 'image.tmdb.org', 's4.anilist.co', 'fonts.googleapis.com', 'fonts.gstatic.com']).toContain(h);
});
