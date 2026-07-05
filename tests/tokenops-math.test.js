/* TokenOps math audit: spec section 46 QA scenario, exact expected numbers.
   These values are the acceptance contract; if they drift, the build is wrong. */

import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { engine, formulaDefs, effectiveRolePlan } from '../src/lib/tokenops/formulas.js';
import { validateInputs } from '../src/lib/tokenops/engine.js';
import { hardwareCeiling, breakEvenTokens, roleRoutedCost } from '../src/lib/tokenops/costs.js';
import { recommend, checkDoNotSize, confidence, scoreRoutes } from '../src/lib/tokenops/routes.js';
import { sourceLinkPills } from '../src/lib/tokenops/components.js';
import defaults from '../src/data/tokenops/tokenops-defaults.json';
import rules from '../src/data/tokenops/route-rules.json';
import rates from '../src/data/tokenops/provider-rates.json';
import personas from '../src/data/tokenops/example-customers.json';

const state = structuredClone(defaults);

test('section 46: monthlyRuns = 200 * 5 * 22 * 0.50 * 1.00 = 11,000', () => {
  const { values } = engine.evaluate(state, {});
  expect(values.monthlyRuns).toBe(11000);
});

test('section 46: baseCallsPerRun = 1 + (2*2) + 1 + 1 = 7', () => {
  const { values } = engine.evaluate(state, {});
  expect(values.baseCallsPerRun).toBe(7);
});

test('section 46: retryCallsPerRun = 7 * 0.10 = 0.7', () => {
  const { values } = engine.evaluate(state, {});
  expect(values.retryCallsPerRun).toBeCloseTo(0.7, 10);
});

test('section 46: totalCallsPerRun = 7 + 0.7 + 0 = 7.7', () => {
  const { values } = engine.evaluate(state, {});
  expect(values.totalCallsPerRun).toBeCloseTo(7.7, 10);
});

test('legacy quick formulas match spec section 14 exactly', () => {
  const s = { ...state, wlRag: true, wlAgents: true, wlCoding: true, wlAgenticCoding: true };
  const { values } = engine.evaluate(s, {});
  expect(values.ragMonthlyTokens).toBe(2000 * s.concurrentConnections * s.ragDays * s.ragHours * 60);
  expect(values.agentsMonthlyTokens).toBe(3000 * s.workflows * s.agDays * s.agHours * 60);
  expect(values.codingMonthlyTokens).toBe(90909 * s.developers * s.codDays * s.codHours);
  expect(values.agenticCodingMonthlyTokens).toBe(104167 * s.acDevelopers * s.acDays * s.acHours);
});

test('model memory: 70B fp16 = 140 GB, 70B int4 = 35 GB (spec 21.1)', () => {
  const fp16 = engine.evaluate({ ...state, quantization: 'fp16' }, {}).values.modelWeightMemoryGB;
  const int4 = engine.evaluate({ ...state, quantization: 'int4' }, {}).values.modelWeightMemoryGB;
  expect(fp16).toBe(140);
  expect(int4).toBe(35);
});

test('validation flags hours > 24 (spec section 5: never silently use bad inputs)', () => {
  const errs = validateInputs({ ...state, activeHoursPerDay: 40 });
  expect(errs.some((e) => e.field === 'activeHoursPerDay' && e.severity === 'critical')).toBe(true);
});

test('every formula trace exposes algebra, plain English, substitution, and variables', () => {
  const s = { ...state, wlRag: true, wlAgents: true, wlCoding: true, wlAgenticCoding: true, ragEnabled: true, toolUseEnabled: true, memoryEnabled: true, carryEnabled: true };
  const { traces } = engine.evaluate(s, { hardware: [{ id: 'nvidia_h200', memoryGB: 141, defaultBench: { '70B-class': 25, '8B-class': 250 } }] });
  for (const t of Object.values(traces)) {
    expect(t.algebra.length).toBeGreaterThan(0);
    expect(t.plainEnglish.length).toBeGreaterThan(0);
    expect(t.substitution.length).toBeGreaterThan(0);
    expect(Array.isArray(t.variables)).toBe(true);
  }
});

