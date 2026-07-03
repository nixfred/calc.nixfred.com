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

/* Returns [{key,label,score,raw,max,components:[{label,points}],penalties:[...]}] */
export function scoreRoutes(state, values, rules, ctx, overrides) {
  const pol = privatePolicyScore(state, rules, overrides);
  const routes = [];
  const push = (key, label, comps, pens, max, sourceIds) => {
    const raw = comps.reduce((a, c) => a + c.points, 0) - pens.reduce((a, c) => a + c.points, 0);
    routes.push({ key, label, raw, max, score: normalized(raw, max), components: comps.filter((c) => c.points !== 0), penalties: pens.filter((c) => c.points !== 0), sourceIds: sourceIds || rules.routes[key]?.sourceIds || [] });
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
    push('direct', rules.routes.direct.label, c, p, 105);
  }

  const directScore = routes[0].raw;

  // Cloud model service
  {
    const c = [
      { label: 'Carries direct provider fit', points: Math.max(0, directScore) * w(rules, 'cloud', 'directCarryFactor', overrides) },
      { label: 'Existing cloud preference match', points: state.cloudPreference ? w(rules, 'cloud', 'cloudPreferenceMatch', overrides) : 0 },
      { label: 'Marketplace billing required', points: state.marketplaceBilling ? w(rules, 'cloud', 'marketplaceBilling', overrides) : 0 },
      { label: 'Residency friendlier than direct', points: state.residencyRequired ? w(rules, 'cloud', 'residencyFriendly', overrides) : 0 },
    ];
    push('cloud', rules.routes.cloud.label, c, [], 124);
  }

  // Airia
  {
    const c = ['needGovernance', 'needAgentBuilder', 'needIntegration', 'needModelRouting', 'needAudit', 'needTimeToValue', 'needBusinessUserCreation']
      .map((k) => ({ label: k.replace('need', '').replace(/([A-Z])/g, ' $1').trim() + ' need', points: L(state[k]) * w(rules, 'airia', k, overrides) }));
    const strict = state.airGapRequired || state.requiresOnPrem;
    const p = [
      { label: strict ? 'Strict private execution required' : 'Data cannot leave', points: strict ? w(rules, 'airia', 'strictPrivateExecution', overrides) : (state.dataCanLeave === 'no' ? w(rules, 'airia', 'softPrivateExecution', overrides) : 0) },
    ];
    push('airia', rules.routes.airia.label, c, p, 141);
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
    push('kamiwaza', rules.routes.kamiwaza.label, c, [], 146);
  }

  // BTG
  {
    const c = ['readinessGap', 'useCaseAmbiguity', 'needVendorSelection', 'integrationComplexity', 'needGovernancePlanning']
      .map((k) => ({ label: k.replace('need', '').replace(/([A-Z])/g, ' $1').trim(), points: L(state[k]) * w(rules, 'btg', k, overrides) }));
    push('btg', rules.routes.btg.label, c, [], 126);
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
    push('hpePcai', rules.routes.hpePcai.label, c, [], 142);
  }

  // Rented GPU validation
  {
    const pressure = ctx.providerMonthlyCost > 50000 ? 1 : ctx.providerMonthlyCost > 10000 ? 0.6 : ctx.providerMonthlyCost > 2000 ? 0.3 : 0;
    const c = [
      { label: `Token cost pressure (${money(ctx.providerMonthlyCost)} per month)`, points: pressure * w(rules, 'rentedGpu', 'tokenCostPressure', overrides) },
      { label: 'No measured benchmark exists', points: state.userBenchmarkTpsPerGpu == null ? w(rules, 'rentedGpu', 'benchmarkNeed', overrides) : 0 },
      { label: 'Usage still estimated', points: state.usageConfidence !== 'measured' ? w(rules, 'rentedGpu', 'usageUncertainty', overrides) : 0 },
      { label: 'Private model candidate', points: pol.score > 40 ? w(rules, 'rentedGpu', 'privateModelCandidate', overrides) : 0 },
    ];
    const p = [
      { label: 'Ops already ready to own', points: L(state.opsReadiness) * w(rules, 'rentedGpu', 'opsReadinessFactor', overrides) },
    ];
    push('rentedGpu', rules.routes.rentedGpu.label, c, p, 75);
  }

  // Owned hardware
  {
    const useVsBe = ctx.usageVersusBreakEven ?? 0;
    const costGateShare = useVsBe >= 1 ? 1 : Math.max(0, useVsBe);
    const c = [
      { label: `Cost gate (usage at ${fmt(useVsBe * 100, 0)} percent of break even)`, points: costGateShare * w(rules, 'owned', 'costGate', overrides) },
      { label: `Private policy score (${pol.score} pts * factor)`, points: pol.score * w(rules, 'owned', 'privatePolicyFactor', overrides) },
      { label: 'Steady usage pattern', points: state.usagePattern === 'steady' ? w(rules, 'owned', 'steadyUsage', overrides) : 0 },
      { label: 'Operational readiness', points: L(state.opsReadiness) * w(rules, 'owned', 'opsReadiness', overrides) },
      { label: 'Quality validated by measured benchmark', points: state.userBenchmarkTpsPerGpu != null ? w(rules, 'owned', 'qualityValidated', overrides) : 0 },
      { label: 'Vendor procurement fit', points: (L(state.hpePreference) + L(state.nvidiaPreference) + L(state.amdPreference)) * w(rules, 'owned', 'procurementFit', overrides) },
    ];
    const p = [
      { label: 'Usage is still estimated', points: state.usageConfidence !== 'measured' ? w(rules, 'owned', 'usageUncertaintyPenalty', overrides) : 0 },
    ];
    push('owned', rules.routes.owned.label, c, p, 133);
  }

  // Hybrid
  {
    const activeWorkloads = ['wlRag', 'wlAgents', 'wlCoding', 'wlAgenticCoding', 'wlModernAgent'].filter((k) => state[k]).length;
    const c = [
      { label: `Workload diversity (${activeWorkloads} active)`, points: activeWorkloads >= 2 ? w(rules, 'hybrid', 'workloadDiversity', overrides) : 0 },
      { label: 'Escalation to premium model', points: (state.escalationPercent ?? 0) > 0 ? w(rules, 'hybrid', 'escalationNeed', overrides) : 0 },
      { label: 'Model routing need', points: L(state.needModelRouting) * w(rules, 'hybrid', 'needModelRouting', overrides) },
      { label: 'Mixed policy posture', points: state.dataCanLeave === 'with-controls' ? w(rules, 'hybrid', 'policyMixed', overrides) : 0 },
      { label: 'Route flexibility need', points: L(state.needModelRouting) * w(rules, 'hybrid', 'routeFlexibility', overrides) },
    ];
    push('hybrid', rules.routes.hybrid.label, c, [], 75);
  }

  return { routes: routes.sort((a, b) => b.score - a.score), policy: pol };
}

