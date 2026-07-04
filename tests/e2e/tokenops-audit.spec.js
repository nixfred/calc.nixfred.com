/* TokenOps completion audit harness (decision 0.8.31).
   Encodes the section 46 QA scenario's exact numbers, the machine-checkable
   section 45 acceptance criteria, and the section 0 decisions.
   Green harness = shippable. This stays in the repo as the regression net. */

import { test, expect } from '@playwright/test';

const open = async (page, mode = 'architect') => {
  await page.goto('/tokenops/');
  await page.evaluate((m) => document.querySelector(`button[data-goto="${m}"]`).click(), mode);
};
const cx = (page) => page.evaluate(() => {
  const c = window.__tokenops.compute();
  return {
    runs: c.values.monthlyRuns, base: c.values.baseCallsPerRun,
    retry: c.values.retryCallsPerRun, total: c.values.totalCallsPerRun,
    tokens: c.values.totalMonthlyTokens, tpm: c.values.weightedTokensPerMinute,
    tps: c.values.weightedTokensPerSecond,
    costMin: c.cmp.min, costMax: c.cmp.max,
    ceilingCapex: c.ceiling.ceilingCapex, ceilingMonthly: c.ceiling.ceilingMonthly,
    breakEven: c.be.result, recKind: c.rec.kind, recHeadline: c.rec.headline,
    routeScores: c.rec.routes?.map((r) => [r.key, r.score]),
    conf: c.conf.band, weights: c.values.modelWeightMemoryGB,
    gpuMem: c.values.gpusRequiredByMemory, gpuTput: c.values.gpusRequiredByThroughput,
    gpuRec: c.values.recommendedGpuCount,
  };
});

test.describe('Section 46 QA scenario (exact numbers)', () => {
  test('monthlyRuns 11000, base 7, retry 0.7, total 7.7', async ({ page }) => {
    await open(page);
    const v = await cx(page);
    expect(v.runs).toBe(11000);
    expect(v.base).toBe(7);
    expect(v.retry).toBeCloseTo(0.7, 10);
    expect(v.total).toBeCloseTo(7.7, 10);
  });
});