test('hardware ceiling: capex only, 40 percent threshold (decision 0.4)', () => {
  const { ceilingMonthly, ceilingCapex, verdict } = hardwareCeiling({ ...state, gpuQuote: 100000 }, 10000);
  expect(ceilingMonthly).toBe(6000);              // 10000 * 0.60
  expect(ceilingCapex).toBe(6000 * 36);           // 216,000
  expect(verdict.under).toBe(true);               // 100k < 216k
});

test('do-not-size fires when critical gates are missing (decision 0.2.8)', () => {
  const missing = checkDoNotSize({ ...state, dataCanLeave: null });
  expect(missing.length).toBeGreaterThan(0);
  const rec = recommend({ ...state, dataCanLeave: null }, {}, rules, { providerMonthlyCost: 0, usageVersusBreakEven: 0 }, {});
  expect(rec.kind).toBe('do-not-size');
});

test('routes normalize to 0-100 and expose fired components (decisions 0.2.5, spec 31.10)', () => {
  const { values } = engine.evaluate(state, {});
  const rec = recommend(state, values, rules, { providerMonthlyCost: 5000, usageVersusBreakEven: 0.4 }, {});
  expect(rec.kind === 'single' || rec.kind === 'co-recommend').toBe(true);
  for (const r of rec.routes) {
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  }
  expect(rec.rulesFired.length).toBeGreaterThan(0);
});

test('confidence model averages eight inputs (spec 38)', () => {
  const c = confidence(state, {});
  expect(c.scores.length).toBe(8);
  expect(['High', 'Medium', 'Low']).toContain(c.band);
});

/* ---------- audit-driven tests (adversarial findings, 2026-07-03) ---------- */

test('billing parity: every counted token is a priced token (critical audit finding)', () => {
  const s = { ...structuredClone(defaults), ragEnabled: true, ragCallsPerRun: 2, toolUseEnabled: true, memoryEnabled: true, carryEnabled: true };
  const { values } = engine.evaluate(s, {});
  const counted = values.agentMonthlyInputTokens + values.agentMonthlyOutputTokens;
  const { billedTokens } = roleRoutedCost(s, values, rates);
  expect(billedTokens).toBeCloseTo(counted, 4);
});

test('replan calls attribute to the planner only (spec 13.5)', () => {
  const s = { ...structuredClone(defaults), replanRatePercent: 20 };
  const { values } = engine.evaluate(s, {});
  const { plan } = effectiveRolePlan(s, values);
  const planner = plan.find((p) => p.role === 'planner');
  const worker = plan.find((p) => p.role === 'worker');
  // planner: 1 call * retryScale 1.1 + 0.2 replan = 1.3; worker: 4 * 1.1 only.
  expect(planner.calls).toBeCloseTo(1.3, 10);
  expect(worker.calls).toBeCloseTo(4.4, 10);
});

test('owned-hardware cost gate is inert without a quote (self-reference audit finding)', () => {
  const { values } = engine.evaluate(state, {});
  const noQuote = scoreRoutes({ ...state, gpuQuote: null }, values, rules, { providerMonthlyCost: 5000, usageVersusBreakEven: 1.67 }, {});
  const owned = noQuote.routes.find((r) => r.key === 'owned');
  // The gate contributes ZERO points and its inert label stays visible so
  // the user knows why (display fix from the second audit round).
  const gate = owned.components.find((c) => c.label.includes('Cost gate'));
  expect(gate.points).toBe(0);
  expect(gate.label).toContain('inert');
  const withQuote = scoreRoutes({ ...state, gpuQuote: 50000 }, values, rules, { providerMonthlyCost: 5000, usageVersusBreakEven: 1.2 }, {});
  const owned2 = withQuote.routes.find((r) => r.key === 'owned');
  expect(owned2.components.some((c) => c.label.includes('Cost gate'))).toBe(true);
});

test('break even uses the billed-token basis, not diluted totals (audit finding)', () => {
  const s = { ...structuredClone(defaults), wlCoding: true };  // adds unbilled quick workload
  const { values } = engine.evaluate(s, {});
  const { total, billedTokens } = roleRoutedCost(s, values, rates);
  const be = breakEvenTokens(s, values, total, billedTokens);
  const expectedCostPerM = total / (billedTokens / 1e6);
  expect(be.variables.find((v) => v.symbol === 'managedWeightedCostPerMillion').value).toBeCloseTo(expectedCostPerM, 6);
});

