/* Nutanix Conversation Sizer e2e: preset front door (parity with TokenOps),
   four-output law, honest ranges, full-surface reset, teach layer. */

import { test, expect } from '@playwright/test';

const openTool = async (page) => {
  await page.goto('/nutanix-sizer/');
  await page.locator('.start-skip button[data-goto="tool"]').click();
};

test('front door: categories are the entry, grounded in the field guide', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await expect(page.locator('.start h1')).toContainText('What are you sizing?');
  expect(await page.locator('.pattern-card').count()).toBeGreaterThanOrEqual(9);
  await expect(page.locator('.persona-card')).toHaveCount(3);
  await page.locator('.pattern-card[data-cat="vdi-euc"]').click();
  await expect(page.locator('h1')).toContainText('VDI and end user computing');
  await expect(page.locator('.card-title', { hasText: 'What we just assumed' })).toBeVisible();
  expect(await page.locator('.verify-flag').count()).toBeGreaterThanOrEqual(2);
  const s = await page.evaluate(() => window.__sizer.getState());
  expect(s.dedupRatio).toBe(3.0);
  expect(s.cvmProfile).toBe('heavy');
  await page.locator('button.primary[data-goto="tool-answer"]').click();
  await expect(page.locator('.rec-headline')).toContainText(/fits in roughly \d+ to \d+ nodes/);
});

test('front door: example Customer loads with story and teaching notes', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await page.locator('.persona-card[data-spersona="2"]').click();
  await expect(page.locator('h1')).toContainText('Meridian Health');
  await expect(page.locator('.landing-story')).toContainText('2,400 VMs');
  await expect(page.locator('th', { hasText: 'what it drives' })).toBeVisible();
  const s = await page.evaluate(() => window.__sizer.getState());
  expect(s.vmCount).toBe(2400);
  expect(s.cvmProfile).toBe('heavy');
});

test('navigation: no dead ends across start, landing, answer, every dial', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await expect(page.locator('.app-nav')).toBeVisible();
  await page.locator('.persona-card[data-spersona="0"]').click();
  await expect(page.locator('.nav-item.on', { hasText: 'Starting point' })).toBeVisible();
  await page.locator('.app-nav .nav-item', { hasText: 'The answer' }).click();
  await expect(page.locator('.rec-headline')).toBeVisible();
  await page.locator('.app-nav .nav-item', { hasText: 'Starting point' }).click();
  await expect(page.locator('h1')).toContainText('Beacon Ridge');
  await page.locator('.app-nav .nav-item', { hasText: 'Every dial' }).click();
  await expect(page.locator('#ns-estate')).toBeVisible();
  await page.locator('.app-nav .nav-item[data-goto="start"]').click();
  await expect(page.locator('.start h1')).toBeVisible();
});

test('sizer computes and shows all four outputs (tool view)', async ({ page }) => {
  await openTool(page);
  await expect(page.locator('#sizer-root .a-fields')).toBeVisible();
  await expect(page.locator('.rec-headline')).toContainText(/fits in roughly \d+ to \d+ nodes \(HPE ProLiant for Nutanix\)/);
  await expect(page.locator('.wb-card')).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'Conversation script' })).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'Next action' })).toBeVisible();
  await expect(page.locator('text=Nutanix Sizer is the source of truth')).toBeVisible();
  await expect(page.locator('#dx-config-card')).toBeVisible();
});

test('sizer traces render expanded with appendix-f source pills', async ({ page }) => {
  await openTool(page);
  const traces = await page.locator('.ftrace').count();
  expect(traces).toBe(11);
  expect(await page.locator('.ftrace[data-expanded="true"]').count()).toBe(traces);
  await expect(page.locator('.src-pill', { hasText: 'appendix F' }).first()).toBeVisible();
});

test('editing the estate recomputes the range live', async ({ page }) => {
  await openTool(page);
  const before = await page.evaluate(() => window.__sizer.compute().values.nodeFloor);
  await page.fill('input[data-ns="vmCount"]', '400');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__sizer.compute().values.nodeFloor);
  expect(after).toBeGreaterThan(before);
});

test('database preset applies the 2:1 field ratio', async ({ page }) => {
  await openTool(page);
  await page.selectOption('select[data-ns="workloadType"]', 'database');
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => window.__sizer.getState());
  expect(s.vcpuToPcpu).toBe(2);
  expect(s.cvmProfile).toBe('heavy');
});

