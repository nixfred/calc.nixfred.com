/* TokenOps route recommendation engine. Spec section 31 + decisions 0.2.
   Weighted decision, never a hidden if statement: every score returns its
   fired components so the UI can show exactly why a route won or lost. */

import { fmt, money } from './engine.js';

const L = (x) => x ?? 0; // Likert 0-3

function w(rules, route, key, overrides) {
  const def = rules.routes[route]?.weights?.[key] ?? rules.routes[route]?.penalties?.[key];
  if (!def) return 0;
  const ov = overrides?.[`${route}.${key}`];
  return ov !== undefined ? ov : def.default;
}

export function privatePolicyScore(state, rules, overrides) {
  const p = rules.policyPoints;
  const pick = (key) => overrides?.[`policy.${key}`] ?? p[key].default;
  const parts = [];
  if (state.dataCanLeave === 'no') parts.push(['Data cannot leave the environment', pick('dataCannotLeave')]);
  else if (state.dataCanLeave === 'with-controls') parts.push(['Data leaves only with controls', pick('dataWithControls')]);
  if (state.regulatedData) parts.push(['Regulated data present', pick('regulatedData')]);
  if (state.residencyRequired) parts.push(['Data residency required', pick('residencyRequired')]);
  if (state.airGapRequired) parts.push(['Air gap required', pick('airGapRequired')]);
  if (state.auditTrailRequired) parts.push(['Audit trail required', pick('auditTrailRequired')]);
  if (state.dataSensitivity === 'high') parts.push(['High data sensitivity', pick('highSensitivity')]);
  const score = parts.reduce((a, [, v]) => a + v, 0);
  return { score: Math.min(score, 100), parts };
}

function normalized(raw, max) {
  return Math.max(0, Math.min(100, Math.round((raw / max) * 100)));
}

/* Theoretical maximum raw score per route, computed from the live weight
   values (including slider overrides) instead of hardcoded constants, so
   normalization can never go stale (audit finding). Kind table says how each
   weight scales at its best case. */
const WEIGHT_KIND = {
  // routeFlexibility scales by the 0-3 model-routing need in scoring, so its
  // max is 3x too (audit finding: hybrid raw could exceed its own max).
  likert: ['needTimeToValue', 'needQuality', 'needLowOps', 'needGovernance', 'needAgentBuilder', 'needIntegration', 'needModelRouting', 'needAudit', 'needBusinessUserCreation', 'needDataGravity', 'needOntology', 'needInternalApis', 'needEnterpriseRetrieval', 'readinessGap', 'useCaseAmbiguity', 'needVendorSelection', 'integrationComplexity', 'needGovernancePlanning', 'hpePreference', 'nvidiaPreference', 'opsReadiness', 'routeFlexibility'],
  policyFactor: ['privatePolicyFactor'],
  procurement: ['procurementFit'],
};
// Mutually exclusive weight pairs: only the larger can ever fire, so the
// theoretical max counts one of them, not both (audit finding: Kamiwaza).
const EXCLUSIVE_PAIRS = [['privateExecutionHard', 'privateExecutionSoft']];
function routeMax(rules, route, overrides, directMax = 0) {
  let max = 0;
  const entries = Object.entries(rules.routes[route]?.weights ?? {});
  const excluded = new Set();
  for (const [a, b] of EXCLUSIVE_PAIRS) {
    const has = entries.filter(([k]) => k === a || k === b);
    if (has.length === 2) {
      const va = overrides?.[`${route}.${a}`] ?? rules.routes[route].weights[a].default;
      const vb = overrides?.[`${route}.${b}`] ?? rules.routes[route].weights[b].default;
      excluded.add(va >= vb ? b : a);
    }
  }
  for (const [k, def] of entries) {
    if (excluded.has(k)) continue;
    const val = overrides?.[`${route}.${k}`] ?? def.default;
    if (WEIGHT_KIND.likert.includes(k)) max += 3 * val;
    else if (WEIGHT_KIND.policyFactor.includes(k)) max += 100 * val;
    else if (WEIGHT_KIND.procurement.includes(k)) max += 9 * val;
    else if (k === 'directCarryFactor') max += directMax * val;
    else max += val; // boolean bonuses and share-scaled gates cap at 1x weight
  }
  return Math.max(max, 1);
}