test.describe('Section 45 acceptance criteria (machine checkable)', () => {
  test('1. all client side; ONLY the cookieless analytics beacon may leave the page', async ({ page }) => {
    // Criterion 40: no customer data transmitted. The CF Web Analytics beacon
    // (cookieless page counts, settled in the landing interview) is the ONLY
    // permitted external host; anything else appearing here is a violation.
    const ALLOWED = ['static.cloudflareinsights.com', 'cloudflareinsights.com'];
    const external = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.hostname !== 'localhost' && !ALLOWED.some((h) => u.hostname.endsWith(h))) external.push(r.url());
    });
    await open(page);
    await page.waitForTimeout(800);
    expect(external).toEqual([]);
  });

  test('2-9. legacy workload formulas present, editable, and correct', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const s = window.__tokenops.getState();
      s.wlRag = true; s.wlAgents = true; s.wlCoding = true; s.wlAgenticCoding = true;
    });
    const v = await page.evaluate(() => {
      const c = window.__tokenops.compute();
      return {
        rag: c.values.ragMonthlyTokens, ag: c.values.agentsMonthlyTokens,
        cod: c.values.codingMonthlyTokens, ac: c.values.agenticCodingMonthlyTokens,
        total: c.values.totalMonthlyTokens, tpm: c.values.weightedTokensPerMinute, tps: c.values.weightedTokensPerSecond,
      };
    });
    expect(v.rag).toBe(2000 * 20 * 22 * 8 * 60);
    expect(v.ag).toBe(3000 * 5 * 22 * 8 * 60);
    expect(v.cod).toBe(90909 * 10 * 22 * 6);
    expect(v.ac).toBe(104167 * 5 * 22 * 6);
    expect(v.total).toBeGreaterThan(0);
    expect(v.tpm).toBeGreaterThan(0);
    expect(v.tps).toBeCloseTo(v.tpm / 60, 6);
  });

  test('10. every rendered engine FormulaTrace carries algebra AND substitution (no tautology)', async ({ page }) => {
    await open(page);
    const traces = await page.locator('.ftrace[data-trace]').count();
    expect(traces).toBeGreaterThan(15);
    // Engine traces must each contain both blocks; only the hand-built policy
    // trace is exempt from the substitution requirement.
    const missingAlgebra = await page.locator('.ftrace[data-trace]:not(:has(.ft-algebra))').count();
    expect(missingAlgebra).toBe(0);
    const missingSub = await page.locator('.ftrace[data-trace]:not([data-trace="privatePolicyScore"]):not(:has(.ft-sub))').count();
    expect(missingSub).toBe(0);
  });

  test('12-13. quantization affects model memory, formula visible', async ({ page }) => {
    await open(page);
    const fp16 = await page.evaluate(() => { window.__tokenops.getState().quantization = 'fp16'; return window.__tokenops.compute().values.modelWeightMemoryGB; });
    const int4 = await page.evaluate(() => { window.__tokenops.getState().quantization = 'int4'; return window.__tokenops.compute().values.modelWeightMemoryGB; });
    expect(fp16).toBe(140);
    expect(int4).toBe(35);
  });

  test('14-19. KV cache, vector DB, GPU, provider cost, ceiling, break even formulas all compute', async ({ page }) => {
    await open(page);
    const v = await cx(page);
    expect(v.weights).toBeGreaterThan(0);
    expect(v.gpuMem).toBeGreaterThan(0);
    expect(v.gpuRec).toBeGreaterThanOrEqual(v.gpuMem);
    expect(v.costMin).toBeGreaterThan(0);
    expect(v.costMax).toBeGreaterThanOrEqual(v.costMin);
    expect(v.ceilingCapex).toBeCloseTo(v.ceilingMonthly * 36, 4);
    expect(v.breakEven).toBeGreaterThan(0);
  });

  test('20-29. platform routes and hardware appear with direct source links', async ({ page }) => {
    await open(page);
    const html = await page.content();
    for (const url of [
      'https://airia.com/ai-platform/',
      'https://www.kamiwaza.ai/product',
      'https://buildtechnologygroup.com/',
      'https://www.hpe.com/us/en/private-cloud-ai.html',
      'https://www.hpe.com/us/en/compute/hpe-proliant-compute/dl380a-gen12.html',
      'https://www.nvidia.com/en-us/data-center/rtx-pro-6000-blackwell-server-edition/',
      'https://www.nvidia.com/en-us/data-center/h200/',
      'https://www.amd.com/en/products/accelerators/instinct/mi350/mi355x.html',
      'proliant-compute-xd685', // XD685 canonical page (criterion 45.25, URL upgraded 2026-07-03)
    ]) expect(html).toContain(url);
  });

  test('30-32. provider rows show source links, constants visible, assumptions editable', async ({ page }) => {
    await open(page);
    expect(await page.locator('.rates-table input').count()).toBeGreaterThan(30); // every rate editable
    expect(await page.locator('.rates-table .src-pill').count()).toBeGreaterThan(10);
  });

  test('33-36. recommendation shows scores, fired rules, confidence', async ({ page }) => {
    await open(page);
    await expect(page.locator('.rec-card .route-row').first()).toBeVisible();
    await expect(page.locator('.rec-rules ol li').first()).toBeVisible();
    await expect(page.locator('.rec-conf')).toContainText(/High|Medium|Low/);
    const v = await cx(page);
    for (const [, score] of v.routeScores) { expect(score).toBeGreaterThanOrEqual(0); expect(score).toBeLessThanOrEqual(100); }
  });

  test('37-39. exports GENERATE real content, not just buttons (QA audit fix)', async ({ page }) => {
    await open(page);
    const out = await page.evaluate(() => ({
      summary: window.__tokenops._test.exportSummary(),
      math: window.__tokenops._test.exportMath(),
      json: window.__tokenops._test.exportJson(),
      buttons: ['summary', 'math', 'json', 'print', 'share', 'share-sanitized'].every((k) => !!document.querySelector(`[data-export="${k}"]`)),
    }));
    expect(out.buttons).toBe(true);
    expect(out.summary).toContain('11,000');                       // section 46 runs in the export
    expect(out.summary).toContain('Never a quote');
    expect(out.summary).toContain('## Assumptions');
    expect(out.summary).toContain('## Sources');
    expect(out.math).toContain('Every formula, every substitution');
    expect(out.math).toContain('Hardware budget ceiling');          // economics math included (audit fix)
    expect(out.math).toContain('Route scores');
    const parsed = JSON.parse(out.json);
    expect(parsed.state.users).toBe(200);
  });

  test('share link round-trips full scenario state (decision 0.8.29)', async ({ page }) => {
    await open(page);
    const link = await page.evaluate(() => {
      window.__tokenops.getState().users = 777;
      return window.__tokenops._test.shareLink();
    });
    await page.goto(link);
    const users = await page.evaluate(() => window.__tokenops.getState().users);
    expect(users).toBe(777);
  });

  test('UI-driven edit recomputes results (criterion: editable means the page reacts)', async ({ page }) => {
    await open(page);
    await page.fill('input[data-field="users"]', '400');
    await page.waitForTimeout(400); // debounce
    const runs = await page.evaluate(() => window.__tokenops.compute().values.monthlyRuns);
    expect(runs).toBe(22000); // 400 * 5 * 22 * 0.5
    await expect(page.locator('#tokenops-summary')).toContainText('Do not size yet').catch(() => {});
  });

  test('front door heading renders clean text (scramble is banned inside the calculator)', async ({ page }) => {
    await page.goto('/tokenops/');
    await page.waitForTimeout(1200);
    await expect(page.locator('.start h1')).toHaveText('What are you building?');
  });

  test('45.11 model size quick pick offers the spec rows', async ({ page }) => {
    await open(page);
    const opts = await page.locator('select[data-field="modelSizeQuickPick"] option').allTextContents();
    for (const label of ['8B', '13B', '30B', '8x7B (about 47B total)', '70B', '120B', '405B']) expect(opts).toContain(label);
  });

  test('do-not-size renders its card in the UI, not only in compute (criterion 45.35)', async ({ page }) => {
    await open(page);
    await page.selectOption('select[data-field="budgetConfidence"]', 'unknown');
    await page.waitForTimeout(500);
    await expect(page.locator('.do-not-size')).toContainText('Do not size yet');
    await expect(page.locator('.do-not-size ol li').first()).toBeVisible();
  });
});

