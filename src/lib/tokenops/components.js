/* TokenOps render components. Pure functions returning HTML strings.
   FormulaTrace blocks render ALWAYS EXPANDED (decision 0.5.20). */

import { fmt, money } from './engine.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sourceLinkPills(sourceIds, sources) {
  if (!sourceIds?.length) return '';
  const pills = sourceIds.map((id) => {
    const s = sources.find((x) => x.id === id);
    if (!s) return '';
    const stale = s.lastReviewed && (Date.now() - new Date(s.lastReviewed).getTime()) > 60 * 86400000;
    return `<a class="src-pill${stale ? ' stale' : ''}" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}${s.lastReviewed ? ` &middot; reviewed ${esc(s.lastReviewed)}` : ''}${stale ? ' &middot; STALE' : ''}</a>`;
  }).join('');
  return `<div class="src-pills">${pills}</div>`;
}

export function warningsHtml(warnings) {
  if (!warnings?.length) return '';
  return warnings.map((w) => `<p class="warn warn-${esc(w.severity)}"><span class="warn-tag">${esc(w.severity)}</span> ${esc(w.message)}</p>`).join('');
}

/* The FormulaTrace component. Spec section 10: all fields on screen. */
export function formulaTrace(t, sources) {
  if (!t) return '';
  const vars = t.variables.map((v) =>
    `<tr><td class="mono">${esc(v.symbol)}</td><td>${esc(v.label)}</td><td class="mono num">${typeof v.value === 'number' ? fmt(v.value) : esc(v.value ?? 'unknown')}${v.unit ? ' ' + esc(v.unit) : ''}</td><td class="dim">${esc(v.source)}${v.editable && !String(v.source).includes('editable') ? ' &middot; editable' : ''}</td></tr>`
  ).join('');
  return `
  <div class="ftrace" data-trace="${esc(t.id)}" data-expanded="true" role="group" aria-label="${esc(t.title)} formula">
    <div class="ft-head">
      <span class="ft-result mono">${typeof t.result === 'number' ? fmt(t.result) : 'unknown'}${t.resultUnit ? ` <span class="dim">${esc(t.resultUnit)}</span>` : ''}</span>
      <span class="ft-title">${esc(t.title)}</span>
      <span class="ft-actions">
        <button class="copy-btn" data-copy="${esc(String(t.algebra))}">copy formula</button>
        <button class="copy-btn" data-copy="${esc(`${fmt(t.result)} ${t.resultUnit}`)}">copy result</button>
        <button class="copy-btn" data-copy="${esc(`### ${t.title}\n${t.shortAnswer}\n1. Algebra: ${t.algebra}\n2. Substitution: ${t.substitution}\n3. Result: ${fmt(t.result)} ${t.resultUnit}`)}">copy markdown</button>
      </span>
    </div>
    <p class="ft-answer">${esc(t.shortAnswer)}</p>
    <p class="ft-why"><span class="k">why it matters</span> ${esc(t.whyItMatters)}</p>
    <p class="ft-plain"><span class="k">plain english</span> ${esc(t.plainEnglish)}</p>
    <p class="ft-algebra mono"><span class="k">algebra</span> ${esc(t.algebra)}</p>
    <p class="ft-sub mono"><span class="k">substitution</span> ${esc(t.substitution)}</p>
    ${vars ? `<table class="ft-vars"><thead><tr><th>symbol</th><th>variable</th><th>value</th><th>source</th></tr></thead><tbody>${vars}</tbody></table>` : ''}
    ${t.assumptions?.length ? `<div class="ft-assume"><span class="k">assumptions</span><ol>${t.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ol></div>` : ''}
    ${warningsHtml(t.warnings)}
    ${sourceLinkPills(t.sourceIds, sources)}
  </div>`;
}

export function summaryBar(data) {
  const cell = (label, value) => `<div class="sum-cell"><span class="sum-label">${esc(label)}</span><span class="sum-value mono">${value}</span></div>`;
  return [
    cell('monthly tokens', data.totalTokens != null ? fmt(data.totalTokens) : 'pending'),
    cell('provider cost range', data.costMin != null ? `${money(data.costMin)} to ${money(data.costMax)}` : 'pending'),
    cell('leading route', esc(data.leadingRoute ?? 'pending')),
    cell('hw ceiling', data.ceiling != null ? money(data.ceiling) : 'pending'),
  ].join('');
}

export function recommendationCard(rec, conf, sources = []) {
  if (rec.kind === 'do-not-size') {
    return `<div class="card rec-card do-not-size">
      <h3 class="card-title">Recommendation</h3>
      <p class="rec-headline">Do not size yet.</p>
      <p>A number produced now would be false confidence. Missing before sizing:</p>
      <ol>${rec.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ol>
      <p class="rec-next"><span class="k">next action</span> ${esc(rec.nextAction)}</p>
    </div>`;
  }
  const scoreRow = (r, cls = '') => `
    <div class="route-row ${cls}">
      <span class="route-name">${esc(r.label)}</span>
      <span class="route-bar"><span class="route-fill" style="width:${r.score}%"></span></span>
      <span class="route-score mono">${r.score}</span>
    </div>`;
  return `<div class="card rec-card">
    <h3 class="card-title">Recommendation</h3>
    <p class="rec-headline">${esc(rec.headline)}</p>
    ${rec.second ? `<p class="rec-tie">Within the co-recommend margin. The tradeoff, stated: ${esc(rec.top.label)} leads on ${esc(rec.top.components[0]?.label ?? 'fit')}; ${esc(rec.second.label)} leads on ${esc(rec.second.components[0]?.label ?? 'fit')}.</p>` : ''}
    <div class="route-grid">${rec.routes.map((r, i) => scoreRow(r, i === 0 ? 'top' : (rec.second && r.key === rec.second.key ? 'tie' : ''))).join('')}</div>
    <div class="route-sources"><span class="k">route sources</span>${sourceLinkPills([...new Set(rec.routes.flatMap((r) => r.sourceIds))], sources)}</div>
    ${warningsHtml(rec.warnings)}
    <div class="rec-rules"><span class="k">rules that fired</span><ol>${rec.rulesFired.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
    ${rec.missingData?.length ? `<div class="rec-rules"><span class="k">missing data</span><ol>${rec.missingData.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}
    ${rec.primaryRisk ? `<p class="rec-next"><span class="k">primary risk</span> ${esc(rec.primaryRisk)}</p>` : ''}
    ${rec.primaryLever ? `<p class="rec-next"><span class="k">primary optimization lever</span> ${esc(rec.primaryLever)}</p>` : ''}
    <p class="rec-conf"><span class="k">confidence</span> ${esc(conf.band)} <span class="mono dim">(${fmt(conf.avg, 2)}/3)</span>${conf.reasons.length ? ` &middot; ${esc(conf.reasons.join(' '))}` : ''}</p>
    <p class="rec-conf-sub mono dim">${esc(conf.substitution)}</p>
    <p class="rec-next"><span class="k">next action</span> ${esc(rec.nextAction)}</p>
  </div>`;
}

export function optimizationCard(levers) {
  if (!levers?.length) return '';
  return `<div class="card">
    <h3 class="card-title">Optimization levers</h3>
    <p class="dim">Each lever recomputes the whole model with the change applied. Dollar effects, not vibes.</p>
    <ol>${levers.map((l) => `<li><b>${esc(l.label)}</b>: saves <span class="mono">${money(l.savings)}</span> per month. <span class="dim">${esc(l.note)}</span><br><span class="mono dim">${esc(l.substitution)}</span></li>`).join('')}</ol>
  </div>`;
}

export function fabricRulesCard(gpuCount, sources) {
  const rules = [
    { id: 1, when: gpuCount <= 1, text: 'Single server, single GPU: host networking plus a management network. No backend fabric needed.' },
    { id: 2, when: gpuCount >= 2 && gpuCount <= 8, text: 'Two to eight GPUs in one dense server: intra-server interconnect carries the load; plan 100 to 400 GbE for data-path and storage traffic depending on platform and benchmark need.' },
    { id: 3, when: gpuCount > 8, text: 'More than eight GPUs means multiple servers and distributed inference: high speed backend fabric planning is REQUIRED, not optional.' },
    { id: 4, when: false, text: 'Multi node training or fine tuning: formal fabric design with the platform vendor.' },
  ];
  return `<div class="card">
    <h3 class="card-title">Backend fabric rules</h3>
    <p class="dim">Token throughput alone does not size the backend fabric. Rule-based guidance, confidence: field rule of thumb.</p>
    <ol>${rules.map((r) => `<li class="${r.when ? 'fabric-fired' : 'dim'}">${r.when ? '&#9656; ' : ''}${esc(r.text)}${r.when ? ' <span class="mono">(this rule fired)</span>' : ''}</li>`).join('')}</ol>
    ${sourceLinkPills(['field_heuristic', 'vllm_optimization'], sources)}
  </div>`;
}

export function policyScoreTrace(pol, sources) {
  return `<div class="ftrace" data-trace="privatePolicyScore" data-expanded="true">
    <div class="ft-head"><span class="ft-result mono">${fmt(pol.score)} <span class="dim">points</span></span><span class="ft-title">Private policy score</span></div>
    <p class="ft-answer">A higher private policy score pushes the recommendation toward private execution routes.</p>
    <p class="ft-algebra mono"><span class="k">algebra</span> privatePolicyScore = ${pol.parts.length ? pol.parts.map((p) => p[1]).join(' + ') : '0'} = ${fmt(pol.score)}</p>
    ${pol.parts.length ? `<table class="ft-vars"><thead><tr><th>condition</th><th>points</th></tr></thead><tbody>${pol.parts.map((p) => `<tr><td>${esc(p[0])}</td><td class="mono num">${p[1]}</td></tr>`).join('')}</tbody></table>` : '<p class="dim">No private-pressure conditions active.</p>'}
  </div>`;
}

export function providerTable(cmp, providerMeta, sources) {
  const rows = cmp.rows.map((r) => {
    const meta = providerMeta[r.providerKey] ?? { label: r.providerKey };
    return `<tr class="${r.monthlyCost != null && r.monthlyCost === cmp.min ? 'cheapest' : ''}">
      <td>${esc(meta.label)}</td>
      <td class="mono num">${r.monthlyCost != null ? money(r.monthlyCost) : 'needs rates'}</td>
      <td class="mono num">${r.costPerRun != null ? money(r.costPerRun, 2) : ''}</td>
      <td class="mono num">${r.costPerUserPerMonth != null ? money(r.costPerUserPerMonth, 2) : ''}</td>
      <td>${meta.sourceId ? sourceLinkPills([meta.sourceId], sources) : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="card">
    <h3 class="card-title">Provider comparison</h3>
    <p class="dim">The whole workload priced inside each provider family: agent roles at their tiers, quick-formula workloads at the worker rate with an editable input/output split. Public list prices, editable in the rates panel. Never a quote.</p>
    <div class="table-wrap"><table class="cmp-table">
      <thead><tr><th>provider</th><th>monthly</th><th>per run</th><th>per user</th><th>source</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

export function ratesPanel(rates, providerMeta, sources) {
  const rows = rates.map((r, i) => {
    const stale = r.lastReviewed && (Date.now() - new Date(r.lastReviewed).getTime()) > 60 * 86400000;
    return `
    <tr>
      <td>${esc(providerMeta[r.providerKey]?.label ?? r.providerKey)}</td>
      <td>${esc(r.model)}${r.userSupplied ? ' <span class="tag-user">user supplied</span>' : ''}${stale ? ' <span class="tag-user">STALE, re-verify</span>' : ''}</td>
      <td class="dim">${esc(r.tier)}</td>
      <td><input type="number" step="0.01" min="0" aria-label="${esc(r.model)} input price per million" data-rate="${i}" data-ratefield="inputPerMillion" value="${r.inputPerMillion ?? ''}"></td>
      <td><input type="number" step="0.01" min="0" aria-label="${esc(r.model)} cached input price per million" data-rate="${i}" data-ratefield="cachedInputPerMillion" value="${r.cachedInputPerMillion ?? ''}"></td>
      <td><input type="number" step="0.01" min="0" aria-label="${esc(r.model)} output price per million" data-rate="${i}" data-ratefield="outputPerMillion" value="${r.outputPerMillion ?? ''}"></td>
      <td>${sourceLinkPills([r.sourceId], sources)}</td>
    </tr>`;
  }).join('');
  return `<div class="card" id="rates-panel">
    <h3 class="card-title">Provider rates (USD per million tokens)</h3>
    <p class="dim">Public list prices as editable defaults. Edit any cell for negotiated pricing; edited rows are marked user supplied and lose their source claim. Rows older than 60 days show STALE.</p>
    <div class="table-wrap"><table class="rates-table">
      <thead><tr><th>provider</th><th>model</th><th>tier</th><th>input</th><th>cached in</th><th>output</th><th>source</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

export function hardwareCards(hardware, state, sources) {
  const cards = hardware.map((h) => `
    <div class="hw-card ${state.gpuChoice === h.id ? 'selected' : ''}" data-hw="${esc(h.id)}">
      <p class="hw-vendor mono">${esc(h.vendor)}</p>
      <p class="hw-name">${esc(h.name)}</p>
      <ol class="hw-facts">
        ${h.memoryGB ? `<li>Memory: ${fmt(h.memoryGB)} GB ${esc(h.memoryType ?? '')}</li>` : ''}
        ${h.memoryBandwidthGBps ? `<li>Bandwidth: ${fmt(h.memoryBandwidthGBps)} GB/s</li>` : ''}
        ${h.typicalBoardPowerW ? `<li>Board power: ${fmt(h.typicalBoardPowerW)} W</li>` : ''}
        ${h.gpuSupport ? `<li>GPU support: ${esc(h.gpuSupport)}</li>` : ''}
        <li>Pricing: user supplied quote required</li>
      </ol>
      ${h.notes ? `<p class="dim hw-notes">${esc(h.notes)}</p>` : ''}
      ${h.benchNote ? `<p class="dim hw-notes">${esc(h.benchNote)}</p>` : ''}
      ${sourceLinkPills([h.sourceId], sources)}
      ${h.benchSources?.length ? `<div class="src-pills">${h.benchSources.map((u) => `<a class="src-pill" href="${esc(u)}" target="_blank" rel="noopener">benchmark source</a>`).join('')}</div>` : ''}
      ${h.category === 'GPU' ? `<button class="pick-hw" data-pick="${esc(h.id)}">${state.gpuChoice === h.id ? 'selected for sizing' : 'use for sizing'}</button>` : ''}
    </div>`).join('');
  return `<div class="card"><h3 class="card-title">Hardware candidates</h3>
    <p class="dim">Specs from vendor pages, linked. TokenOps shows no hardware prices, ever. The ceiling below says what a quote must come under.</p>
    <div class="hw-grid">${cards}</div></div>`;
}

/* Break even chart: inline SVG, no dependencies.
   Uses the SAME basis as breakEvenTokens (billed agent tokens and the actual
   monthly budget, quote-derived when a quote exists) so the provider line
   crosses the budget line exactly at the drawn break-even vertical
   (audit finding: a totalMTok slope made the chart contradict its own math). */
export function breakEvenChart(be, providerMonthlyCost) {
  if (!be?.result || !providerMonthlyCost || !be.weightedCostPerMillion) return '<p class="dim">Chart appears once token volume and provider cost exist.</p>';
  const ceilingMonthly = be.monthlyBudget;
  const totalMTok = be.currentMTok;
  const W = 640, H = 280, PAD = 48;
  const maxX = Math.max(be.result * 2, totalMTok * 1.4, 1);
  const costPerM = be.weightedCostPerMillion;
  const maxY = Math.max(costPerM * maxX, ceilingMonthly * 1.4);
  const X = (m) => PAD + (m / maxX) * (W - PAD - 16);
  const Y = (c) => H - PAD - (c / maxY) * (H - PAD - 16);
  const gridY = [0.25, 0.5, 0.75, 1].map((f) => {
    const c = maxY * f;
    return `<line x1="${PAD}" y1="${Y(c)}" x2="${W - 16}" y2="${Y(c)}" class="be-grid"/><text x="${PAD - 6}" y="${Y(c) + 4}" class="be-tick" text-anchor="end">${money(c)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="be-chart" role="img" aria-label="Break even chart: provider cost line versus monthly million tokens, with the hardware ceiling line and current usage marker.">
    ${gridY}
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - 16}" y2="${H - PAD}" class="be-axis"/>
    <line x1="${PAD}" y1="16" x2="${PAD}" y2="${H - PAD}" class="be-axis"/>
    <line x1="${X(0)}" y1="${Y(0)}" x2="${X(maxX)}" y2="${Y(costPerM * maxX)}" class="be-provider"/>
    <line x1="${PAD}" y1="${Y(ceilingMonthly)}" x2="${W - 16}" y2="${Y(ceilingMonthly)}" class="be-ceiling"/>
    <line x1="${X(be.result)}" y1="${H - PAD}" x2="${X(be.result)}" y2="${Y(ceilingMonthly)}" class="be-breakline"/>
    <circle cx="${X(totalMTok)}" cy="${Y(costPerM * totalMTok)}" r="5" class="be-now"/>
    <text x="${X(totalMTok) + 8}" y="${Y(costPerM * totalMTok) - 8}" class="be-label">you are here (${fmt(totalMTok)} MTok billed)</text>
    <text x="${X(be.result) + 6}" y="${H - PAD - 8}" class="be-label">break even ${fmt(be.result)} MTok/mo</text>
    <text x="${W - 20}" y="${Y(ceilingMonthly) - 6}" class="be-label" text-anchor="end">monthly owned budget ${money(ceilingMonthly)}</text>
    <text x="${W - 20}" y="${Y(costPerM * maxX) + 14}" class="be-label" text-anchor="end">provider cost</text>
    <text x="${(W + PAD) / 2}" y="${H - 12}" class="be-tick" text-anchor="middle">million billed agent tokens per month</text>
  </svg>`;
}

export function whiteboardCard(data) {
  const text = [
    `Workload: ${data.scenario}`,
    `Estimated volume: ${fmt(data.monthlyRuns)} runs per month and ${fmt(data.monthlyTokens)} tokens per month`,
    `Current best route: ${data.route}`,
    `Why: ${data.why.join('; ')}`,
    `Break even: private hardware starts to make sense near ${data.breakEvenMTok ? fmt(data.breakEvenMTok) : 'unknown'} million billed agent tokens per month, assuming ${data.ceilingMonthly ? money(data.ceilingMonthly) : 'unknown'} monthly owned budget and ${data.costPerMillion ? money(data.costPerMillion, 2) : 'unknown'} per million billed agent tokens`,
    `Next step: ${data.next}`,
  ].join('\n');
  return `<div class="card wb-card" id="whiteboard-card">
    <h3 class="card-title">Whiteboard card</h3>
    <div class="wb-inner">
      <p class="wb-line"><span class="k">workload</span> ${esc(data.scenario)}</p>
      <p class="wb-line"><span class="k">volume</span> ${data.monthlyRuns ? `<span class="mono">${fmt(data.monthlyRuns)}</span> runs/mo &middot; ` : ''}<span class="mono">${fmt(data.monthlyTokens)}</span> tokens/mo</p>
      <p class="wb-line"><span class="k">best route</span> ${esc(data.route)}</p>
      <p class="wb-line"><span class="k">why</span></p>
      <ol>${data.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ol>
      <p class="wb-line"><span class="k">break even</span> near <span class="mono">${data.breakEvenMTok ? fmt(data.breakEvenMTok) : 'unknown'}</span> MTok/mo</p>
      <p class="wb-line"><span class="k">next step</span> ${esc(data.next)}</p>
    </div>
    <button class="copy-btn wb-copy" data-copy="${esc(text)}">copy whiteboard card</button>
  </div>`;
}

export function weightSliders(rules, overrides) {
  // Policy gate points: the private-pressure engine, draggable like the rest
  // (Fred's call during the weight review, 2026-07-03).
  const policyRows = Object.entries(rules.policyPoints).map(([pk, def]) => {
    const cur = overrides[`policy.${pk}`] ?? def.default;
    return `<label class="slider-row">
      <span class="slider-label">${esc(pk)}${def.note ? ` <span class="dim">(${esc(def.note)})</span>` : ''}</span>
      <input type="range" min="${def.min}" max="${def.max}" step="1" value="${cur}" data-weight="policy.${esc(pk)}" aria-label="policy ${esc(pk)} points">
      <span class="mono slider-val">${cur}</span>
      <span class="dim mono">default ${def.default}</span>
    </label>`;
  }).join('');
  const marginDef = rules.coRecommendMarginPoints;
  const marginCur = overrides['coRecommendMarginPoints'] ?? marginDef.default;
  const marginRow = `<label class="slider-row">
    <span class="slider-label">co-recommend margin <span class="dim">(routes within this many points tie)</span></span>
    <input type="range" min="${marginDef.min}" max="${marginDef.max}" step="1" value="${marginCur}" data-weight="coRecommendMarginPoints" aria-label="co-recommend margin points">
    <span class="mono slider-val">${marginCur}</span>
    <span class="dim mono">default ${marginDef.default}</span>
  </label>`;
  const groups = Object.entries(rules.routes).map(([rk, r]) => {
    const rows = Object.entries({ ...(r.weights ?? {}), ...(r.penalties ?? {}) }).map(([wk, def]) => {
      const cur = overrides[`${rk}.${wk}`] ?? def.default;
      const step = def.max <= 1 ? 0.05 : 1;
      return `<label class="slider-row">
        <span class="slider-label">${esc(wk)}${def.note ? ` <span class="dim">(${esc(def.note)})</span>` : ''}</span>
        <input type="range" min="${def.min}" max="${def.max}" step="${step}" value="${cur}" data-weight="${esc(rk)}.${esc(wk)}">
        <span class="mono slider-val">${cur}</span>
        <span class="dim mono">default ${def.default}</span>
      </label>`;
    }).join('');
    return `<details class="weight-group"><summary>${esc(r.label)}</summary>${rows}</details>`;
  }).join('');
  return `<div class="card" id="weights-panel">
    <h3 class="card-title">Scoring weights</h3>
    <p class="dim">Every weight behind the route scores, slidable within its reviewed range. Move a slider and watch the routes reorder. Reset restores the reviewed defaults.</p>
    <details class="weight-group"><summary>Policy gate points (private pressure)</summary>${policyRows}</details>
    <details class="weight-group"><summary>Co-recommend margin</summary>${marginRow}</details>
    ${groups}
    <button id="reset-weights">reset weights to reviewed defaults</button>
  </div>`;
}

export function discoveryCard(questions) {
  return `<div class="card">
    <h3 class="card-title">Discovery questions</h3>
    <p class="dim">Generated from what is missing or high impact right now.</p>
    <ol>${questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>
    <button class="copy-btn" data-copy="${esc(questions.map((q, i) => `${i + 1}. ${q}`).join('\n'))}">copy questions</button>
  </div>`;
}

export function assumptionsPanel(items) {
  return `<div class="card" id="assumptions-panel">
    <h3 class="card-title">Assumptions</h3>
    <p class="dim">Every constant in play, its reason, and where it came from. All editable at the field that owns it.</p>
    <div class="table-wrap"><table class="cmp-table"><thead><tr><th>assumption</th><th>value</th><th>reason</th></tr></thead>
    <tbody>${items.map((a) => `<tr><td>${esc(a.label)}</td><td class="mono num">${esc(a.value)}</td><td class="dim">${esc(a.reason)}</td></tr>`).join('')}</tbody></table></div>
  </div>`;
}
