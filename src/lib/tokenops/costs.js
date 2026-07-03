/* TokenOps provider cost + hardware ceiling economics.
   Spec sections 15-17 and 28-30, as amended by decision 0.4:
   TokenOps NEVER prices hardware. It derives the capex budget ceiling the
   recommended configuration must come UNDER for ownership to beat tokens.
   All functions return FormulaTrace-shaped objects so no math hides. */

import { fmt, money } from './engine.js';
import { ROLE_LIST, effectiveRolePlan } from './formulas.js';

export function findRate(rates, provider, tier) {
  return rates.find((r) => r.providerKey === provider && r.tier === tier) || null;
}

/* Monthly cost of the agent workload with each role priced on its assigned
   provider+tier. Token counts come from effectiveRolePlan, the SAME source
   the demand model uses, so every counted token is a priced token.
   Applies batch discount (spec 15.3), regional uplift (15.4), and embedding
   fees (15.1) on top of the base token math. */
export function roleRoutedCost(state, values, rates) {
  const runs = values.monthlyRuns ?? 0;
  const cachedShare = (state.cachedInputPercent ?? 0) / 100;
  const batchShare = (state.batchEligiblePercent ?? 0) / 100;
  const { plan } = effectiveRolePlan(state, values);
  const perRole = [];
  let total = 0;
  for (const p of plan) {
    const cfg = state.roles[p.role];
    const rate = findRate(rates, cfg.provider, cfg.tier);
    if (!rate || rate.inputPerMillion == null) {
      perRole.push({ role: p.role, calls: p.calls, missing: true, provider: cfg.provider, tier: cfg.tier });
      continue;
    }
    const inTokM = (runs * p.inPerRun) / 1e6;
    const outTokM = (runs * p.outPerRun) / 1e6;
    const cachedM = inTokM * cachedShare;
    const uncachedM = inTokM - cachedM;
    const cachedPrice = rate.cachedInputPerMillion ?? rate.inputPerMillion;
    let cost = uncachedM * rate.inputPerMillion + cachedM * cachedPrice + outTokM * rate.outputPerMillion;
    let batchSavings = 0;
    if (batchShare > 0 && rate.batchDiscountMultiplier != null) {
      batchSavings = cost * batchShare * (1 - rate.batchDiscountMultiplier);
      cost -= batchSavings;
    }
    const uplift = (rate.regionalUpliftPercent ?? 0) / 100;
    if (uplift) cost *= 1 + uplift;
    perRole.push({
      role: p.role, calls: p.calls, provider: cfg.provider, tier: cfg.tier, model: rate.model,
      inputMTok: inTokM, cachedMTok: cachedM, uncachedMTok: uncachedM, outputMTok: outTokM,
      inputPrice: rate.inputPerMillion, cachedPrice, outputPrice: rate.outputPerMillion,
      cost, batchSavings, sourceId: rate.sourceId, lastReviewed: rate.lastReviewed, userSupplied: !!rate.userSupplied,
      substitution: `${money(cost)} = ${batchSavings || uplift ? '(' : ''}(${fmt(uncachedM)} MTok * ${money(rate.inputPerMillion, 2)}) + (${fmt(cachedM)} MTok * ${money(cachedPrice, 2)}) + (${fmt(outTokM)} MTok * ${money(rate.outputPerMillion, 2)})${batchSavings ? ` - ${money(batchSavings)} batch discount` : ''}${batchSavings || uplift ? ')' : ''}${uplift ? ` * ${fmt(1 + uplift, 2)} regional uplift` : ''}`,
    });
    total += cost;
  }
  // Quick-formula workloads (RAG, agents, coding, agentic coding, custom)
  // are REAL token demand and get priced too, at the worker role's rate,
  // with a visible editable input/output split. Fred found the gap live:
  // 422M tokens of demand showing $0. Never again.
  const quickTokens = (values.ragMonthlyTokens ?? 0) + (values.agentsMonthlyTokens ?? 0)
    + (values.codingMonthlyTokens ?? 0) + (values.agenticCodingMonthlyTokens ?? 0)
    + (state.customWorkloadMonthlyTokens ?? 0);
  let quickBilled = 0;
  if (quickTokens > 0) {
    const cfg = state.roles.worker ?? Object.values(state.roles)[0];
    const rate = findRate(rates, cfg.provider, cfg.tier);
    if (!rate || rate.inputPerMillion == null) {
      perRole.push({ role: 'quick workloads', calls: null, missing: true, provider: cfg.provider, tier: cfg.tier });
    } else {
      const inShare = Math.min(100, Math.max(0, state.quickInputSharePercent ?? 70)) / 100;
      const inTokM = (quickTokens * inShare) / 1e6;
      const outTokM = (quickTokens * (1 - inShare)) / 1e6;
      const cachedM = inTokM * cachedShare;
      const uncachedM = inTokM - cachedM;
      const cachedPrice = rate.cachedInputPerMillion ?? rate.inputPerMillion;
      let cost = uncachedM * rate.inputPerMillion + cachedM * cachedPrice + outTokM * rate.outputPerMillion;
      let batchSavings = 0;
      if (batchShare > 0 && rate.batchDiscountMultiplier != null) {
        batchSavings = cost * batchShare * (1 - rate.batchDiscountMultiplier);
        cost -= batchSavings;
      }
      const uplift = (rate.regionalUpliftPercent ?? 0) / 100;
      if (uplift) cost *= 1 + uplift;
      perRole.push({
        role: 'quick workloads', calls: null, provider: cfg.provider, tier: cfg.tier, model: rate.model,
        inputMTok: inTokM, cachedMTok: cachedM, uncachedMTok: uncachedM, outputMTok: outTokM,
        inputPrice: rate.inputPerMillion, cachedPrice, outputPrice: rate.outputPerMillion,
        cost, batchSavings, sourceId: rate.sourceId, lastReviewed: rate.lastReviewed, userSupplied: !!rate.userSupplied,
        substitution: `${money(cost)} = (${fmt(uncachedM)} MTok * ${money(rate.inputPerMillion, 2)}) + (${fmt(cachedM)} MTok * ${money(cachedPrice, 2)}) + (${fmt(outTokM)} MTok * ${money(rate.outputPerMillion, 2)}) at ${Math.round(inShare * 100)}/${Math.round((1 - inShare) * 100)} input/output split, editable`,
      });
      total += cost;
      quickBilled = quickTokens;
    }
  }
  // Embedding fees (spec 15.1). User-supplied price; warned when RAG is on without one.
  let embeddingFee = 0;
  if (state.ragEnabled && state.embeddingPricePerMillion != null && values.monthlyEmbeddingTokens) {
    embeddingFee = (values.monthlyEmbeddingTokens / 1e6) * state.embeddingPricePerMillion;
    total += embeddingFee;
  }
  // Billable agent tokens this cost actually covers (for cost-per-million
  // math): PRICED roles only. Unpriced roles are surfaced, never silently
  // averaged into a diluted rate (audit finding).
  const missingRoles = perRole.filter((r) => r.missing).map((r) => `${r.role} (${r.provider}/${r.tier})`);
  const pricedRoles = new Set(perRole.filter((r) => !r.missing).map((r) => r.role));
  const billedTokens = runs * plan.filter((p) => pricedRoles.has(p.role)).reduce((a, p) => a + p.inPerRun + p.outPerRun, 0) + quickBilled;
  return { total, perRole, embeddingFee, billedTokens, missingRoles };
}