test('chunk overlap >= chunk size is flagged, never computed as garbage', () => {
  const s = { ...structuredClone(defaults), ragEnabled: true, chunkSize: 512, chunkOverlap: 512 };
  expect(validateInputs(s).some((e) => e.field === 'chunkOverlap')).toBe(true);
  const { values } = engine.evaluate(s, {});
  expect(values.chunksPerDocument).toBeNull();
});

test('batch discount and embedding fees enter the cost (spec 15.1, 15.3)', () => {
  const { values } = engine.evaluate(state, {});
  const base = roleRoutedCost(state, values, rates).total;
  const batched = roleRoutedCost({ ...state, batchEligiblePercent: 80 }, values, rates).total;
  expect(batched).toBeLessThan(base);
  const s2 = { ...structuredClone(defaults), ragEnabled: true, embeddingPricePerMillion: 0.1 };
  const v2 = engine.evaluate(s2, {}).values;
  const r2 = roleRoutedCost(s2, v2, rates);
  expect(r2.embeddingFee).toBeGreaterThan(0);
});

test('savings threshold over 90 is clamped, ceiling never negative', () => {
  const { ceilingMonthly } = hardwareCeiling({ ...state, savingsThresholdPercent: 150 }, 10000);
  expect(ceilingMonthly).toBeCloseTo(1000, 6); // clamped at 90 -> 0.10 * 10000
});

test('route maxima derive from live weights; slider overrides cannot push scores past 100', () => {
  const { values } = engine.evaluate(state, {});
  const boosted = {};
  for (const [rk, r] of Object.entries(rules.routes)) for (const wk of Object.keys(r.weights ?? {})) boosted[`${rk}.${wk}`] = (r.weights[wk].max ?? r.weights[wk].default);
  const { routes } = scoreRoutes(state, values, rules, { providerMonthlyCost: 100000, usageVersusBreakEven: 2 }, boosted);
  for (const r of routes) { expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100); }
});

test('policy conflict fires a critical warning when a public route leads with data locked down (spec 37)', () => {
  const s = { ...structuredClone(defaults), dataCanLeave: 'no', needTimeToValue: 3, needQuality: 3, needLowOps: 3, needGovernance: 0, needAudit: 0, needDataGravity: 0, needEnterpriseRetrieval: 0, needInternalApis: 0, permitsPrivateCloud: false };
  const { values } = engine.evaluate(s, {});
  const rec = recommend(s, values, rules, { providerMonthlyCost: 1000, usageVersusBreakEven: 0 }, {});
  if (['direct', 'cloud'].includes(rec.top?.key)) {
    expect(rec.warnings.some((w) => w.severity === 'critical')).toBe(true);
  } else {
    expect(rec.top.key).not.toBe('direct'); // policy pressure already reordered routes; also acceptable
  }
});

test('provider rate pinning: seeded prices match the 2026-07-03 verified values (drift alarm)', () => {
  const pin = (pk, tier, inP, cachedP, outP) => {
    const r = rates.find((x) => x.providerKey === pk && x.tier === tier);
    expect(r.inputPerMillion).toBe(inP);
    expect(r.cachedInputPerMillion).toBe(cachedP);
    expect(r.outputPerMillion).toBe(outP);
  };
  pin('anthropic', 'flagship', 10, 1, 50);
  pin('anthropic', 'workhorse', 2, 0.2, 10);
  pin('anthropic', 'mini', 1, 0.1, 5);
  pin('openai', 'flagship', 5, 0.5, 30);
  pin('gemini', 'mini', 0.25, 0.025, 1.5);
  pin('azure_openai', 'mini', 0.2, 0.02, 1.25);
  pin('bedrock', 'workhorse', 2.2, 0.22, 11);
});

test('stale pill logic marks sources older than 60 days (decision 0.3.11)', () => {
  const old = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const html = sourceLinkPills(['x'], [{ id: 'x', label: 'Old source', url: 'https://example.com', lastReviewed: old }]);
  expect(html).toContain('STALE');
  const fresh = sourceLinkPills(['y'], [{ id: 'y', label: 'Fresh', url: 'https://example.com', lastReviewed: new Date().toISOString().slice(0, 10) }]);
  expect(fresh).not.toContain('STALE');
});

