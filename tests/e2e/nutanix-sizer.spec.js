/* Nutanix Conversation Sizer e2e: the four-output law and honest-range rules. */

import { test, expect } from '@playwright/test';

test('sizer page loads, computes, and shows all four outputs', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await expect(page.locator('#sizer-root .a-fields')).toBeVisible();
  await expect(page.locator('.rec-headline')).toContainText(/fits in roughly \d+ to \d+ nodes \(HPE ProLiant for Nutanix\)/);
  await expect(page.locator('.wb-card')).toBeVisible();                        // whiteboard card
  await expect(page.locator('.card-title', { hasText: 'Conversation script' })).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'Next action' })).toBeVisible();
  await expect(page.locator('text=Nutanix Sizer is the source of truth')).toBeVisible();
});

test('sizer traces render expanded with appendix-f source pills', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  const traces = await page.locator('.ftrace').count();
  expect(traces).toBe(11);
  expect(await page.locator('.ftrace[data-expanded="true"]').count()).toBe(traces);
  await expect(page.locator('.src-pill', { hasText: 'appendix F' }).first()).toBeVisible();
});

test('editing the estate recomputes the range live', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  const before = await page.evaluate(() => window.__sizer.compute().values.nodeFloor);
  await page.fill('input[data-ns="vmCount"]', '400');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__sizer.compute().values.nodeFloor);
  expect(after).toBeGreaterThan(before);
});

test('database preset applies the 2:1 field ratio', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await page.selectOption('select[data-ns="workloadType"]', 'database');
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => window.__sizer.getState());
  expect(s.vcpuToPcpu).toBe(2);
  expect(s.cvmProfile).toBe('heavy');
});

test('sizer navigation: anchors plus a real Start over (same treatment as TokenOps)', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await expect(page.locator('.app-nav')).toBeVisible();
  for (const id of ['ns-estate', 'ns-results', 'ns-formulas']) {
    expect(await page.locator(`#${id}`).count()).toBe(1);
  }
  await expect(page.locator('.app-nav a[href="/howto/nutanix-sizer"]')).toBeVisible();
  await expect(page.locator('.app-nav a[href="/"]')).toBeVisible();
  // Start over wipes edits.
  await page.fill('input[data-ns="vmCount"]', '999');
  await page.waitForTimeout(300);
  await page.locator('.nav-reset').click();
  const s = await page.evaluate(() => window.__sizer.getState());
  expect(s.vmCount).toBe(200);
});

test('the answer speaks HPE DX and shows the iron card (Fred bonus, 2026-07-03)', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await expect(page.locator('.rec-headline')).toContainText('HPE ProLiant for Nutanix');
  await expect(page.locator('#dx-config-card')).toBeVisible();
  await expect(page.locator('#dx-config-card')).toContainText('Not an orderable BOM');
  await expect(page.locator('#dx-config-card .src-pill').first()).toContainText('DX380 Gen11');
});