/* Same workload priced entirely inside one provider family (role tier mapping
   kept), for the comparison table + cost range. */
export function providerComparison(state, values, rates, providerKeys) {
  const rows = [];
  for (const pk of providerKeys) {
    const saved = {};
    let out;
    try {
      for (const role of ROLE_LIST) { saved[role] = state.roles[role]?.provider; if (state.roles[role]) state.roles[role] = { ...state.roles[role], provider: pk }; }
      out = roleRoutedCost(state, values, rates);
    } finally {
      for (const role of ROLE_LIST) if (state.roles[role]) state.roles[role] = { ...state.roles[role], provider: saved[role] };
    }
    const { total, perRole } = out;
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
  let withoutCache;
  try {
    state.cachedInputPercent = 0;
    withoutCache = roleRoutedCost(state, values, rates).total;
  } finally {
    state.cachedInputPercent = saved;
  }
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
  const pctThresh = Math.min(90, Math.max(0, state.savingsThresholdPercent ?? 40)); // clamped: >100 once produced a negative ceiling
  const threshold = 1 - pctThresh / 100; // 0.60 at default
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
        whyItMatters: `Owned infrastructure must be at least ${pctThresh} percent cheaper than the token route before cost alone can recommend it, because ownership adds operational risk, capacity planning, and lifecycle burden. This rule is visible on purpose.`,
        plainEnglish: 'provider monthly cost times one minus the required savings threshold',
        algebra: 'ceilingMonthly = providerMonthlyCost * (1 - savingsThresholdPercent)',
        substitution: `${money(ceilingMonthly)} = ${money(providerMonthlyCost)} * ${fmt(threshold, 2)}`,
        result: ceilingMonthly, resultUnit: 'USD per month',
        variables: [
          { symbol: 'providerMonthlyCost', label: 'Provider monthly cost (baseline route)', value: providerMonthlyCost },
          { symbol: 'savingsThresholdPercent', label: 'Required savings threshold (clamped to 0-90)', value: pctThresh / 100, editable: true },
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

export function breakEvenTokens(state, values, providerMonthlyCost, billedTokens) {
  // Denominator uses the tokens the cost actually covers (audit finding:
  // dividing by totalMonthlyTokens diluted the rate whenever quick workloads
  // were on, overstating break even and biasing routes against ownership).
  const billedMTok = (billedTokens ?? 0) / 1e6;
  const totalMTok = (values.totalMonthlyTokens ?? 0) / 1e6;
  const weightedCostPerMillion = billedMTok > 0 ? providerMonthlyCost / billedMTok : null;
  const monthlyBudget = state.gpuQuote != null
    ? state.gpuQuote / state.usefulLifeMonths
    : providerMonthlyCost * (1 - Math.min(90, Math.max(0, state.savingsThresholdPercent ?? 40)) / 100);
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
    assumptions: ['Uses your entered quote when present, otherwise the derived ceiling.', 'Break even and current usage are both measured in billed agent tokens so the units match.'],
    sourceIds: [], warnings: [], section: 'economics',
    currentMTok: billedMTok,
    totalMTok,
    monthlyBudget,
    weightedCostPerMillion,
    usageVersusBreakEven: be ? billedMTok / be : null,
  };
}

/* Spec section 32: optimization levers, each with its dollar effect.
   reEval re-runs the engine with a patched state so the whole chain
   (token counts AND prices) reacts, not just the price side. */
export function optimizationLevers(state, values, rates, currentTotal, reEval) {
  const levers = [];
  const baselinePriced = new Set(roleRoutedCost(state, values, rates).perRole.filter((r) => !r.missing).map((r) => r.role));
  const tryLever = (label, patch, note) => {
    const patched = { ...structuredClone(state), ...patch };
    if (patch.roles) patched.roles = { ...structuredClone(state.roles), ...patch.roles };
    const v2 = reEval(patched);
    const { total, perRole } = roleRoutedCost(patched, v2, rates);
    // Phantom-savings guard (audit finding): if the patched run drops a role
    // that WAS priced in the baseline (target tier has no price), the delta
    // is a fabrication, not a saving. Advise instead of lying.
    const dropped = perRole.filter((r) => r.missing && baselinePriced.has(r.role));
    if (dropped.length) {
      levers.push({ label, savings: 0, note: `Needs a price for ${dropped.map((r) => `${r.provider}/${r.tier}`).join(', ')} before the effect can be computed honestly.`, substitution: 'not computed: target tier is unpriced' });
      return;
    }
    const savings = currentTotal - total;
    if (savings > 0.5) levers.push({ label, savings, note, substitution: `${money(savings)} per month = ${money(currentTotal)} now - ${money(total)} after` });
  };
  if ((state.cachedInputPercent ?? 0) < 90) tryLever('Raise prompt cache hits to 90 percent', { cachedInputPercent: 90 }, 'Stable system prompts, tool schemas, and shared context make this realistic for agent workloads.');
  if (state.roles.worker?.tier !== 'mini') tryLever('Route workers to the mini tier', { roles: { worker: { ...state.roles.worker, tier: 'mini' } } }, 'Workers do the bulk calls; judges and planners keep the premium model.');
  if ((state.retryRatePercent ?? 0) > 5) tryLever('Cap the retry rate at 5 percent', { retryRatePercent: 5 }, 'Better tool error handling and stricter loop control.');
  if (state.ragEnabled && state.chunksRetrievedPerQuery > 3) tryLever('Halve retrieved chunks per query', { chunksRetrievedPerQuery: Math.ceil(state.chunksRetrievedPerQuery / 2) }, 'Tighter retrieval usually costs little answer quality.');
  if (state.toolUseEnabled && !state.toolResultSummarization) tryLever('Summarize tool results before reinjecting', { toolResultSummarization: true }, 'Raw tool output is a silent input-token driver.');
  if (state.toolUseEnabled && state.toolsExposed > 4) tryLever('Halve the exposed tool catalog', { toolsExposed: Math.ceil(state.toolsExposed / 2) }, 'Schema overhead taxes every call before any work happens.');
  if ((state.batchEligiblePercent ?? 0) < 80) tryLever('Batch 80 percent of background work', { batchEligiblePercent: 80 }, 'Applies the 50 percent batch discount where offered. Only honest for non-interactive work.');
  levers.sort((a, b) => b.savings - a.savings);
  return levers;
}

/* Primary lever = biggest REAL saving (advisory zero-savings entries never headline). */
export function primaryLeverOf(levers) {
  return levers.find((l) => l.savings > 0) ?? null;
}

/* The decision: tokens vs buying the hardware, with simple finance options.
   Fred's ask 2026-07-03: make the direction unmistakable, show the ROI math,
   and let sliders answer HOW to buy (cash or financed, term, APR). */
export function financeDecision(state, providerMonthlyCost, ceiling) {
  const quote = state.gpuQuote;
  const months = Math.max(1, state.financeTermMonths ?? 36);
  const apr = Math.max(0, state.financeAprPercent ?? 8) / 100;
  const financed = (state.financeMode ?? 'cash') === 'financed';
  if (!providerMonthlyCost) return { verdict: 'none' };
  if (quote == null || quote <= 0) {
    return {
      verdict: 'quote',
      headline: 'GET A QUOTE',
      reason: `Tokens cost ${money(providerMonthlyCost)} per month. Any hardware quote under ${money(ceiling.ceilingCapex)} all-in beats that by your ${Math.min(90, Math.max(0, state.savingsThresholdPercent ?? 40))} percent margin. Bring a number and this becomes a verdict.`,
    };
  }
  // Monthly cost of owning: amortized cash, or standard loan payment.
  const r = apr / 12;
  const payment = financed && r > 0
    ? quote * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1)
    : quote / months;
  const horizon = Math.max(months, state.usefulLifeMonths ?? 36);
  const totalHw = financed ? payment * months : quote;
  const totalTokens = providerMonthlyCost * horizon;
  const savings = totalTokens - totalHw;
  const roiPct = totalHw > 0 ? (savings / totalHw) * 100 : 0;
  const paybackMonths = providerMonthlyCost > payment ? Math.ceil(quote / (providerMonthlyCost - (financed ? 0 : 0)) / 1) : null;
  const simplePayback = providerMonthlyCost > 0 ? Math.ceil(quote / providerMonthlyCost) : null;
  const beatsThreshold = payment <= ceiling.ceilingMonthly;
  const beatsTokens = payment < providerMonthlyCost;
  const verdict = beatsThreshold ? 'buy' : beatsTokens ? 'negotiate' : 'tokens';
  return {
    verdict,
    headline: verdict === 'buy' ? 'BUY THE HARDWARE' : verdict === 'negotiate' ? 'CLOSE, NEGOTIATE' : 'STAY ON TOKENS',
    reason: verdict === 'buy'
      ? `${financed ? 'Financed' : 'Cash-amortized'} at ${money(payment)} per month, ownership beats the ${money(providerMonthlyCost)} token bill by ${fmt((1 - payment / providerMonthlyCost) * 100, 0)} percent, clearing your ${Math.min(90, Math.max(0, state.savingsThresholdPercent ?? 40)) } percent bar.`
      : verdict === 'negotiate'
        ? `At ${money(payment)} per month this quote is cheaper than tokens (${money(providerMonthlyCost)}) but does not clear your required margin (${money(ceiling.ceilingMonthly)} per month). Negotiate the quote down or accept a thinner cushion knowingly.`
        : `At ${money(payment)} per month this quote costs MORE than the token route (${money(providerMonthlyCost)}). Tokens win. Re-quote or revisit at higher volume.`,
    payment, months, apr: apr * 100, financed, quote,
    totalHw, totalTokens, horizon, savings, roiPct, simplePayback,
    substitution: financed && r > 0
      ? `${money(payment)}/mo = ${money(quote)} x (${fmt(r, 4)} x 1.0${''}${''}${''}) loan formula over ${months} months at ${fmt(apr * 100, 1)} percent APR`
      : `${money(payment)}/mo = ${money(quote)} / ${months} months, cash amortization`,
  };
}

export function rentedGpuCost(state, managedCostPerMillion = null) {
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
    assumptions: [
      'Rental pricing is user supplied; TokenOps ships no rental price defaults in this release.',
      ...(managedCostPerMillion ? [`Rented break even: ${fmt(monthly / managedCostPerMillion)} million managed tokens per month (rented monthly cost / managed cost per million, spec 30.2).`] : []),
    ],
    sourceIds: ['lambda_pricing'], warnings: [], section: 'economics',
    validationCost: validation,
    rentedBreakEvenMTok: managedCostPerMillion ? monthly / managedCostPerMillion : null,
  };
}
