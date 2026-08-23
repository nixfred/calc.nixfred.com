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
  // Cache WRITES are billed too (Anthropic 5-minute writes at 1.25x input).
  // Default share 0 leaves every number unchanged; set it to price the writes
  // your workload actually makes when it populates the cache.
  const cacheWriteShare = Math.min(100, Math.max(0, state.cacheWriteSharePercent ?? 0)) / 100;
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
    const cacheWriteM = inTokM * cacheWriteShare;
    const cachedPrice = rate.cachedInputPerMillion ?? rate.inputPerMillion;
    const cacheWritePrice = rate.cacheWritePerMillion ?? 0;
    const cacheWriteCost = cacheWriteM * cacheWritePrice;
    let cost = uncachedM * rate.inputPerMillion + cachedM * cachedPrice + cacheWriteCost + outTokM * rate.outputPerMillion;
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
      substitution: `${money(cost)} = ${batchSavings || uplift ? '(' : ''}(${fmt(uncachedM)} MTok * ${money(rate.inputPerMillion, 2)}) + (${fmt(cachedM)} MTok * ${money(cachedPrice, 2)})${cacheWriteCost ? ` + (${fmt(cacheWriteM)} MTok cache writes * ${money(cacheWritePrice, 2)})` : ''} + (${fmt(outTokM)} MTok * ${money(rate.outputPerMillion, 2)})${batchSavings ? ` - ${money(batchSavings)} batch discount` : ''}${batchSavings || uplift ? ')' : ''}${uplift ? ` * ${fmt(1 + uplift, 2)} regional uplift` : ''}`,
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

/* One ownership payment used everywhere (break even AND the finance card),
   so the two cards can never disagree. Cash amortizes over the useful life
   (the same window the ceiling uses); financed is the standard loan payment
   over the finance term. Returns null with no quote. */
export function ownershipMonthly(state) {
  const quote = state.gpuQuote;
  if (quote == null || quote <= 0) return null;
  const financed = (state.financeMode ?? 'cash') === 'financed';
  const months = financed ? Math.max(1, state.financeTermMonths ?? 36) : Math.max(1, state.usefulLifeMonths ?? 36);
  const apr = Math.max(0, state.financeAprPercent ?? 8) / 100;
  const r = apr / 12;
  if (financed && r > 0) return quote * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
  return quote / months;
}

