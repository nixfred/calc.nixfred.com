/* How-to field manuals: pages exist, are linked from their calculators,
   and keep the site's honesty language front and center. */

import { test, expect } from '@playwright/test';

test('TokenOps manual loads with the load-bearing sections', async ({ page }) => {
  await page.goto('/howto/tokenops');
  await expect(page.locator('h1')).toContainText('How to use TokenOps');
  await expect(page.locator('text=never a quote').first()).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'hardware budget ceiling' })).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'meeting plays' })).toBeVisible();
  await expect(page.locator('a[href="/tokenops"]').first()).toBeVisible();
});

test('Sizer manual loads with the load-bearing sections', async ({ page }) => {
  await page.goto('/howto/nutanix-sizer');
  await expect(page.locator('h1')).toContainText('Nutanix Conversation Sizer');
  await expect(page.locator('text=Nutanix Sizer is the source of truth').first()).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'four outputs' })).toBeVisible();
  await expect(page.locator('a[href="/nutanix-sizer"]').first()).toBeVisible();
});

test('both calculators link to their manuals', async ({ page }) => {
  await page.goto('/tokenops/');
  await expect(page.locator('a[href="/howto/tokenops"]').first()).toBeVisible();
  await page.goto('/nutanix-sizer/');
  await expect(page.locator('a[href="/howto/nutanix-sizer"]').first()).toBeVisible();
});

test('manuals cross-link each other', async ({ page }) => {
  await page.goto('/howto/tokenops');
  await expect(page.locator('a[href="/howto/nutanix-sizer"]').first()).toBeVisible();
  await page.goto('/howto/nutanix-sizer');
  await expect(page.locator('a[href="/howto/tokenops"]').first()).toBeVisible();
});