test('all three do-not-size gates fire individually (decision 0.2.8)', () => {
  expect(checkDoNotSize({ ...state, dataCanLeave: null }).length).toBeGreaterThan(0);
  expect(checkDoNotSize({ ...state, users: 0 }).length).toBeGreaterThan(0);
  expect(checkDoNotSize({ ...state, budgetConfidence: 'unknown' }).length).toBeGreaterThan(0);
  expect(checkDoNotSize(state).length).toBe(0);
});

test('audit document exists in the repo (decision 0.8.32)', () => {
  expect(existsSync(new URL('../docs/tokenops-audit.md', import.meta.url).pathname)).toBe(true);
  expect(existsSync(new URL('../docs/tokenops.md', import.meta.url).pathname)).toBe(true);
});

/* ---------- recheck-round regression tests (2026-07-03 second audit) ---------- */

test('no phantom savings: lever to an unpriced tier is advisory, never a dollar claim', async () => {
  const { optimizationLevers } = await import('../src/lib/tokenops/costs.js');
  const localRates = structuredClone(rates);
  const cw = localRates.find((r) => r.providerKey === 'custom' && r.tier === 'workhorse');
  cw.inputPerMillion = 2; cw.cachedInputPerMillion = 0.2; cw.outputPerMillion = 10;
  const s = structuredClone(defaults);
  s.roles.worker = { ...s.roles.worker, provider: 'custom' }; // priced workhorse, UNPRICED mini
  const { values } = engine.evaluate(s, {});
  const { total } = roleRoutedCost(s, values, localRates);
  const levers = optimizationLevers(s, values, localRates, total, (p) => engine.evaluate(p, {}).values);
  const miniLever = levers.find((l) => l.label.includes('mini tier'));
  expect(miniLever.savings).toBe(0);
  expect(miniLever.substitution).toContain('not computed');
});

test('break even chart basis: cost-per-million times break-even equals the monthly budget exactly', () => {
  const s = { ...structuredClone(defaults), wlRag: true }; // quick workload on: the old bug trigger
  const { values } = engine.evaluate(s, {});
  const { total, billedTokens } = roleRoutedCost(s, values, rates);
  const be = breakEvenTokens(s, values, total, billedTokens);
  expect(be.weightedCostPerMillion * be.result).toBeCloseTo(be.monthlyBudget, 6);
  // With a quote, the budget must be the amortized quote, not the ceiling.
  const be2 = breakEvenTokens({ ...s, gpuQuote: 90000 }, values, total, billedTokens);
  expect(be2.monthlyBudget).toBeCloseTo(90000 / s.usefulLifeMonths, 6);
});

test('hybrid raw score can never exceed its own theoretical max (routeFlexibility is likert-scaled)', () => {
  const s = { ...structuredClone(defaults), wlRag: true, wlAgents: true, wlCoding: true, wlAgenticCoding: true, needModelRouting: 3, escalationPercent: 20, dataCanLeave: 'with-controls' };
  const { values } = engine.evaluate(s, {});
  const { routes } = scoreRoutes(s, values, rules, { providerMonthlyCost: 5000, usageVersusBreakEven: 0.5 }, {});
  const hybrid = routes.find((r) => r.key === 'hybrid');
  expect(hybrid.raw).toBeLessThanOrEqual(hybrid.max);
  expect(hybrid.score).toBeLessThanOrEqual(100);
});

test('unpriced role is surfaced, and billedTokens excludes its tokens (no silent dilution)', () => {
  const s = structuredClone(defaults);
  s.roles.worker = { ...s.roles.worker, provider: 'custom' }; // custom rows ship unpriced
  const { values } = engine.evaluate(s, {});
  const all = roleRoutedCost(structuredClone(defaults), values, rates);
  const partial = roleRoutedCost(s, values, rates);
  expect(partial.missingRoles.length).toBe(1);
  expect(partial.missingRoles[0]).toContain('worker');
  expect(partial.billedTokens).toBeLessThan(all.billedTokens);
  expect(partial.total).toBeLessThan(all.total);
});