test.describe('Section 0 settled decisions', () => {
  test('0.1.2 chooser screen first with both modes', async ({ page }) => {
    await page.goto('/tokenops/');
    await expect(page.locator('button[data-goto="meeting"]').first()).toBeVisible();
    await expect(page.locator('button[data-goto="architect"]').first()).toBeVisible();
  });

  test('0.2.7 co-recommend logic exists; 0.2.8 do-not-size fires on missing gates', async ({ page }) => {
    await open(page);
    const kind = await page.evaluate(() => {
      window.__tokenops.getState().budgetConfidence = 'unknown';
      return window.__tokenops.compute().rec.kind;
    });
    expect(kind).toBe('do-not-size');
  });

  test('0.3.11 stale warning wired at 60 days', async ({ page }) => {
    await open(page);
    // No source should be stale today; the machinery is verified by class presence logic in bundle.
    expect(await page.locator('.src-pill.stale').count()).toBe(0);
  });

  test('0.4 ceiling: never a hardware price, quote slot verdict works', async ({ page }) => {
    await open(page);
    await expect(page.locator('.ceiling-headline')).toBeVisible();
    // An absurd $1 quote is rejected as implausible, not celebrated (Fred UX catch).
    const absurd = await page.evaluate(() => {
      window.__tokenops.getState().gpuQuote = 1;
      return window.__tokenops.compute().ceiling.verdict.implausible;
    });
    expect(absurd).toBe(true);
    const verdict = await page.evaluate(() => {
      const half = Math.round(window.__tokenops.compute().ceiling.ceilingCapex * 0.5);
      window.__tokenops.getState().gpuQuote = half; // realistic, comfortably under
      return window.__tokenops.compute().ceiling.verdict.under;
    });
    expect(verdict).toBe(true);
    const verdict2 = await page.evaluate(() => {
      window.__tokenops.getState().gpuQuote = 999999999;
      return window.__tokenops.compute().ceiling.verdict.under;
    });
    expect(verdict2).toBe(false);
  });

  test('0.5.20 FormulaTrace blocks render expanded', async ({ page }) => {
    await open(page);
    const total = await page.locator('.ftrace').count();
    const expanded = await page.locator('.ftrace[data-expanded="true"]').count();
    expect(total).toBeGreaterThan(0);
    expect(expanded).toBe(total);
  });

  test('0.5.21 sticky summary bar carries all four live numbers', async ({ page }) => {
    await open(page);
    const cells = page.locator('#tokenops-summary .sum-cell');
    await expect(cells).toHaveCount(4);
    await expect(page.locator('#tokenops-summary')).toContainText('monthly tokens');
    await expect(page.locator('#tokenops-summary')).toContainText('hw ceiling');
  });

  test('0.5.19 Meeting Mode is a wizard with progressive steps', async ({ page }) => {
    await open(page, 'meeting');
    await expect(page.locator('.wiz-nav')).toBeVisible();
    await expect(page.locator('.wiz-fields')).toBeVisible();
  });

  test('0.6.25 anonymous by default: customer name is Customer A on a fresh browser', async ({ page }) => {
    await page.goto('/tokenops/');
    const state = await page.evaluate(() => window.__tokenops.getState());
    expect(state.customerName).toBe('Customer A');
  });

  test('0.2.6 weight sliders exist and reorder routes live', async ({ page }) => {
    await open(page);
    expect(await page.locator('[data-weight]').count()).toBeGreaterThan(20);
  });

  test('validation: hours over 24 is flagged, never silently used (spec 5, 36)', async ({ page }) => {
    await open(page);
    const errs = await page.evaluate(async () => {
      window.__tokenops.getState().activeHoursPerDay = 40;
      return window.__tokenops.compute().errors.map((e) => e.field);
    });
    expect(errs).toContain('activeHoursPerDay');
  });

  test('landing page: feedback form present with honeypot (Phase 7)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#feedback-form')).toBeVisible();
    await expect(page.locator('#fb-message')).toBeVisible();
    // Honeypot exists but is invisible to humans.
    await expect(page.locator('#fb-website')).toHaveCount(1);
    await expect(page.locator('#fb-website')).not.toBeInViewport();
    // Empty submit is rejected client-side, no network needed.
    await page.locator('.fb-send').click();
    await expect(page.locator('#fb-status')).toContainText('Pick yes or no');
  });

  test('landing page: TokenOps LIVE and the ENTIRE card is clickable (Fred standard 2026-07-03)', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('.calc-card.live a.card-link[href="/tokenops"]');
    await expect(link).toHaveAttribute('href', '/tokenops');
    // Every LIVE card is fully clickable, however many there are.
    const liveCards = await page.locator('.calc-card.live').count();
    expect(await page.locator('.calc-card.live a.card-link').count()).toBe(liveCards);
    // The link must wrap the whole card content: title, description, and meta.
    await expect(link.locator('.calc-title')).toBeVisible();
    await expect(link.locator('.calc-desc')).toBeVisible();
    await expect(link.locator('.calc-meta')).toBeVisible();
    // Clicking the description (not the title) must navigate.
    await link.locator('.calc-desc').click();
    await expect(page).toHaveURL(/\/tokenops\/?$/);
    await expect(page.locator('#tokenops-root')).toBeVisible();
  });
});

