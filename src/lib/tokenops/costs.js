/* TokenOps provider cost + hardware ceiling economics.
   Spec sections 15-17 and 28-30, as amended by decision 0.4:
   TokenOps NEVER prices hardware. It derives the capex budget ceiling the
   recommended configuration must come UNDER for ownership to beat tokens.
   All functions return FormulaTrace-shaped objects so no math hides. */

import { fmt, money } from './engine.js';
import { ROLE_LIST, roleCallsPerRun } from './formulas.js';

export function findRate(rates, provider, tier) {
  return rates.find((r) => r.providerKey === provider && r.tier === tier) || null;
}

/* Monthly cost of the agent workload with each role priced on its assigned
   provider+tier. Returns {total, perRole:[...], traces:[...]} */
export function roleRoutedCost(state, values, rates) {
  const R = values;
  const scale = R.baseCallsPerRun > 0 ? R.totalCallsPerRun / R.baseCallsPerRun : 1;
  const runs = R.monthlyRuns ?? 0;
  const cachedShare = (state.cachedInputPercent ?? 0) / 100;
  const perRole = [];
  let total = 0;
  for (const role of ROLE_LIST) {
    const calls = roleCallsPerRun(state, role) * scale;
    const cfg = state.roles[role];
    if (!calls || !cfg) continue;
    const rate = findRate(rates, cfg.provider, cfg.tier);
    if (!rate || rate.inputPerMillion == null) {
      perRole.push({ role, calls, missing: true, provider: cfg.provider, tier: cfg.tier });
      continue;
    }
    const inTokM = (runs * calls * cfg.inputTokensPerCall) / 1e6;
    const outTokM = (runs * calls * (cfg.outputTokensPerCall + (cfg.reasoningTokensPerCall || 0))) / 1e6;
    const cachedM = inTokM * cachedShare;
    const uncachedM = inTokM - cachedM;
    const cachedPrice = rate.cachedInputPerMillion ?? rate.inputPerMillion;
    const cost = uncachedM * rate.inputPerMillion + cachedM * cachedPrice + outTokM * rate.outputPerMillion;
    perRole.push({
      role, calls, provider: cfg.provider, tier: cfg.tier, model: rate.model,
      inputMTok: inTokM, cachedMTok: cachedM, uncachedMTok: uncachedM, outputMTok: outTokM,
      inputPrice: rate.inputPerMillion, cachedPrice, outputPrice: rate.outputPerMillion,
      cost, sourceId: rate.sourceId, lastReviewed: rate.lastReviewed, userSupplied: !!rate.userSupplied,
      substitution: `${money(cost)} = (${fmt(uncachedM)} MTok * ${money(rate.inputPerMillion, 2)}) + (${fmt(cachedM)} MTok * ${money(cachedPrice, 2)}) + (${fmt(outTokM)} MTok * ${money(rate.outputPerMillion, 2)})`,
    });
    total += cost;
  }
  return { total, perRole };
}

/* Same workload priced entirely inside one provider family (role tier mapping
   kept), for the comparison table + cost range. */
export function providerComparison(state, values, rates, providerKeys) {
  const rows = [];
  for (const pk of providerKeys) {
    const saved = {};
    for (const role of ROLE_LIST) { saved[role] = state.roles[role]?.provider; if (state.roles[role]) state.roles[role] = { ...state.roles[role], provider: pk }; }
    const { total, perRole } = roleRoutedCost(state, values, rates);
    for (const role of ROLE_LIST) if (state.roles[role]) state.roles[role] = { ...state.roles[role], provider: saved[role] };
    const missing = perRole.some((r) => r.missing);
    const runs = values.monthlyRuns ?? 0;
    rows.push({
      providerKey: pk,
      monthlyCost: missing ? null : total,
      costPerRun: missing || !runs ? null : total / runs,
      costPerUserPerMonth: missing || !state.users ? null : total / state.users,
      missing,
      perRole,
    });
  }
  const priced = rows.filter((r) => r.monthlyCost != null);
  const min = priced.length ? Math.min(...priced.map((r) => r.monthlyCost)) : null;
  const max = priced.length ? Math.max(...priced.map((r) => r.monthlyCost)) : null;
  return { rows, min, max };
}