/* Returns [{key,label,score,raw,max,components:[{label,points}],penalties:[...]}] */
export function scoreRoutes(state, values, rules, ctx, overrides) {
  const pol = privatePolicyScore(state, rules, overrides);
  const routes = [];
  const directMaxRef = { value: 0 };
  const push = (key, label, comps, pens) => {
    const raw = comps.reduce((a, c) => a + c.points, 0) - pens.reduce((a, c) => a + c.points, 0);
    const max = routeMax(rules, key, overrides, directMaxRef.value);
    if (key === 'direct') directMaxRef.value = max;
    routes.push({ key, label, raw, max, score: normalized(raw, max), components: comps.filter((c) => c.points !== 0 || c.keep), penalties: pens.filter((c) => c.points !== 0), sourceIds: rules.routes[key]?.sourceIds || [] });
  };

  // Direct provider
  {
    const c = [
      { label: 'Time to value need', points: L(state.needTimeToValue) * w(rules, 'direct', 'needTimeToValue', overrides) },
      { label: 'Quality need', points: L(state.needQuality) * w(rules, 'direct', 'needQuality', overrides) },
      { label: 'Low ops need', points: L(state.needLowOps) * w(rules, 'direct', 'needLowOps', overrides) },
      { label: 'Bursty usage', points: state.usagePattern === 'bursty' ? w(rules, 'direct', 'burstyBonus', overrides) : 0 },
    ];
    const p = [
      { label: `Private policy pressure (${pol.score} pts * factor)`, points: pol.score * w(rules, 'direct', 'privatePolicyFactor', overrides) },
      { label: 'Residency requirement', points: state.residencyRequired ? w(rules, 'direct', 'residencyPenalty', overrides) : 0 },
    ];
    push('direct', rules.routes.direct.label, c, p);
  }

  // Carry direct's POSITIVE fit (time to value, quality, low ops, bursty)
  // before direct's own policy penalty, so cloud inherits the fit it genuinely
  // shares and then pays its OWN, lower, policy penalty. Carrying the raw
  // (post-penalty) score would zero cloud's fit exactly when policy bites.
  const directRoute = routes.find((r) => r.key === 'direct');
  const directPositive = directRoute.components.reduce((a, c) => a + Math.max(0, c.points), 0);

  // Cloud model service
  {
    const c = [
      { label: 'Carries direct provider fit (before policy)', points: Math.max(0, directPositive) * w(rules, 'cloud', 'directCarryFactor', overrides) },
      { label: 'Existing cloud preference match', points: state.cloudPreference ? w(rules, 'cloud', 'cloudPreferenceMatch', overrides) : 0 },
      { label: 'Marketplace billing required', points: state.marketplaceBilling ? w(rules, 'cloud', 'marketplaceBilling', overrides) : 0 },
      { label: 'Residency friendlier than direct', points: state.residencyRequired ? w(rules, 'cloud', 'residencyFriendly', overrides) : 0 },
    ];
    const p = [
      { label: `Private policy pressure (${pol.score} pts * ${fmt(w(rules, 'cloud', 'privatePolicyFactor', overrides), 2)} factor, lower than direct because private endpoints and residency regions reduce exposure)`, points: pol.score * w(rules, 'cloud', 'privatePolicyFactor', overrides) },
    ];
    push('cloud', rules.routes.cloud.label, c, p);
  }

  // Airia
  {
    const c = ['needGovernance', 'needAgentBuilder', 'needIntegration', 'needModelRouting', 'needAudit', 'needTimeToValue', 'needBusinessUserCreation']
      .map((k) => ({ label: k.replace('need', '').replace(/([A-Z])/g, ' $1').trim() + ' need', points: L(state[k]) * w(rules, 'airia', k, overrides) }));
    const strict = state.airGapRequired || state.requiresOnPrem;
    const p = [
      { label: strict ? 'Strict private execution required' : 'Data cannot leave', points: strict ? w(rules, 'airia', 'strictPrivateExecution', overrides) : (state.dataCanLeave === 'no' ? w(rules, 'airia', 'softPrivateExecution', overrides) : 0) },
    ];
    push('airia', rules.routes.airia.label, c, p);
  }

  // Kamiwaza
  {
    const c = [
      { label: `Private policy score (${pol.score} pts * factor)`, points: pol.score * w(rules, 'kamiwaza', 'privatePolicyFactor', overrides) },
      { label: 'Data gravity need', points: L(state.needDataGravity) * w(rules, 'kamiwaza', 'needDataGravity', overrides) },
      { label: 'Private execution requirement', points: state.requiresOnPrem ? w(rules, 'kamiwaza', 'privateExecutionHard', overrides) : (state.permitsPrivateCloud ? w(rules, 'kamiwaza', 'privateExecutionSoft', overrides) : 0) },
      { label: 'Ontology need', points: L(state.needOntology) * w(rules, 'kamiwaza', 'needOntology', overrides) },
      { label: 'Internal API need', points: L(state.needInternalApis) * w(rules, 'kamiwaza', 'needInternalApis', overrides) },
      { label: 'Enterprise retrieval need', points: L(state.needEnterpriseRetrieval) * w(rules, 'kamiwaza', 'needEnterpriseRetrieval', overrides) },
    ];
    push('kamiwaza', rules.routes.kamiwaza.label, c, []);
  }

  // BTG
  {
    const c = ['readinessGap', 'useCaseAmbiguity', 'needVendorSelection', 'integrationComplexity', 'needGovernancePlanning']
      .map((k) => ({ label: k.replace('need', '').replace(/([A-Z])/g, ' $1').trim(), points: L(state[k]) * w(rules, 'btg', k, overrides) }));
    push('btg', rules.routes.btg.label, c, []);
  }

  // HPE Private Cloud AI
  {
    const c = [
      { label: `Private policy score (${pol.score} pts * factor)`, points: pol.score * w(rules, 'hpePcai', 'privatePolicyFactor', overrides) },
      { label: 'Governance need', points: L(state.needGovernance) * w(rules, 'hpePcai', 'needGovernance', overrides) },
      { label: 'HPE platform preference', points: L(state.hpePreference) * w(rules, 'hpePcai', 'hpePreference', overrides) },
      { label: 'NVIDIA preference', points: L(state.nvidiaPreference) * w(rules, 'hpePcai', 'nvidiaPreference', overrides) },
      { label: 'Operational readiness', points: L(state.opsReadiness) * w(rules, 'hpePcai', 'opsReadiness', overrides) },
    ];
    push('hpePcai', rules.routes.hpePcai.label, c, []);
  }

  // Rented GPU validation
  {
    // Cost-pressure breakpoints live in route-rules.json now, visible and
    // slidable, instead of hardcoded here. First band whose floor is met wins.
    const bands = rules.routes.rentedGpu?.costPressureBands ?? [{ minMonthly: 50000, factor: 1 }, { minMonthly: 10000, factor: 0.6 }, { minMonthly: 2000, factor: 0.3 }];
    const band = bands.find((b) => ctx.providerMonthlyCost > b.minMonthly);
    const pressure = band?.factor ?? 0;
    const c = [
      { label: `Token cost pressure (${money(ctx.providerMonthlyCost)} per month, ${fmt(pressure * 100)} percent band)`, points: pressure * w(rules, 'rentedGpu', 'tokenCostPressure', overrides) },
      { label: 'No measured benchmark exists', points: state.userBenchmarkTpsPerGpu == null ? w(rules, 'rentedGpu', 'benchmarkNeed', overrides) : 0 },
      { label: 'Usage still estimated', points: state.usageConfidence !== 'measured' ? w(rules, 'rentedGpu', 'usageUncertainty', overrides) : 0 },
      { label: 'Private model candidate', points: pol.score > 40 ? w(rules, 'rentedGpu', 'privateModelCandidate', overrides) : 0 },
    ];
    const p = [
      { label: 'Ops already ready to own', points: L(state.opsReadiness) * w(rules, 'rentedGpu', 'opsReadinessFactor', overrides) },
    ];
    push('rentedGpu', rules.routes.rentedGpu.label, c, p);
  }

  // Owned hardware
  {
    // Cost gate needs a REAL quote. Without one, break even derives from the
    // ceiling, which derives from provider cost, making usage-vs-break-even a
    // constant 1/threshold - a self-referential full score (audit finding).
    const hasQuote = state.gpuQuote != null;
    const useVsBe = hasQuote ? (ctx.usageVersusBreakEven ?? 0) : 0;
    const costGateShare = useVsBe >= 1 ? 1 : Math.max(0, useVsBe);
    const c = [
      { label: hasQuote ? `Cost gate (usage at ${fmt(useVsBe * 100, 0)} percent of quote break even)` : 'Cost gate inert: no hardware quote entered', points: costGateShare * w(rules, 'owned', 'costGate', overrides), keep: !hasQuote },
      { label: `Private policy score (${pol.score} pts * factor)`, points: pol.score * w(rules, 'owned', 'privatePolicyFactor', overrides) },
      { label: 'Steady usage pattern', points: state.usagePattern === 'steady' ? w(rules, 'owned', 'steadyUsage', overrides) : 0 },
      { label: 'Operational readiness', points: L(state.opsReadiness) * w(rules, 'owned', 'opsReadiness', overrides) },
      { label: 'Quality validated by measured benchmark', points: state.userBenchmarkTpsPerGpu != null ? w(rules, 'owned', 'qualityValidated', overrides) : 0 },
      { label: 'Vendor procurement fit', points: (L(state.hpePreference) + L(state.nvidiaPreference) + L(state.amdPreference)) * w(rules, 'owned', 'procurementFit', overrides) },
    ];
    const p = [
      { label: 'Usage is still estimated', points: state.usageConfidence !== 'measured' ? w(rules, 'owned', 'usageUncertaintyPenalty', overrides) : 0 },
    ];
    push('owned', rules.routes.owned.label, c, p);
  }

  // Hybrid
  {
    const activeWorkloads = ['wlRag', 'wlAgents', 'wlCoding', 'wlAgenticCoding', 'wlModernAgent'].filter((k) => state[k]).length;
    // Diversity scales with workload count instead of a cliff at 2, so a
    // second toggled workload does not hand hybrid a large flat bonus
    // (audit finding: hybrid crowded co-recommendations).
    const diversityShare = Math.min(Math.max(activeWorkloads - 1, 0), 3) / 3;
    const c = [
      { label: `Workload diversity (${activeWorkloads} active)`, points: diversityShare * w(rules, 'hybrid', 'workloadDiversity', overrides) },
      { label: 'Escalation to premium model', points: (state.escalationPercent ?? 0) > 0 ? w(rules, 'hybrid', 'escalationNeed', overrides) : 0 },
      { label: 'Model routing need', points: L(state.needModelRouting) * w(rules, 'hybrid', 'needModelRouting', overrides) },
      { label: 'Mixed policy posture', points: state.dataCanLeave === 'with-controls' ? w(rules, 'hybrid', 'policyMixed', overrides) : 0 },
      // routeFlexibility removed: it scaled by needModelRouting, the same 0-3
      // answer the 'Model routing need' component already scores.
    ];
    push('hybrid', rules.routes.hybrid.label, c, []);
  }

  return { routes: routes.sort((a, b) => b.score - a.score), policy: pol };
}