test('FRED BUG 2026-07-03: quick workloads are PRICED, demand can never show $0 (422M token case)', () => {
  // Reproduces the live report: RAG quick workload on, zero agent runs.
  const s = { ...structuredClone(defaults), wlRag: true, users: 0 };
  const { values } = engine.evaluate(s, {});
  expect(values.ragMonthlyTokens).toBe(422400000); // 2000 * 20 * 22 * 8 * 60
  const { total, billedTokens, perRole } = roleRoutedCost(s, values, rates);
  expect(total).toBeGreaterThan(0);                       // dollars exist now
  expect(billedTokens).toBeGreaterThanOrEqual(422400000); // and they cover the demand
  const quick = perRole.find((r) => r.role === 'quick workloads');
  expect(quick.cost).toBeGreaterThan(0);
  // Hand check at 70/30 split, Anthropic workhorse (2 / 0.2 / 10), 40% cache:
  // in 295.68M -> 0.6*295.68*2 + 0.4*295.68*0.2 = 354.816 + 23.6544
  // out 126.72M -> 126.72 * 10 = 1267.2   => total 1645.67
  expect(quick.cost).toBeCloseTo(1645.67, 1);
});

test('quick workload pricing respects the editable input/output split', () => {
  const s = { ...structuredClone(defaults), wlRag: true, users: 0 };
  const { values } = engine.evaluate(s, {});
  const at70 = roleRoutedCost({ ...s, quickInputSharePercent: 70 }, values, rates).total;
  const at100 = roleRoutedCost({ ...s, quickInputSharePercent: 100 }, values, rates).total;
  expect(at100).toBeLessThan(at70); // all-input is cheaper than 30% output at 5x pricing
});

test('do-not-size usage gate accepts non-agent workloads (coding-only is known usage)', () => {
  const s = { ...structuredClone(defaults), wlModernAgent: false, wlCoding: true, developers: 25, users: 0 };
  expect(checkDoNotSize(s).length).toBe(0);
});

test('role routed cost prices cached vs uncached correctly (spec 15.1-15.2)', () => {
  const rates = [
    { providerKey: 'anthropic', tier: 'flagship', model: 'Test F', inputPerMillion: 10, cachedInputPerMillion: 1, outputPerMillion: 50 },
    { providerKey: 'anthropic', tier: 'workhorse', model: 'Test W', inputPerMillion: 3, cachedInputPerMillion: 0.3, outputPerMillion: 15 },
    { providerKey: 'anthropic', tier: 'mini', model: 'Test M', inputPerMillion: 1, cachedInputPerMillion: 0.1, outputPerMillion: 5 },
  ];
  const { values } = engine.evaluate(state, {});
  const { total, perRole } = roleRoutedCost(state, values, rates);
  expect(total).toBeGreaterThan(0);
  const planner = perRole.find((r) => r.role === 'planner');
  // planner: 11000 runs * 1.1 calls * 3000 in = 36.3 MTok, 40% cached
  expect(planner.inputMTok).toBeCloseTo(36.3, 6);
  expect(planner.cachedMTok).toBeCloseTo(14.52, 6);
  const expectedPlanner = (36.3 - 14.52) * 10 + 14.52 * 1 + (11000 * 1.1 * 500 / 1e6) * 50;
  expect(planner.cost).toBeCloseTo(expectedPlanner, 6);
});

/* ---------- finance decision (Fred's ROI sliders, 2026-07-03) ---------- */

test('finance decision: verdicts flip at the right thresholds', async () => {
  const { financeDecision, hardwareCeiling } = await import('../src/lib/tokenops/costs.js');
  const s = structuredClone(defaults);
  const provider = 10000; // $10k/mo tokens
  const ceiling = hardwareCeiling(s, provider); // $6k/mo bar, $216k capex
  // No quote: demand one.
  expect(financeDecision({ ...s, gpuQuote: null }, provider, ceiling).verdict).toBe('quote');
  // Cash $180k over 36 = $5k/mo <= $6k bar -> BUY.
  const buy = financeDecision({ ...s, gpuQuote: 180000, financeMode: 'cash' }, provider, ceiling);
  expect(buy.verdict).toBe('buy');
  expect(buy.payment).toBeCloseTo(5000, 6);
  expect(buy.savings).toBeCloseTo(10000 * 36 - 180000, 6); // $180k saved
  expect(buy.roiPct).toBeCloseTo(100, 6);
  // Cash $300k over 36 = $8.33k/mo: cheaper than tokens, misses the 40% bar -> NEGOTIATE.
  expect(financeDecision({ ...s, gpuQuote: 300000, financeMode: 'cash' }, provider, ceiling).verdict).toBe('negotiate');
  // Cash $450k over 36 = $12.5k/mo > tokens -> TOKENS.
  expect(financeDecision({ ...s, gpuQuote: 450000, financeMode: 'cash' }, provider, ceiling).verdict).toBe('tokens');
});