export function cachingSavings(state, values, rates) {
  const { total: withCache } = roleRoutedCost(state, values, rates);
  const saved = state.cachedInputPercent;
  state.cachedInputPercent = 0;
  const { total: withoutCache } = roleRoutedCost(state, values, rates);
  state.cachedInputPercent = saved;
  const savings = withoutCache - withCache;
  return {
    id: 'promptCachingSavings',
    title: 'Prompt caching savings',
    shortAnswer: `Caching saves ${money(savings)} per month (${withoutCache > 0 ? fmt((savings / withoutCache) * 100, 1) : 0} percent).`,
    whyItMatters: 'Cached input is typically billed at about a tenth of the normal input rate.',
    plainEnglish: 'cost without caching minus cost with caching',
    algebra: 'promptCachingSavings = costWithoutCaching - costWithCaching',
    substitution: `${money(savings)} = ${money(withoutCache)} - ${money(withCache)}`,
    result: savings,
    resultUnit: 'USD per month',
    variables: [
      { symbol: 'costWithoutCaching', label: 'Cost without caching', value: withoutCache },
      { symbol: 'costWithCaching', label: `Cost with ${state.cachedInputPercent}% cache hits`, value: withCache },
    ],
    assumptions: [`Cache hit rate ${state.cachedInputPercent} percent, editable.`],
    sourceIds: [], warnings: [], section: 'cost',
  };
}

/* ---------- Decision 0.4: the hardware budget ceiling ---------- */

export function hardwareCeiling(state, providerMonthlyCost) {
  const threshold = 1 - (state.savingsThresholdPercent ?? 40) / 100; // 0.60
  const ceilingMonthly = providerMonthlyCost * threshold;
  const ceilingCapex = ceilingMonthly * state.usefulLifeMonths;
  const quote = state.gpuQuote;
  const verdict = quote == null ? null : {
    under: quote <= ceilingCapex,
    delta: Math.abs(ceilingCapex - quote),
    monthlyEquivalent: quote / state.usefulLifeMonths,
  };
  return {
    ceilingMonthly, ceilingCapex, verdict,
    traces: [
      {
        id: 'hardwareCeilingMonthly',
        title: 'Hardware budget ceiling (monthly)',
        shortAnswer: `Owned hardware must beat ${money(ceilingMonthly)} per month to make sense.`,
        whyItMatters: `Owned infrastructure must be at least ${state.savingsThresholdPercent} percent cheaper than the token route before cost alone can recommend it, because ownership adds operational risk, capacity planning, and lifecycle burden. This rule is visible on purpose.`,
        plainEnglish: 'provider monthly cost times one minus the required savings threshold',
        algebra: 'ceilingMonthly = providerMonthlyCost * (1 - savingsThresholdPercent)',
        substitution: `${money(ceilingMonthly)} = ${money(providerMonthlyCost)} * ${fmt(threshold, 2)}`,
        result: ceilingMonthly, resultUnit: 'USD per month',
        variables: [
          { symbol: 'providerMonthlyCost', label: 'Provider monthly cost (baseline route)', value: providerMonthlyCost },
          { symbol: 'savingsThresholdPercent', label: 'Required savings threshold', value: (state.savingsThresholdPercent ?? 40) / 100, editable: true },
        ],
        assumptions: ['TokenOps never prices hardware. It tells you what the hardware has to cost. Hold real quotes against this ceiling.'],
        sourceIds: [], warnings: [], section: 'economics',
      },
      {
        id: 'hardwareCeilingCapex',
        title: 'Hardware budget ceiling (total capex)',
        shortAnswer: `The recommended configuration must come in under ${money(ceilingCapex)} all-in.`,
        whyItMatters: 'This is the negotiating number. A quote under this line beats the token route by your required margin; a quote over it does not.',
        plainEnglish: 'the monthly ceiling times the useful life in months, capex only per the settled decision',
        algebra: 'ceilingCapex = ceilingMonthly * usefulLifeMonths',
        substitution: `${money(ceilingCapex)} = ${money(ceilingMonthly)} * ${state.usefulLifeMonths}`,
        result: ceilingCapex, resultUnit: 'USD',
        variables: [
          { symbol: 'ceilingMonthly', label: 'Monthly ceiling', value: ceilingMonthly },
          { symbol: 'usefulLifeMonths', label: 'Useful life months', value: state.usefulLifeMonths, editable: true },
        ],
        assumptions: ['Capex only. Power, cooling, and labor are intentionally out of scope in this release.'],
        sourceIds: [], warnings: quote == null ? [{ severity: 'info', message: 'Enter a real quote beside the ceiling to get an instant under or over verdict.' }] : [],
        section: 'economics',
      },
    ],
  };
}