test('Start over wipes the ENTIRE surface from any view and returns to start', async ({ page }) => {
  await openTool(page);
  await page.evaluate(() => { location.hash = '#ns-formulas'; });
  const fields = await page.evaluate(() => [...document.querySelectorAll('input[data-ns]')].map((i) => i.dataset.ns));
  for (const f of fields) await page.fill(`input[data-ns="${f}"]`, '7');
  await page.selectOption('select[data-ns="rf"]', 'ecx42');
  await page.selectOption('select[data-ns="cvmProfile"]', 'light');
  await page.selectOption('select[data-ns="workloadType"]', 'database');
  await page.waitForTimeout(300);
  await page.locator('.nav-reset').click();
  await page.waitForTimeout(300);
  await expect(page.locator('.start h1')).toContainText('What are you sizing?');
  const after = await page.evaluate(() => ({ s: window.__sizer.getState(), hash: location.hash }));
  expect(after.hash).toBe('');
  expect(after.s.vmCount).toBe(200);
  expect(after.s.rf).toBe('rf2');
  expect(after.s.cvmProfile).toBe('standard');
  expect(after.s.workloadType).toBe('general');
  expect(after.s.vcpuToPcpu).toBe(4);
  expect(after.s.nodeRawTb).toBe(30.72);
});

test('teach layer: EVERY sizer input has a working four-section popover', async ({ page }) => {
  await openTool(page);
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

/* ---------- estate file import (Collector + RVTools) ---------- */

import { collectorFixture, rvtoolsFixture, makeXlsx } from '../helpers/make-xlsx.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('import: drop zone on the front door states the privacy promise', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await expect(page.locator('#ns-drop')).toBeVisible();
  await expect(page.locator('#ns-drop')).toContainText('never leaves this machine');
  await expect(page.locator('.info-btn[data-teach="sizer-import"]')).toBeVisible();
});

test('import: Collector file lands on a provenance-first starting point', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await page.setInputFiles('#ns-import-file', {
    name: 'collector-lab.xlsx', mimeType: XLSX_MIME, buffer: Buffer.from(collectorFixture()),
  });
  await expect(page.locator('h1')).toContainText('Imported: collector-lab.xlsx');
  await expect(page.locator('.landing-story')).toContainText('6 powered-on VMs');
  await expect(page.locator('.landing-story')).toContainText('Collector 6.1');
  await expect(page.locator('.landing-story')).toContainText('never left this machine');
  expect(await page.locator('.verify-flag').count()).toBeGreaterThanOrEqual(3);
  const s = await page.evaluate(() => window.__sizer.getState());
  expect(s.vmCount).toBe(6);
  expect(s.avgVcpuPerVm).toBe(6.0);
  expect(s.usedStorageTb).toBe(9.0);
  await page.locator('button.primary[data-goto="tool-answer"]').click();
  await expect(page.locator('.rec-headline')).toContainText(/fits in roughly \d+ to \d+ nodes/);
});

test('import: RVTools file derives the estate with In Use basis', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await page.setInputFiles('#ns-import-file', {
    name: 'rvtools-prod.xlsx', mimeType: XLSX_MIME, buffer: Buffer.from(rvtoolsFixture()),
  });
  await expect(page.locator('h1')).toContainText('Imported: rvtools-prod.xlsx');
  await expect(page.locator('.landing-story')).toContainText('RVTools');
  const s = await page.evaluate(() => window.__sizer.getState());
  expect(s.vmCount).toBe(5);
  expect(s.avgRamGbPerVm).toBe(12.8);
  expect(s.usedStorageTb).toBe(4.1);
  await expect(page.locator('td', { hasText: 'In Use MiB' }).first()).toBeVisible();
});

test('import: a wrong file fails loudly and the front door keeps working', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await page.setInputFiles('#ns-import-file', {
    name: 'budget.xlsx', mimeType: XLSX_MIME, buffer: Buffer.from(makeXlsx({ Sheet1: [['a'], [1]] })),
  });
  await expect(page.locator('#ns-import-error')).toBeVisible();
  await expect(page.locator('#ns-import-error')).toContainText('Not a Collector or RVTools export');
  await expect(page.locator('.start h1')).toBeVisible();
  await page.locator('.pattern-card[data-cat="vdi-euc"]').click();
  await expect(page.locator('h1')).toContainText('VDI');
});

test('import: Start over after an import wipes back to the front door defaults', async ({ page }) => {
  await page.goto('/nutanix-sizer/');
  await page.setInputFiles('#ns-import-file', {
    name: 'collector-lab.xlsx', mimeType: XLSX_MIME, buffer: Buffer.from(collectorFixture()),
  });
  await expect(page.locator('h1')).toContainText('Imported');
  await page.locator('.nav-reset').click();
  await expect(page.locator('.start h1')).toContainText('What are you sizing?');
  const s = await page.evaluate(() => window.__sizer.getState());
  expect(s.vmCount).toBe(200);
  expect(s.usedStorageTb).toBe(50);
});