test('finance decision: loan payment matches the standard amortization formula', async () => {
  const { financeDecision, hardwareCeiling } = await import('../src/lib/tokenops/costs.js');
  const s = { ...structuredClone(defaults), gpuQuote: 100000, financeMode: 'financed', financeAprPercent: 8, financeTermMonths: 36 };
  const fin = financeDecision(s, 10000, hardwareCeiling(s, 10000));
  // 100000 at 8% APR over 36 months: r=0.0066667, payment = 3133.64
  expect(fin.payment).toBeCloseTo(3133.64, 1);
  expect(fin.verdict).toBe('buy');
});

test('example Customer stories do not contradict the engine (calls and daily volume)', () => {
  // Every load-bearing number a persona quotes must be reproducible by running
  // that persona through the same engine the tool uses. Catches story drift.
  const check = (company, expect_) => {
    const p = personas.find((x) => x.companyName === company);
    const { values } = engine.evaluate({ ...structuredClone(defaults), ...p.inputs }, {});
    const ad = p.inputs.activeDaysPerMonth ?? 22;
    const runsDay = Math.round(values.monthlyRuns / ad);
    const callsDay = Math.round(runsDay * values.baseCallsPerRun);
    const blob = JSON.stringify(p);
    expect(values.baseCallsPerRun).toBe(expect_.baseCalls);
    // If the story cites a daily model-calls figure, it must be the real one.
    if (expect_.callsDayStr) expect(blob).toContain(expect_.callsDayStr);
    // The wrong figures must be gone.
    for (const wrong of expect_.mustNotContain ?? []) expect(blob).not.toContain(wrong);
    return { runsDay, callsDay, tokDayB: values.totalMonthlyTokens / ad / 1e9 };
  };
  const h = check('Harborline Mutual', { baseCalls: 12, callsDayStr: '74,880', mustNotContain: ['94,000', '15 calls each', '15 model calls per run'] });
  expect(h.callsDay).toBe(74880);
  const n = check('Northgale Communications', { baseCalls: 15, mustNotContain: ['27 billion tokens'] });
  expect(Math.round(n.tokDayB)).toBe(37); // story now says ~37 billion, matching
});

test('finance and break even use ONE ownership payment (no card disagreement)', async () => {
  const { financeDecision, hardwareCeiling, breakEvenTokens, ownershipMonthly, roleRoutedCost } = await import('../src/lib/tokenops/costs.js');
  const s = { ...structuredClone(defaults), gpuQuote: 120000, financeMode: 'financed', financeAprPercent: 8, financeTermMonths: 24 };
  const { values } = engine.evaluate(s, {});
  const { total, billedTokens } = roleRoutedCost(s, values, rates);
  const fin = financeDecision(s, 10000, hardwareCeiling(s, 10000));
  const be = breakEvenTokens(s, values, 10000, billedTokens);
  // Break even's monthly budget IS the finance payment, to the cent.
  expect(be.monthlyBudget).toBeCloseTo(fin.payment, 6);
  expect(fin.payment).toBeCloseTo(ownershipMonthly(s), 6);
  // The substitution shows a real amortization formula, not placeholder text.
  expect(fin.substitution).not.toContain('1.0)');
  expect(fin.substitution).toMatch(/\[.*\] \/ \[.* - 1\]/);
});