export function hardwareCeiling(state, providerMonthlyCost) {
  const pctThresh = Math.min(90, Math.max(0, state.savingsThresholdPercent ?? 40)); // clamped: >100 once produced a negative ceiling
  const threshold = 1 - pctThresh / 100; // 0.60 at default
  // Servable share: the fraction of the workload the owned model can serve at
  // acceptable quality. The ceiling only covers what you route to owned
  // hardware; the rest stays on tokens. Default 100 keeps behavior unchanged
  // and the line still renders so the parity assumption is never invisible.
  const servable = Math.min(100, Math.max(0, state.servableSharePercent ?? 100)) / 100;
  const ceilingMonthly = providerMonthlyCost * servable * threshold;
  const ceilingCapex = ceilingMonthly * state.usefulLifeMonths;
  const hybridTokenRemainder = providerMonthlyCost * (1 - servable);
  const quote = state.gpuQuote;
  // A "$1 quote" is not a quote. Below 2 percent of the ceiling (or $1,000,
  // whichever is larger) the verdict refuses to pretend (Fred's catch).
  const plausibleFloor = Math.max(1000, ceilingCapex * 0.02);
  const verdict = quote == null ? null : (quote > 0 && quote < plausibleFloor ? {
    implausible: true, floor: plausibleFloor,
  } : {
    under: quote <= ceilingCapex,
    delta: Math.abs(ceilingCapex - quote),
    monthlyEquivalent: quote / state.usefulLifeMonths,
  });
  return {
    ceilingMonthly, ceilingCapex, verdict,
    traces: [
      {
        id: 'hardwareCeilingMonthly',
        title: 'Hardware budget ceiling (monthly)',
        shortAnswer: `Owned hardware must beat ${money(ceilingMonthly)} per month to make sense.`,
        whyItMatters: `Owned infrastructure must be at least ${pctThresh} percent cheaper than the token route before cost alone can recommend it, because ownership adds operational risk, capacity planning, and lifecycle burden. This rule is visible on purpose.`,
        plainEnglish: 'provider monthly cost times the servable share times one minus the required savings threshold',
        algebra: 'ceilingMonthly = providerMonthlyCost * servableShare * (1 - savingsThresholdPercent)',
        substitution: `${money(ceilingMonthly)} = ${money(providerMonthlyCost)} * ${fmt(servable, 2)} * ${fmt(threshold, 2)}`,
        result: ceilingMonthly, resultUnit: 'USD per month',
        variables: [
          { symbol: 'providerMonthlyCost', label: 'Provider monthly cost (baseline route)', value: providerMonthlyCost },
          { symbol: 'servableShare', label: 'Servable share (owned model at acceptable quality)', value: servable, editable: true },
          { symbol: 'savingsThresholdPercent', label: 'Required savings threshold (clamped to 0-90)', value: pctThresh / 100, editable: true },
        ],
        assumptions: [
          'TokenOps never prices hardware. It tells you what the hardware has to cost. Hold real quotes against this ceiling.',
          servable < 1
            ? `The ceiling only covers the ${fmt(servable * 100)} percent of this workload you route to owned hardware. The other ${fmt((1 - servable) * 100)} percent stays on tokens at about ${money(hybridTokenRemainder)} per month, a hybrid total.`
            : 'Servable share is 100 percent: this assumes the owned model can serve the whole workload at acceptable quality. Lower it if the frontier-priced work needs a frontier model.',
        ],
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
  // Same ownership payment the finance card shows, so the two cards agree.
  // No quote yet: the budget is the derived ceiling (provider bill minus margin).
  const monthlyBudget = ownershipMonthly(state)
    ?? providerMonthlyCost * (1 - Math.min(90, Math.max(0, state.savingsThresholdPercent ?? 40)) / 100);
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
      { symbol: 'monthlyHardwareBudget', label: state.gpuQuote != null ? 'Your quote amortized monthly (same as the finance card)' : 'Budget bar: provider bill minus your margin (no quote yet)', value: monthlyBudget },
      { symbol: 'managedWeightedCostPerMillion', label: 'Managed cost per million tokens', value: weightedCostPerMillion },
    ],
    assumptions: [
      state.gpuQuote != null
        ? 'Monthly budget is the same ownership payment shown on the finance card (quote, APR, term there).'
        : 'No quote yet, so the budget bar is your current provider bill minus the required savings margin, not a hardware quote. Enter a real quote to anchor it.',
      'Break even and current usage are both measured in billed agent tokens so the units match.',
    ],
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
  // Cap the cache target: with RAG or tool use on, per-call retrieved and tool
  // tokens cannot be prefix cached, so 90 percent is not reachable. Aim for the
  // stable-prefix share instead of pretending the whole input caches.
  const cacheCeil = (state.ragEnabled || state.toolUseEnabled) ? 60 : 90;
  if ((state.cachedInputPercent ?? 0) < cacheCeil) tryLever(`Raise prompt cache hits to ${cacheCeil} percent`, { cachedInputPercent: cacheCeil }, cacheCeil < 90 ? 'Capped below 90 because RAG or tool tokens change per call and cannot be prefix cached; only the stable system prompt and schemas cache.' : 'Stable system prompts, tool schemas, and shared context make this realistic for agent workloads.');
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
export function financeDecision(state, providerMonthlyCost, ceiling, topRouteKey = null) {
  const quote = state.gpuQuote;
  const months = Math.max(1, state.financeTermMonths ?? 36);
  const apr = Math.max(0, state.financeAprPercent ?? 8) / 100;
  const financed = (state.financeMode ?? 'cash') === 'financed';
  const routeIsManaged = topRouteKey === 'direct' || topRouteKey === 'cloud';
  if (!providerMonthlyCost) return { verdict: 'none' };
  if (quote == null || quote <= 0) {
    // Do not shout GET A QUOTE when the recommended route is a managed service;
    // that contradicts the card two above it. Frame it as the cost-only layer.
    if (routeIsManaged) {
      return {
        verdict: 'quote',
        headline: 'TOKENS ARE THE ROUTE TODAY',
        reason: `Tokens cost ${money(providerMonthlyCost)} per month and the recommended route is a managed service. If the Customer still wants ownership on the table, any all-in quote under ${money(ceiling.ceilingCapex)} beats tokens by your ${Math.min(90, Math.max(0, state.savingsThresholdPercent ?? 40))} percent margin.`,
      };
    }
    return {
      verdict: 'quote',
      headline: 'GET A QUOTE',
      reason: `Tokens cost ${money(providerMonthlyCost)} per month. Any hardware quote under ${money(ceiling.ceilingCapex)} all-in beats that by your ${Math.min(90, Math.max(0, state.savingsThresholdPercent ?? 40))} percent margin. Bring a number and this becomes a verdict.`,
    };
  }
  if (ceiling.verdict?.implausible) {
    return {
      verdict: 'quote',
      headline: 'THAT IS NOT A QUOTE',
      reason: `${money(quote)} is not a believable all-in hardware number for this workload. Enter the real quote; the math only earns trust when the inputs do.`,
    };
  }
  // One ownership payment, shared with the break even card. Cash amortizes
  // over the useful life; financed is the standard loan payment.
  const r = apr / 12;
  const pow = Math.pow(1 + r, months);
  const payment = ownershipMonthly(state);
  const horizon = Math.max(months, state.usefulLifeMonths ?? 36);
  const totalHw = financed ? payment * months : quote;
  const totalTokens = providerMonthlyCost * horizon;
  const savings = totalTokens - totalHw;
  const roiPct = totalHw > 0 ? (savings / totalHw) * 100 : 0;
  const simplePayback = providerMonthlyCost > 0 ? Math.ceil(quote / providerMonthlyCost) : null;
  // The verdict is the TOTAL over the useful life against the capex ceiling,
  // not the monthly payment against the monthly ceiling. A short-term loan on
  // cheap hardware can fail a monthly test while winning on total dollars.
  const beatsThreshold = totalHw <= ceiling.ceilingCapex;
  const beatsTokens = totalHw < totalTokens;
  const verdict = beatsThreshold ? 'buy' : beatsTokens ? 'negotiate' : 'tokens';
  const pct = Math.min(90, Math.max(0, state.savingsThresholdPercent ?? 40));
  return {
    verdict,
    headline: verdict === 'buy' ? 'BUY THE HARDWARE' : verdict === 'negotiate' ? 'CLOSE, NEGOTIATE' : 'STAY ON TOKENS',
    reason: verdict === 'buy'
      ? `Over the ${horizon} month useful life, ownership totals ${money(totalHw)} against a ${money(ceiling.ceilingCapex)} ceiling, clearing your ${pct} percent bar. ${financed ? 'Financed' : 'Cash'} that is ${money(payment)} per month, which is the cash flow, not the verdict.`
      : verdict === 'negotiate'
        ? `Ownership totals ${money(totalHw)} over ${horizon} months, under the ${money(totalTokens)} token bill but over your ${money(ceiling.ceilingCapex)} margin ceiling. At ${money(payment)} per month it beats tokens but not by your required cushion. Negotiate the quote down or accept a thinner margin knowingly.`
        : `Ownership totals ${money(totalHw)} over ${horizon} months against ${money(totalTokens)} on tokens. Tokens win. Re-quote or revisit at higher volume.`,
    // When cost favors buying but the route recommendation is managed, name why
    // the two layers differ instead of leaving a bare contradiction.
    routeNote: verdict === 'buy' && routeIsManaged
      ? 'Cost alone favors ownership; the route recommendation above also weighs policy, operations, and time to value, which is why it may differ.'
      : null,
    payment, months, apr: apr * 100, financed, quote,
    totalHw, totalTokens, horizon, savings, roiPct, simplePayback,
    substitution: financed && r > 0
      ? `${money(payment)}/mo = ${money(quote)} x [${fmt(r, 4)} x ${fmt(pow, 4)}] / [${fmt(pow, 4)} - 1], standard loan payment over ${months} months at ${fmt(apr * 100, 1)} percent APR`
      : `${money(payment)}/mo = ${money(quote)} / ${months} months, cash amortized over the useful life`,
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
