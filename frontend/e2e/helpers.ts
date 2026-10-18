import { expect, type Page } from '@playwright/test';

/** Skip onboarding with a saved taste, as a returning visitor. */
export async function asReturningVisitor(page: Page, favouriteIds = ['tmdb_27205', 'tmdb_157336', 'tmdb_155']) {
  await page.addInitScript((ids) => {
    if (!localStorage.getItem('unbored-taste')) {
      localStorage.setItem('unbored-taste', JSON.stringify({ state: { hasCompletedOnboarding: true, favouriteIds: ids }, version: 0 }));
    }
  }, favouriteIds);
}

/** No free AI tier unless a spec says otherwise. */
export async function noAI(page: Page) {
  await page.route('**/api/ai/quota', (r) => r.fulfill({ json: { free_tier: false, limit: 0, remaining: 0 } }));
}

/** Choose a mood and time on Home and ask for a pick; resolves to its title. */
export async function getPick(page: Page, mood = /thrilled/i, time = /90\+ min/i): Promise<string> {
  await page.getByRole('radio', { name: mood }).click();
  await page.getByRole('radio', { name: time }).click();
  await page.getByRole('button', { name: /find my pick/i }).click();
  const heading = page.locator('h2').filter({ hasNotText: /^$/ }).first();
  await expect(page.getByText(/your pick:/i)).toBeAttached({ timeout: 20_000 });
  return (await heading.innerText()).trim();
}