export function checkDoNotSize(state) {
  const missing = [];
  if (!state.dataCanLeave) missing.push('Policy gate: can data leave the customer environment?');
  if (state.usageVolumeKnown === false || !state.users) missing.push('Usage volume: how many users and runs per day, even roughly?');
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
  const rulesFired = [
    ...top.components.slice(0, 4).map((c) => `${c.label} added ${fmt(c.points, 1)} points to ${top.label}.`),
    ...top.penalties.map((c) => `${c.label} cost ${top.label} ${fmt(c.points, 1)} points.`),
  ];
  if (tie) rulesFired.push(`${second.label} landed within ${margin} points, so both routes are viable and the tradeoff is stated instead of hidden.`);
  return {
    kind: tie ? 'co-recommend' : 'single',
    headline: tie ? `Two viable routes: ${top.label} and ${second.label}.` : `Recommended route: ${top.label}.`,
    top, second: tie ? second : null,
    alternates: routes.slice(tie ? 2 : 1, 4),
    rejected: routes.slice(4),
    routes, policy, rulesFired,
    nextAction: state.usageConfidence !== 'measured'
      ? 'Run a 30 to 60 day telemetry pilot, capture real traces, then re-run TokenOps with measured usage.'
      : 'Validate the leading route with a scoped pilot and hold any hardware quote against the budget ceiling.',
  };
}

/* Spec section 38: confidence model. */
export function confidence(state, values) {
  const map = { measured: 3, high: 3, medium: 2, estimated: 1.5, low: 1, unknown: 1 };
  const inputs = [
    ['Usage', state.usageConfidence],
    ['Token estimate', state.tokenEstimateConfidence],
    ['Provider pricing', 'high'],
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