export function checkDoNotSize(state) {
  const missing = [];
  if (!state.dataCanLeave) missing.push('Policy gate: can data leave the customer environment?');
  // Usage is "known" if ANY enabled workload has positive volume drivers,
  // not only the modern-agent path (audit finding: coding-only scenarios
  // false-positived on the users gate).
  const usageKnown = state.usageVolumeKnown !== false && (
    (state.wlModernAgent && state.users > 0)
    || (state.wlRag && state.concurrentConnections > 0)
    || (state.wlAgents && state.workflows > 0)
    || (state.wlCoding && state.developers > 0)
    || (state.wlAgenticCoding && state.acDevelopers > 0)
    || (state.customWorkloadMonthlyTokens ?? 0) > 0
  );
  if (!usageKnown) missing.push('Usage volume: how many users, developers, or workflows, even roughly?');
  if (!state.budgetConfidence || state.budgetConfidence === 'unknown') missing.push('Budget confidence: is there any budget signal?');
  return missing;
}

export function recommend(state, values, rules, ctx, overrides) {
  const missing = checkDoNotSize(state);
  const { routes, policy } = scoreRoutes(state, values, rules, ctx, overrides);
  const margin = overrides?.coRecommendMarginPoints ?? rules.coRecommendMarginPoints.default;
  if (missing.length) {
    return {
      kind: 'do-not-size',
      headline: 'Do not size yet.',
      missing, routes, policy,
      rulesFired: ['A critical gate is unanswered, so any number produced now would be false confidence (settled decision 0.2.8).'],
      nextAction: 'Run the discovery questions below, fill the missing gates, then re-run TokenOps.',
    };
  }
  const [top, second] = routes;
  const tie = second && (top.score - second.score) <= margin;
  // Explain the win by MAGNITUDE, not declaration order, so the named reason
  // is actually the dominant one (audit finding: bursty won but time-to-value
  // was cited).
  const byMag = (arr) => [...arr].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const topSorted = byMag(top.components);
  const rulesFired = [
    ...topSorted.slice(0, 4).map((c) => `${c.label} added ${fmt(c.points, 1)} points to ${top.label}.`),
    ...byMag(top.penalties).map((c) => `${c.label} cost ${top.label} ${fmt(c.points, 1)} points.`),
  ];
  if (tie) {
    const topLead = topSorted.find((c) => c.points > 0);
    const secondLead = byMag(second.components).find((c) => c.points > 0);
    rulesFired.push(`${second.label} landed within ${margin} points, so both routes are viable. ${top.label} leads on ${topLead ? `${topLead.label} (${fmt(topLead.points, 1)} pts)` : 'its top factor'}; ${second.label} leads on ${secondLead ? `${secondLead.label} (${fmt(secondLead.points, 1)} pts)` : 'its top factor'}.`);
  }
  // Spec 37 critical warning: leading route conflicts with the policy gate.
  // Also fires when the forbidden public route is the co-recommended SECOND,
  // so a policy-forbidden route can never print without the conflict stated.
  const warnings = [];
  const forbiddenPublic = (r) => r && ['direct', 'cloud'].includes(r.key) && state.dataCanLeave === 'no';
  const offenders = [top, tie ? second : null].filter(forbiddenPublic);
  if (offenders.length) {
    const which = offenders.map((r) => r.label).join(' and ');
    warnings.push({ severity: 'critical', message: `${which} send data to a public provider, but the policy gate says data cannot leave the customer environment. Treat private or hybrid routes as the real candidates.` });
    rulesFired.push('Policy conflict: a recommended route allows data to leave; the gate forbids it.');
  }
  // Spec 31.10.7: missing data shown on every recommendation, not only do-not-size.
  const missingData = [];
  if (state.gpuQuote == null) missingData.push('No hardware quote entered, so the owned-hardware cost gate is inert.');
  if (state.userBenchmarkTpsPerGpu == null) missingData.push('No measured benchmark; throughput sizing uses a labeled estimate.');
  if (state.usageConfidence !== 'measured') missingData.push('Usage is estimated, not measured from telemetry.');
  if (!state.industry) missingData.push('Industry not set; report language stays generic.');
  return {
    kind: tie ? 'co-recommend' : 'single',
    headline: tie ? `Two viable routes: ${top.label} and ${second.label}.` : `Recommended route: ${top.label}.`,
    top, second: tie ? second : null,
    alternates: routes.slice(tie ? 2 : 1, 4),
    rejected: routes.slice(4),
    routes, policy, rulesFired, warnings, missingData,
    nextAction: state.usageConfidence !== 'measured'
      ? 'Run a 30 to 60 day telemetry pilot, capture real traces, then re-run TokenOps with measured usage.'
      : 'Validate the leading route with a scoped pilot and hold any hardware quote against the budget ceiling.',
  };
}