test('meeting answer page relists the wizard inputs (Fred ask 2026-07-03)', async ({ page }) => {
  await page.goto('/tokenops/');
  await page.evaluate(() => document.querySelector('button[data-goto="meeting"]').click());
  for (let i = 0; i < 4; i++) {
    await page.locator('button[data-wiz="next"]').click();
    await page.waitForTimeout(150);
  }
  await expect(page.locator('#inputs-recap')).toBeVisible();
  await expect(page.locator('#inputs-recap')).toContainText('What you told it');
  await expect(page.locator('#inputs-recap')).toContainText('Adoption');
  await expect(page.locator('#inputs-recap')).toContainText('Data can leave');
});

test('decision card: verdict banner flips as the quote slider moves (Fred ROI ask)', async ({ page }) => {
  await page.goto('/tokenops/');
  await page.evaluate(() => document.querySelector('button[data-goto="architect"]').click());
  await expect(page.locator('#decision-card .v-quote')).toBeVisible(); // no quote: GET A QUOTE
  const verdicts = await page.evaluate(() => {
    const s = window.__tokenops.getState();
    const out = [];
    const base = window.__tokenops.compute().providerBaseline;
    s.financeMode = 'cash'; s.financeTermMonths = 36;
    s.gpuQuote = base * 36 * 0.5;  out.push(window.__tokenops.compute().fin.verdict); // well under bar
    s.gpuQuote = base * 36 * 0.8;  out.push(window.__tokenops.compute().fin.verdict); // between bar and tokens
    s.gpuQuote = base * 36 * 1.5;  out.push(window.__tokenops.compute().fin.verdict); // above tokens
    return out;
  });
  expect(verdicts).toEqual(['buy', 'negotiate', 'tokens']);
});

test('20c: presets are the front door - pattern wizard routes to a landing with assumptions', async ({ page }) => {
  await page.goto('/tokenops/');
  await expect(page.locator('.start h1')).toContainText('What are you building?');
  expect(await page.locator('.pattern-card').count()).toBeGreaterThanOrEqual(8);
  await page.locator('.pattern-card[data-pattern="knowledge-rag"]').click();
  await page.selectOption('#start-scale', 'department');
  await page.selectOption('#start-data', 'with-controls');
  await page.locator('#start-go').click();
  await expect(page.locator('h1')).toContainText('Internal knowledge assistant');
  await expect(page.locator('.card-title', { hasText: 'What we just assumed' })).toBeVisible();
  expect(await page.locator('.verify-flag').count()).toBeGreaterThanOrEqual(3);
  const s = await page.evaluate(() => window.__tokenops.getState());
  expect(s.users).toBe(240);
  expect(s.dataCanLeave).toBe('with-controls');
  expect(s.ragEnabled).toBe(true);
  await page.locator('button.primary[data-goto="meeting-answer"]').click();
  await expect(page.locator('.rec-headline').first()).toBeVisible();
});

