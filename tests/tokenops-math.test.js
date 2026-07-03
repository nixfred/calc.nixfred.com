/* TokenOps math audit: spec section 46 QA scenario, exact expected numbers.
   These values are the acceptance contract; if they drift, the build is wrong. */

import { test, expect } from 'bun:test';
import { engine, formulaDefs } from '../src/lib/tokenops/formulas.js';
import { validateInputs } from '../src/lib/tokenops/engine.js';
import { hardwareCeiling, breakEvenTokens, roleRoutedCost } from '../src/lib/tokenops/costs.js';
import { recommend, checkDoNotSize, confidence } from '../src/lib/tokenops/routes.js';
import defaults from '../src/data/tokenops/tokenops-defaults.json';
import rules from '../src/data/tokenops/route-rules.json';

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
