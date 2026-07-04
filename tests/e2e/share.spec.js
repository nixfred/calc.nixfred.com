/* Sharesheet layer: one shared card and one share button, wired in the
   Base layout so root, /tokenops/, and /nutanix-sizer/ all get it for free. */

import { test, expect } from '@playwright/test';

const PAGES = [
  { path: '/', canonical: 'https://calc.nixfred.com/' },
  { path: '/tokenops/', canonical: 'https://calc.nixfred.com/tokenops/' },
  { path: '/nutanix-sizer/', canonical: 'https://calc.nixfred.com/nutanix-sizer/' },
];

test.describe('Share layer (shared across the site)', () => {
  for (const { path, canonical } of PAGES) {
    test(`${path} exposes exactly one visible header share button`, async ({ page }) => {
      await page.goto(path);
      const btn = page.locator('.site-header .share-btn');
      await expect(btn).toHaveCount(1);
      await expect(btn).toBeVisible();
    });

    test(`${path} carries og:image, twitter:card, and canonical/og:url`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
        'content',
        'https://calc.nixfred.com/share/card.png',
      );
      await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
      await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '630');
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical);
    });
  }

  test('clipboard fallback: no navigator.share, click share, clipboard holds the URL and button reads copied', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'share', { value: undefined, configurable: true });
    });
    await page.goto('/tokenops/');
    const btn = page.locator('.site-header .share-btn');
    await btn.click();
    await expect(btn).toHaveText('copied');
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(page.url());
    // Reverts back to "share" after the flash window.
    await expect(btn).toHaveText('share', { timeout: 3000 });
  });

  test('/share/card.png is served with 200', async ({ page }) => {
    const res = await page.goto('/share/card.png');
    expect(res.status()).toBe(200);
  });
});