test('servable share below 100 lowers the ceiling and states the hybrid remainder', async () => {
  const { hardwareCeiling } = await import('../src/lib/tokenops/costs.js');
  const full = hardwareCeiling(state, 10000);
  const partial = hardwareCeiling({ ...state, servableSharePercent: 70 }, 10000);
  expect(partial.ceilingMonthly).toBeCloseTo(10000 * 0.7 * 0.6, 6); // 4200
  expect(partial.ceilingMonthly).toBeLessThan(full.ceilingMonthly);
  const monthlyTrace = partial.traces.find((t) => t.id === 'hardwareCeilingMonthly');
  expect(monthlyTrace.assumptions.some((a) => /hybrid/.test(a))).toBe(true);
});

test('cloud carries direct fit before policy AND pays its own lower policy penalty', () => {
  const canLeave = { ...structuredClone(defaults), dataCanLeave: 'yes', needTimeToValue: 3, needQuality: 3 };
  const cannot = { ...canLeave, dataCanLeave: 'no', dataSensitivity: 'high', regulatedData: true };
  const { values } = engine.evaluate(canLeave, {});
  const openCloud = scoreRoutes(canLeave, values, rules, { providerMonthlyCost: 5000 }, {}).routes.find((r) => r.key === 'cloud');
  const lockedCloud = scoreRoutes(cannot, values, rules, { providerMonthlyCost: 5000 }, {}).routes.find((r) => r.key === 'cloud');
  // Policy pressure now costs cloud points (it had none before), so a locked-
  // down posture scores cloud lower than an open one.
  expect(lockedCloud.penalties.some((p) => /policy pressure/i.test(p.label))).toBe(true);
  expect(lockedCloud.raw).toBeLessThan(openCloud.raw);
});

test('a $1 quote is called a typo, not a deal (Fred UX catch)', async () => {
  const { hardwareCeiling, financeDecision } = await import('../src/lib/tokenops/costs.js');
  const s = { ...structuredClone(defaults), gpuQuote: 1 };
  const ceiling = hardwareCeiling(s, 10000);
  expect(ceiling.verdict.implausible).toBe(true);
  const fin = financeDecision(s, 10000, ceiling);
  expect(fin.headline).toBe('THAT IS NOT A QUOTE');
  // A real quote still verdicts normally.
  const real = hardwareCeiling({ ...s, gpuQuote: 150000 }, 10000);
  expect(real.verdict.implausible).toBeUndefined();
  expect(real.verdict.under).toBe(true);
});

/* ---------- all-HPE conversation configuration (Fred's go, 2026-07-03) ---------- */

test('HPE config packs GPUs into the right chassis, no prices anywhere', async () => {
  const { buildHpeConfig } = await import('../src/lib/tokenops/hpeConfig.js');
  const { hardwareCeiling } = await import('../src/lib/tokenops/costs.js');
  const hardware = (await import('../src/data/tokenops/hardware-profiles.json', { with: { type: 'json' } })).default;
  const ceiling = hardwareCeiling(structuredClone(defaults), 10000);
  // 24 H200s -> 3x XD685.
  let cfg = buildHpeConfig({ ...structuredClone(defaults), gpuChoice: 'nvidia_h200' }, { recommendedGpuCount: 24, protectedStorageTB: 40 }, ceiling, null, hardware);
  expect(cfg.servers).toBe(3);
  expect(cfg.lines[0].item).toContain('XD685');
  // 12 RTX PRO 6000 -> 2x DL380a Gen12.
  cfg = buildHpeConfig({ ...structuredClone(defaults), gpuChoice: 'nvidia_rtx_pro_6000_blackwell' }, { recommendedGpuCount: 12, protectedStorageTB: 10 }, ceiling, null, hardware);
  expect(cfg.servers).toBe(2);
  expect(cfg.lines[0].item).toContain('DL380a');
  // MI355X -> XD685.
  cfg = buildHpeConfig({ ...structuredClone(defaults), gpuChoice: 'amd_mi355x' }, { recommendedGpuCount: 8, protectedStorageTB: 20 }, ceiling, null, hardware);
  expect(cfg.servers).toBe(1);
  expect(cfg.lines[0].item).toContain('XD685');
  // The budget line carries the ceiling, and nothing in the card is a price of a part.
  expect(cfg.budgetLine).toContain('must land under');
  const together = JSON.stringify(cfg);
  expect(together).not.toMatch(/\$\d+.*per (GPU|server|node)/);
});