export function breakEvenTokens(state, values, rates, providerMonthlyCost) {
  const totalMTok = (values.totalMonthlyTokens ?? 0) / 1e6;
  const weightedCostPerMillion = totalMTok > 0 ? providerMonthlyCost / totalMTok : null;
  const monthlyBudget = state.gpuQuote != null
    ? state.gpuQuote / state.usefulLifeMonths
    : providerMonthlyCost * (1 - (state.savingsThresholdPercent ?? 40) / 100);
  const be = weightedCostPerMillion ? monthlyBudget / weightedCostPerMillion : null;
  return {
    id: 'breakEvenMillionTokens',
    title: 'Break even monthly tokens',
    shortAnswer: be ? `Ownership starts to make sense near ${fmt(be)} million tokens per month.` : 'Needs token volume and provider cost first.',
    whyItMatters: 'Below this line, tokens win. Above it, the owned route earns its keep.',
    plainEnglish: 'the monthly hardware budget divided by the managed cost per million tokens',
    algebra: 'breakEvenMillionTokens = monthlyHardwareBudget / managedWeightedCostPerMillion',
    substitution: be ? `${fmt(be)} MTok = ${money(monthlyBudget)} / ${money(weightedCostPerMillion, 2)}` : 'not computed',
    result: be, resultUnit: 'million tokens per month',
    variables: [
      { symbol: 'monthlyHardwareBudget', label: state.gpuQuote != null ? 'Your quote amortized monthly' : 'Ceiling monthly budget', value: monthlyBudget },
      { symbol: 'managedWeightedCostPerMillion', label: 'Managed cost per million tokens', value: weightedCostPerMillion },
    ],
    assumptions: ['Uses your entered quote when present, otherwise the derived ceiling.'],
    sourceIds: [], warnings: [], section: 'economics',
    currentMTok: totalMTok,
    usageVersusBreakEven: be ? totalMTok / be : null,
  };
}

export function rentedGpuCost(state) {
  if (state.rentedGpuHourly == null) return null;
  const monthly = state.rentedGpuHourly * state.rentedGpuCount * state.rentedActiveHoursPerMonth
    + state.rentedStorageMonthly + state.rentedNetworkMonthly + state.rentedPlatformMonthly;
  const validation = state.rentedGpuHourly * state.rentedGpuCount * state.rentedValidationHours
    + state.rentedStorageMonthly + state.rentedNetworkMonthly;
  return {
    id: 'rentedGpuMonthlyCost',
    title: 'Rented GPU monthly cost',
    shortAnswer: `${money(monthly)} per month rented, ${money(validation)} for a validation project.`,
    whyItMatters: 'Renting buys real benchmarks and real usage data before anyone signs a hardware PO.',
    plainEnglish: 'hourly price times GPU count times active hours, plus storage, network, and platform fees',
    algebra: 'rentedGpuMonthlyCost = gpuHourlyPrice * gpuCount * activeHoursPerMonth + storageMonthly + networkMonthly + platformMonthly',
    substitution: `${money(monthly)} = ${money(state.rentedGpuHourly, 2)} * ${state.rentedGpuCount} * ${state.rentedActiveHoursPerMonth} + ${money(state.rentedStorageMonthly)} + ${money(state.rentedNetworkMonthly)} + ${money(state.rentedPlatformMonthly)}`,
    result: monthly, resultUnit: 'USD per month',
    variables: [
      { symbol: 'gpuHourlyPrice', label: 'GPU hourly price', value: state.rentedGpuHourly, editable: true, source: 'user supplied' },
      { symbol: 'gpuCount', label: 'GPU count', value: state.rentedGpuCount, editable: true },
      { symbol: 'activeHoursPerMonth', label: 'Active hours per month', value: state.rentedActiveHoursPerMonth, editable: true },
    ],
    assumptions: ['Rental pricing is user supplied; TokenOps ships no rental price defaults in this release.'],
    sourceIds: [], warnings: [], section: 'economics',
    validationCost: validation,
  };
}
