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
  // Start over wipes the ENTIRE surface: every number, every select,
  // preset side-effects, and the URL hash (same audit that caught the
  // TokenOps rates leak, applied here 2026-07-03: clean).
  await page.evaluate(() => { location.hash = '#ns-formulas'; });
  const fields = await page.evaluate(() => [...document.querySelectorAll('input[data-ns]')].map((i) => i.dataset.ns));
  for (const f of fields) await page.fill(`input[data-ns="${f}"]`, '7');
  await page.selectOption('select[data-ns="rf"]', 'ecx42');
  await page.selectOption('select[data-ns="cvmProfile"]', 'light');
  await page.selectOption('select[data-ns="workloadType"]', 'database');
  await page.waitForTimeout(300);
  await page.locator('.nav-reset').click();
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ s: window.__sizer.getState(), hash: location.hash }));
  expect(after.hash).toBe('');
  expect(after.s.vmCount).toBe(200);
  expect(after.s.rf).toBe('rf2');
  expect(after.s.cvmProfile).toBe('standard');
  expect(after.s.workloadType).toBe('general');
  expect(after.s.vcpuToPcpu).toBe(4);
  expect(after.s.nodeRawTb).toBe(30.72);
});

test('the answer speaks HPE DX and shows the iron card (Fred bonus, 2026-07-03)', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await expect(page.locator('.rec-headline')).toContainText('HPE ProLiant for Nutanix');
  await expect(page.locator('#dx-config-card')).toBeVisible();
  await expect(page.locator('#dx-config-card')).toContainText('Not an orderable BOM');
  await expect(page.locator('#dx-config-card .src-pill').first()).toContainText('DX380 Gen11');
});

test('teach layer: EVERY sizer input has a working four-section popover (full audit 2026-07-03)', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  // Exact coverage: one (i) per input, no orphans either way.
  const inputs = await page.evaluate(() => [...document.querySelectorAll('[data-ns]')].map((el) => el.dataset.ns));
  expect(inputs.length).toBe(15);
  expect(await page.locator('.info-btn').count()).toBe(15);
  for (const key of inputs) {
    await page.locator(`.info-btn[data-teach="sizer-${key}"]`).click();
    const pop = page.locator('.teach-pop');
    await expect(pop.locator('.teach-k')).toHaveCount(4);
    await expect(pop.locator('.teach-links a').first()).toHaveAttribute('href', /^https:\/\//);
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('#teach-overlay')).toHaveCount(0);
});