/* Spec section 38: confidence model. */
export function confidence(state, values, ratesInUse = []) {
  const map = { measured: 3, high: 3, medium: 2, estimated: 1.5, low: 1, unknown: 1 };
  // Only rates actually assigned to active roles count; the shipped custom
  // placeholder rows must not permanently cap pricing confidence (audit).
  const usedPairs = new Set(Object.values(state.roles ?? {}).map((r) => `${r.provider}/${r.tier}`));
  const anyUserRates = ratesInUse.some((r) => r.userSupplied && usedPairs.has(`${r.providerKey}/${r.tier}`));
  const inputs = [
    ['Usage', state.usageConfidence],
    ['Token estimate', state.tokenEstimateConfidence],
    ['Provider pricing', anyUserRates ? 'medium' : 'high'],
    ['Hardware quote', state.gpuQuote != null ? 'high' : 'low'],
    ['Benchmark', state.userBenchmarkTpsPerGpu != null ? 'high' : 'low'],
    ['Policy', state.dataCanLeave ? 'high' : 'low'],
    ['Model quality', state.modelQualityConfidence],
    ['Operational readiness', state.opsReadinessConfidence],
  ];
  const scores = inputs.map(([label, lvl]) => ({ label, level: lvl, value: map[lvl] ?? 2 }));
  const avg = scores.reduce((a, s) => a + s.value, 0) / scores.length;
  const band = avg >= 2.5 ? 'High' : avg >= 1.8 ? 'Medium' : 'Low';
  return {
    band, avg,
    reasons: scores.filter((s) => s.value < 2.5).map((s) => `${s.label} confidence is ${s.level}.`),
    scores,
    algebra: 'overallConfidence = average(usage, tokenEstimate, providerPricing, hardwareQuote, benchmark, policy, modelQuality, operationalReadiness)',
    substitution: `${fmt(avg, 2)} = average(${scores.map((s) => fmt(s.value, 1)).join(', ')})`,
  };
}

/* Spec section 33.9: discovery questions from missing or high-impact fields. */
export function discoveryQuestions(state) {
  const q = [];
  if (!state.dataCanLeave || state.dataCanLeave === 'with-controls') q.push('Can prompts and retrieved data leave the customer environment, and under what controls?');
  if (state.usageConfidence !== 'measured') q.push('What is the expected number of daily users in the first 90 days?');
  q.push('What is the peak usage window?');
  if (state.toolUseEnabled || state.needIntegration >= 2) { q.push('Which systems will the agent read from?'); q.push('Which systems will the agent write to?'); }
  q.push('What happens if the agent is wrong?');
  if (!state.humanApprovalRequired) q.push('Is human approval required before writes?');
  if (!state.auditTrailRequired) q.push('Does the customer require audit logs?');
  q.push('Does the customer prefer Azure, AWS, HPE, Nutanix, Dell, Lenovo, or another platform?');
  if (!state.budgetConfidence || state.budgetConfidence === 'unknown' || state.budgetConfidence === 'low') q.push('Is there a target monthly budget?');
  return q.slice(0, 10);
}
