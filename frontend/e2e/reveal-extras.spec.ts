import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { asReturningVisitor, getPick, noAI } from './helpers';

const SHOTS = process.env.SHOTS_DIR;

/** Give every card availability and a trailer, as a refreshed catalog will.
 *  Pack files are named by their content hash, so the edited cards are served
 *  under a new name and the manifest is rewritten to point at it. */
async function enrichPack(page: Page) {
  const manifest = JSON.parse(readFileSync('public/data/manifest.json', 'utf8'));
  const doc = JSON.parse(readFileSync(`public/data/${manifest.files.cards}`, 'utf8'));
  for (const c of doc.items) {
    c.watch = {
      IN: {
        link: `https://www.themoviedb.org/movie/${c.tmdb_id}/watch?locale=IN`,
        flatrate: [{ id: 8, name: 'Netflix', logo: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' }, { id: 119, name: 'Amazon Prime Video', logo: '/dQeAar5H991VYporEjUspolDarG.jpg' }],
        rent: [{ id: 2, name: 'Apple TV', logo: null }],
      },
    };
    c.trailer = { site: 'youtube', key: 'dQw4w9WgXcQ' };
  }
  const body = JSON.stringify(doc);
  const name = `cards.${createHash('sha256').update(body).digest('hex').slice(0, 12)}.json`;
  await page.route('**/data/manifest.json', (r) => r.fulfill({ json: { ...manifest, files: { ...manifest.files, cards: name } } }));
  await page.route(`**/data/${name}`, (r) => r.fulfill({ contentType: 'application/json', body }));
  await page.route('https://www.youtube-nocookie.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>trailer</p>' }));
  await page.route('https://i.ytimg.com/**', (r) => r.fulfill({ status: 404 }));
  if (process.env.REAL_POSTERS) {
    await page.route('**/api/poster?*', async (route) => {
      const src = new URL(route.request().url()).searchParams.get('src')!;
      await route.fulfill({ response: await route.fetch({ url: src }) });
    });
  } else {
    await page.route('**/api/poster?*', (r) => r.fulfill({ status: 404 }));
  }
}

test('the reveal shows where to watch, a click-to-load trailer, why-not and a share card', async ({ page }, info) => {
  await noAI(page);
  await asReturningVisitor(page);
  await enrichPack(page);
  await page.goto('/');
  const title = await getPick(page);

  await expect(page.getByRole('heading', { name: /where to watch in india/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /netflix/i })).toHaveAttribute('href', /locale=IN/);
  await expect(page.getByRole('link', { name: 'JustWatch' })).toBeVisible();

  expect(await page.locator('iframe').count()).toBe(0);
  await page.getByRole('button', { name: /play the .* trailer/i }).click();
  await expect(page.locator('iframe[src^="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toBeVisible();

  await page.getByRole('button', { name: /why this and not something else/i }).click();
  await page.getByLabel(/name a title/i).fill('godfather');
  await page.getByRole('button', { name: /^the godfather/i }).first().click();
  await expect(page.getByRole('heading', { name: new RegExp(`vs ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/reveal-${info.project.name}.png`, fullPage: true });

  await page.getByRole('button', { name: /more options/i }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /save as image/i }).click();
  const file = await (await download).path();
  const png = readFileSync(file);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.length).toBeGreaterThan(20_000);
  if (SHOTS) await (await download).saveAs(`${SHOTS}/card-${info.project.name}.png`);
});