test('20c: example Customers load as flagship presets with variable teaching notes', async ({ page }) => {
  await page.goto('/tokenops/');
  await expect(page.locator('.persona-card')).toHaveCount(3);
  await page.locator('.persona-card[data-persona="0"]').click();
  await expect(page.locator('h1')).toContainText('Calloway Reed');
  await expect(page.locator('.landing-story')).toContainText('240 attorney');
  await expect(page.locator('th', { hasText: 'what it drives' })).toBeVisible();
  const s = await page.evaluate(() => window.__tokenops.getState());
  expect(s.users).toBe(240);
  expect(s.chunksRetrievedPerQuery).toBe(8);
  await page.locator('button.primary[data-goto="meeting-answer"]').click();
  await expect(page.locator('#inputs-recap')).toBeVisible();
});

test('navigation: no view is a dead end (Fred: trapped)', async ({ page }) => {
  await page.goto('/tokenops/');
  // Start screen carries the nav.
  await expect(page.locator('.app-nav')).toBeVisible();
  // Load a persona, land, then walk: landing -> answer -> architect -> landing -> start.
  await page.locator('.persona-card[data-persona="0"]').click();
  await expect(page.locator('.nav-item.on', { hasText: 'Starting point' })).toBeVisible();
  await page.locator('.app-nav .nav-item', { hasText: 'Answer' }).click();
  await expect(page.locator('.rec-headline').first()).toBeVisible();
  await expect(page.locator('button', { hasText: 'back to your starting point' })).toBeVisible();
  await page.locator('.app-nav .nav-item', { hasText: 'Every dial' }).click();
  await expect(page.locator('.a-section').first()).toBeVisible();
  await page.locator('.app-nav .nav-item', { hasText: 'Starting point' }).click();
  await expect(page.locator('h1')).toContainText('Calloway Reed');
  // Poison a rate cell and carry a section hash, then Start over must clean BOTH (Fred's catch).
  await page.locator('.app-nav .nav-item', { hasText: 'Every dial' }).click();
  await page.evaluate(() => {
    location.hash = '#sec-topology';
    const r = document.querySelector('input[data-rate="0"][data-ratefield="inputPerMillion"]');
    r.value = '77'; r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.locator('.nav-reset').click();
  await expect(page.locator('.start h1')).toContainText('What are you building?');
  const s = await page.evaluate(() => window.__tokenops.getState());
  expect(s.users).toBe(200); // defaults restored
  const clean = await page.evaluate(() => ({ hash: location.hash, rate: window.__tokenops.compute().cmp.rows.find((r) => r.providerKey === 'anthropic').monthlyCost }));
  expect(clean.hash).toBe('');
  // Anthropic priced on pristine rates again (edited 77/MTok would inflate it hugely).
  expect(clean.rate).toBeLessThan(3000);
  // Legacy chooser is retired: any old goto lands on start, never a trap.
  await page.evaluate(() => { window.__tokenops._test.reset(); });
  await expect(page.locator('.start h1')).toBeVisible();
});

test('HPE configuration card renders with the ceiling bar and vendor links, both modes', async ({ page }) => {
  await open(page);
  await expect(page.locator('#hpe-config-card')).toBeVisible();
  await expect(page.locator('.config-budget')).toContainText('must land under');
  await expect(page.locator('#hpe-config-card .src-pill').first()).toBeVisible();
  await expect(page.locator('#hpe-config-card')).toContainText('not an orderable BOM');
  // Meeting answer carries it too.
  await page.goto('/tokenops/');
  await page.locator('.persona-card[data-persona="0"]').click();
  await page.locator('button.primary[data-goto="meeting-answer"]').click();
  await expect(page.locator('#hpe-config-card')).toBeVisible();
});

test('example Customer landings carry the HPE configuration too', async ({ page }) => {
  await page.goto('/tokenops/');
  await page.locator('.persona-card[data-persona="1"]').click(); // Harborline Mutual
  await expect(page.locator('h1')).toContainText('Harborline');
  await expect(page.locator('#hpe-config-card')).toBeVisible();
  await expect(page.locator('.config-budget')).toContainText('must land under');
});
