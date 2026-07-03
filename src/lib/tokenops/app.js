/* TokenOps application orchestrator. Wires state, modes, recompute, events.
   Chooser screen first (decision 0.1.2), Meeting wizard / Architect scroll
   (0.5.19), math always expanded (0.5.20), live summary bar (0.5.21). */

import { engine } from './formulas.js';
import { validateInputs, fmt, money } from './engine.js';
import { roleRoutedCost, providerComparison, cachingSavings, hardwareCeiling, breakEvenTokens, rentedGpuCost, optimizationLevers, primaryLeverOf, financeDecision } from './costs.js';
import { recommend, confidence, discoveryQuestions, privatePolicyScore } from './routes.js';
import { SECTIONS, MEETING_STEPS, TOPOLOGY_PRESETS, WORKLOAD_PRESETS, LIKERT_LABELS } from './sections.js';
import * as C from './components.js';
import * as X from './exports.js';

export const VERSION = 'v1.0.0';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Staggered build-in on view changes. Fred's call 2026-07-03: no glyph
   scrambling inside the calculator (too much); the decode effect stays the
   LANDING page signature. Dynamic build feel, quiet execution. */
function decodeIn(rootEl) {
  if (reduced()) return;
  const blocks = rootEl.querySelectorAll('.a-section, .card, .chooser > *, .wizard > *, #results > *');
  blocks.forEach((el, i) => {
    el.classList.add('rise');
    el.style.animationDelay = `${Math.min(i * 45, 500)}ms`;
  });
}

function getPath(obj, path) { return path.split('.').reduce((o, k) => o?.[k], obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
}

export function createApp(root, data) {
  const { rates, hardware, sources, rules, providerMeta } = data;
  let state = structuredClone(data.defaults);
  let weightOverrides = {};
  let view = 'chooser';
  let meetingStep = 0;
  let recomputeTimer = null;

  const shared = X.parseShareLink();
  const auto = shared ? null : X.persistence.loadAutosave();
  if (shared?.s) { state = { ...state, ...shared.s }; weightOverrides = shared.w ?? {}; view = 'architect'; }
  else if (auto?.state) { state = { ...state, ...auto.state }; weightOverrides = auto.weightOverrides ?? {}; }

  /* ---------- compute ---------- */
  function compute() {
    const errors = validateInputs(state);
    const { traces, values } = engine.evaluate(state, { hardware });
    const selected = roleRoutedCost(state, values, rates);
    const cmp = providerComparison(state, values, rates, Object.keys(providerMeta));
    const providerBaseline = state.ceilingBaseline === 'selected' && selected.total > 0 ? selected.total : (cmp.min ?? selected.total ?? 0);
    const ceiling = hardwareCeiling(state, providerBaseline);
    const be = breakEvenTokens(state, values, providerBaseline, selected.billedTokens);
    const costPerM = selected.billedTokens > 0 ? selected.total / (selected.billedTokens / 1e6) : null;
    const rented = rentedGpuCost(state, costPerM);
    const caching = selected.total > 0 ? cachingSavings(state, values, rates) : null;
    const levers = selected.total > 0 ? optimizationLevers(state, values, rates, selected.total, (patched) => engine.evaluate(patched, { hardware }).values) : [];
    const rec = recommend(state, values, rules, { providerMonthlyCost: providerBaseline, usageVersusBreakEven: be.usageVersusBreakEven ?? 0 }, weightOverrides);
    const conf = confidence(state, values, rates);
    // Exec card extras (spec 33.1): primary risk and primary optimization lever.
    rec.primaryRisk = rec.warnings?.length ? rec.warnings[0].message
      : state.usageConfidence !== 'measured' ? 'Usage is estimated; the whole cost picture moves with it.'
      : state.userBenchmarkTpsPerGpu == null ? 'Throughput sizing rests on a labeled benchmark estimate.'
      : 'Public list pricing may not match contract pricing.';
    const lever0 = primaryLeverOf(levers);
    if (lever0) rec.primaryLever = `${lever0.label} (saves about ${Math.round(lever0.savings).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} per month).`;
    const fin = financeDecision(state, providerBaseline, ceiling);
    const disc = discoveryQuestions(state);
    const policy = privatePolicyScore(state, rules, weightOverrides);
    return { errors, traces, values, selected, cmp, providerBaseline, ceiling, be, rented, caching, levers, rec, conf, disc, policy, fin };
  }

  /* ---------- field rendering ---------- */
  function fieldHtml(f) {
    if (f.show && !f.show(state)) return '';
    if (f.reveal && !f.reveal(state)) return '';
    const val = getPath(state, f.key);
    const id = `f-${f.key.replace(/\./g, '-')}`;
    let control = '';
    if (f.kind === 'number') control = `<input id="${id}" type="number" data-field="${esc(f.key)}" value="${val ?? ''}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} step="${f.step ?? 'any'}">`;
    else if (f.kind === 'text') control = `<input id="${id}" type="text" data-field="${esc(f.key)}" value="${esc(val ?? '')}">`;
    else if (f.kind === 'toggle') control = `<button id="${id}" type="button" class="toggle ${val ? 'on' : ''}" role="switch" aria-checked="${!!val}" data-field="${esc(f.key)}" data-toggle="1">${val ? 'yes' : 'no'}</button>`;
    else if (f.kind === 'likert') control = `<div class="likert" role="radiogroup" aria-label="${esc(f.label)}">${LIKERT_LABELS.map((l, i) => `<button type="button" role="radio" aria-checked="${val === i}" class="lik ${val === i ? 'on' : ''}" data-field="${esc(f.key)}" data-likert="${i}">${l}</button>`).join('')}</div>`;
    else if (f.kind === 'select') {
      let choices = f.choices;
      if (choices === 'PROVIDERS') choices = Object.entries(providerMeta).map(([k, m]) => [k, m.label]);
      if (choices === 'TIERS') choices = [['flagship', 'Flagship'], ['workhorse', 'Workhorse'], ['mini', 'Mini']];
      if (choices === 'HARDWARE') choices = hardware.filter((h) => h.category === 'GPU').map((h) => [h.id, `${h.vendor} ${h.name}`]);
      control = `<select id="${id}" data-field="${esc(f.key)}">${choices.map(([v, l]) => `<option value="${esc(v)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    }
    return `<div class="field"><label for="${id}">${esc(f.label)}</label>${control}${f.hint ? `<p class="hint">${esc(f.hint)}</p>` : ''}</div>`;
  }

  function sectionTraces(sectionId, cx) {
    const bySection = {
      workloads: ['ragMonthlyTokens', 'agentsMonthlyTokens', 'codingMonthlyTokens', 'agenticCodingMonthlyTokens'],
      volume: ['monthlyRuns'],
      topology: ['baseCallsPerRun', 'retryCallsPerRun', 'replanCallsPerRun', 'totalCallsPerRun'],
      anatomy: ['contextSnowballTokensPerCall', 'inputTokensPerRun', 'outputTokensPerRun', 'agentMonthlyInputTokens', 'agentMonthlyOutputTokens', 'cachedInputTokensMonthly', 'uncachedInputTokensMonthly', 'totalMonthlyTokens', 'weightedTokensPerMinute', 'calendarTokensPerMinute', 'weightedTokensPerSecond', 'calendarTokensPerSecond'],
      snowball: [],
      rag: ['chunksPerDocument', 'retrievedContextTokens', 'vectorRecords', 'monthlyEmbeddingTokens'],
      tools: ['toolSchemaOverheadPerCall', 'toolResultTokensPerRun'],
      memory: ['memoryReadTokensPerRun', 'memoryWriteTokensPerRun', 'traceStoragePerMonthGB'],
      sizing: ['modelWeightMemoryGB', 'kvCacheServingGB', 'kvCacheLegacyTB', 'runtimeOverheadGB', 'safetyMarginGB', 'totalGpuMemoryRequiredGB', 'usableVramPerGpuGB', 'gpusRequiredByMemory', 'requiredSteadyOutputTps', 'requiredPeakOutputTps', 'requiredRequestsPerSecond', 'gpusRequiredByThroughput', 'recommendedGpuCount'],
      storage: ['vectorDbLegacyGB', 'protectedStorageTB'],
      network: ['userResponseBandwidthMbps', 'ragTrafficMbps', 'toolTrafficMbps', 'totalApplicationNetworkMbps'],
    };
    const ids = bySection[sectionId] ?? [];
    let html = ids.map((id) => C.formulaTrace(cx.traces[id], sources)).join('');
    if (sectionId === 'policy') html += C.policyScoreTrace(cx.policy, sources);
    return html;
  }

  function errorsHtml(errors) {
    if (!errors.length) return '';
    return `<div class="card error-card">${errors.map((e) => `<p class="warn warn-${e.severity}"><span class="warn-tag">${e.severity}</span> ${esc(e.message)}</p>`).join('')}</div>`;
  }

  function resultsStack(cx, meeting = false) {
    const runs = cx.values.monthlyRuns ?? 0;
    const wb = C.whiteboardCard({
      scenario: state.scenarioName,
      monthlyRuns: runs,
      monthlyTokens: cx.values.totalMonthlyTokens ?? 0,
      route: cx.rec.kind === 'do-not-size' ? 'Do not size yet' : cx.rec.top.label,
      why: cx.rec.rulesFired.slice(0, 3),
      breakEvenMTok: cx.be?.result,
      // Same basis as breakEvenTokens: the sentence must reproduce its own
      // arithmetic (audit finding). Budget is quote-derived when a quote exists.
      ceilingMonthly: cx.be?.monthlyBudget,
      costPerMillion: cx.be?.weightedCostPerMillion,
      next: cx.rec.nextAction,
    });
    const econ = `${C.decisionCard(state, cx.fin, cx.providerBaseline, cx.ceiling)}<div class="card" id="econ-card">
      <h3 class="card-title">The hardware budget ceiling</h3>
      <p class="ceiling-headline mono">${money(cx.ceiling.ceilingCapex)}</p>
      <p>For on premises to make sense, the recommended configuration must come in under this number all-in (${money(cx.ceiling.ceilingMonthly)} per month over ${state.usefulLifeMonths} months). TokenOps does not price hardware. It tells you what the hardware has to cost.</p>
      <div class="quote-slot">
        <label for="f-gpuQuote-inline">Enter a real quote (USD)</label>
        <input id="f-gpuQuote-inline" type="number" min="0" step="1000" data-field="gpuQuote" value="${state.gpuQuote ?? ''}">
        ${cx.ceiling.verdict ? `<p class="verdict ${cx.ceiling.verdict.under ? 'under' : 'over'}">${cx.ceiling.verdict.under ? 'UNDER the ceiling' : 'OVER the ceiling'} by ${money(cx.ceiling.verdict.delta)} (${money(cx.ceiling.verdict.monthlyEquivalent)} per month equivalent). ${cx.ceiling.verdict.under ? 'This quote beats the token route by your required margin.' : 'This quote does not beat the token route. Negotiate or stay on tokens.'}</p>` : ''}
      </div>
      <p class="dim">Ceiling baseline in use: ${state.ceilingBaseline === 'selected' ? 'your selected role routing total' : 'the cheapest provider family total'} (change under Economics and the ceiling).</p>
      ${cx.selected.missingRoles?.length ? `<p class="warn warn-caution"><span class="warn-tag">caution</span> No price for ${cx.selected.missingRoles.join(', ')}. Those tokens are counted in demand but excluded from every dollar figure until a rate is entered.</p>` : ''}
      ${state.ragEnabled && state.embeddingPricePerMillion == null ? `<p class="warn warn-info"><span class="warn-tag">info</span> RAG is on but no embedding price is set, so embedding cost is excluded from provider totals. Enter one in RAG and retrieval.</p>` : ''}
      ${cx.ceiling.traces.map((t) => C.formulaTrace(t, sources)).join('')}
      ${C.formulaTrace(cx.be, sources)}
      ${C.breakEvenChart(cx.be, cx.providerBaseline)}
      ${cx.caching ? C.formulaTrace(cx.caching, sources) : ''}
      ${cx.rented ? C.formulaTrace(cx.rented, sources) : ''}
    </div>`;
    const parts = [
      ...(meeting ? [C.inputsRecapCard(state)] : []),
      C.recommendationCard(cx.rec, cx.conf, sources),
      econ,
      C.optimizationCard(cx.levers),
      C.providerTable(cx.cmp, providerMeta, sources),
      wb,
      C.discoveryCard(cx.disc),
    ];
    if (!meeting) {
      parts.splice(4, 0, C.hardwareCards(hardware, state, sources));
      parts.splice(5, 0, C.fabricRulesCard(cx.values.recommendedGpuCount ?? 1, sources));
      parts.push(C.ratesPanel(rates, providerMeta, sources));
      parts.push(C.weightSliders(rules, weightOverrides));
      parts.push(C.assumptionsPanel(assumptionItems()));
      parts.push(exportPanel());
    } else {
      parts.push(`<p class="dim center">Need every section and every assumption? <button class="linklike" data-goto="architect">Switch to Architect Mode</button></p>`);
    }
    return parts.join('');
  }

  function assumptionItems() {
    return [
      { label: 'Tokens per RAG session per minute', value: state.ragTokensPerSessionMin, reason: 'Field sizing heuristic, editable in Workload types.' },
      { label: 'Tokens per agent workflow per minute', value: state.agentTokensPerWorkflowMin, reason: 'Field sizing heuristic, editable in Workload types.' },
      { label: 'Tokens per coding developer hour', value: state.codingTokensPerDevHour, reason: 'Field sizing heuristic, editable in Workload types.' },
      { label: 'Tokens per agentic coding developer hour', value: state.agenticCodingTokensPerDevHour, reason: 'Field sizing heuristic, editable in Workload types.' },
      { label: 'Cached input percent', value: state.cachedInputPercent + '%', reason: 'Prompt cache hit expectation; edit in Token anatomy.' },
      { label: 'Retry rate', value: state.retryRatePercent + '%', reason: 'Share of calls retried; edit in Agent topology.' },
      { label: 'Batch eligible percent', value: state.batchEligiblePercent + '%', reason: 'Share of tokens billed at the batch discount when the provider offers one.' },
      { label: 'Average bytes per token', value: state.avgBytesPerToken, reason: 'Network sizing conversion; edit in Network.' },
      { label: 'Bytes per vector record', value: state.bytesPerVectorRecord, reason: 'Legacy vector DB heuristic; edit in Storage.' },
      { label: 'Chunk size / overlap', value: `${state.chunkSize} / ${state.chunkOverlap}`, reason: 'RAG chunking; edit in RAG and retrieval.' },
      { label: 'Runtime overhead', value: state.runtimeOverheadPercent + '%', reason: 'Serving engine memory overhead; edit in Sizing.' },
      { label: 'Safety margin', value: state.safetyMarginPercent + '%', reason: 'Headroom on the memory stack; edit in Sizing.' },
      { label: 'GPU memory utilization target', value: state.gpuMemoryUtilizationTarget, reason: 'Usable share of raw VRAM; edit in Sizing.' },
      { label: 'Target GPU utilization', value: state.targetGpuUtilization, reason: 'Throughput derating; edit in Sizing.' },
      { label: 'Useful life months', value: state.usefulLifeMonths, reason: 'Capex amortization window; edit in Economics.' },
      { label: 'Required savings threshold', value: Math.min(90, Math.max(0, state.savingsThresholdPercent)) + '%', reason: 'Owned hardware must beat tokens by this margin; edit in Economics.' },
    ];
  }

  function exportPanel() {
    const saves = X.persistence.listSaves();
    return `<div class="card" id="export-panel">
      <h3 class="card-title">Exports and scenarios</h3>
      <div class="btn-row">
        <button data-export="summary">customer summary (.md)</button>
        <button data-export="math">detailed math (.md)</button>
        <button data-export="json">scenario (.json)</button>
        <button data-export="print">print report</button>
        <button data-export="share">create share link</button>
        <button data-export="share-sanitized">share link, sanitized</button>
      </div>
      <div class="btn-row">
        <input type="text" id="save-name" placeholder="scenario name">
        <button data-export="save">save locally</button>
        ${saves.length ? `<select id="load-select"><option value="">load saved...</option>${saves.map((s) => `<option>${esc(s)}</option>`).join('')}</select>` : ''}
        <label class="file-btn">import json<input type="file" id="import-json" accept=".json" hidden></label>
        <button data-export="wipe" class="danger">clear all local data</button>
      </div>
      <p class="hint">Nothing leaves this browser unless you export it. Share links encode inputs only when you click create.</p>
    </div>`;
  }

  /* ---------- views ---------- */
  function renderChooser() {
    root.innerHTML = `
      <div class="chooser">
        <h1>TokenOps</h1>
        <p class="dim">AI workload placement and token economics. Real math on screen, always.</p>
        <div class="chooser-btns">
          <button class="choose" data-goto="meeting"><span class="choose-title">In a meeting</span><span class="dim">About 12 inputs. Two minutes to a defensible answer.</span></button>
          <button class="choose" data-goto="architect"><span class="choose-title">Deep sizing</span><span class="dim">Every section, every formula, every assumption.</span></button>
        </div>
        <p class="preset-row">Start from a preset:
          <select id="preset-select"><option value="">choose...</option>${Object.entries(WORKLOAD_PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select>
        </p>
      </div>`;
    decodeIn(root);
  }

  function renderMeeting() {
    const cx = compute();
    const last = meetingStep >= MEETING_STEPS.length;
    const step = last ? null : MEETING_STEPS[meetingStep];
    root.innerHTML = `
      <div class="wizard">
        <div class="wiz-nav mono">${MEETING_STEPS.map((s, i) => `<span class="wiz-dot ${i === meetingStep ? 'cur' : i < meetingStep ? 'done' : ''}">${i + 1}</span>`).join('')}<span class="wiz-dot ${last ? 'cur' : ''}">=</span></div>
        ${last ? `
          <h2>The answer</h2>
          ${errorsHtml(cx.errors)}
          <div id="results">${resultsStack(cx, true)}</div>
          <div class="btn-row"><button data-wiz="back">back</button></div>
        ` : `
          <h2>${esc(step.title)}</h2>
          <div class="wiz-fields">${step.fields.map(fieldHtml).join('')}</div>
          <div class="btn-row">
            ${meetingStep > 0 ? '<button data-wiz="back">back</button>' : '<button data-goto="chooser">start over</button>'}
            <button class="primary" data-wiz="next">${meetingStep === MEETING_STEPS.length - 1 ? 'show the answer' : 'next'}</button>
          </div>
        `}
      </div>`;
    decodeIn(root);
  }

  function renderArchitect() {
    const cx = compute();
    const secs = SECTIONS.map((sec) => {
      if (sec.when && !sec.when(state)) return '';
      return `<section class="a-section" id="sec-${sec.id}">
        <h2 class="a-title">${esc(sec.title)}</h2>
        <p class="dim">${esc(sec.blurb)}</p>
        <div class="a-fields">${sec.fields.map(fieldHtml).join('')}</div>
        <div class="a-traces" data-traces-for="${sec.id}">${sectionTraces(sec.id, cx)}</div>
      </section>`;
    }).join('');
    root.innerHTML = `
      <div class="architect">
        <nav class="a-nav mono" aria-label="Sections">${SECTIONS.filter((s) => !s.when || s.when(state)).map((s) => `<a href="#sec-${s.id}">${esc(s.title)}</a>`).join('')}<a href="#results">Results</a></nav>
        <div class="a-body">
          <div class="btn-row"><button data-goto="chooser">mode chooser</button>
            <select id="preset-select"><option value="">apply preset...</option>${Object.entries(WORKLOAD_PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select>
            <button id="reset-all">reset to defaults</button>
          </div>
          ${errorsHtml(cx.errors)}
          ${secs}
          <section id="results"><h2 class="a-title">Results</h2>${resultsStack(cx, false)}</section>
        </div>
      </div>`;
    decodeIn(root);
  }

  function render() {
    if (view === 'chooser') renderChooser();
    else if (view === 'meeting') renderMeeting();
    else renderArchitect();
    updateSummaryBar();
  }

  function updateSummaryBar() {
    const bar = document.getElementById('tokenops-summary');
    if (!bar) return;
    if (view === 'chooser') { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const cx = compute();
    bar.innerHTML = C.summaryBar({
      totalTokens: cx.values.totalMonthlyTokens,
      costMin: cx.cmp.min, costMax: cx.cmp.max,
      leadingRoute: cx.rec.kind === 'do-not-size' ? 'Do not size yet' : cx.rec.top.label,
      ceiling: cx.ceiling.ceilingCapex,
    });
  }

  /* Refresh computed zones without touching focused inputs. */
  function refreshResults() {
    const cx = compute();
    document.querySelectorAll('[data-traces-for]').forEach((el) => {
      el.innerHTML = sectionTraces(el.dataset.tracesFor, cx);
    });
    const res = document.getElementById('results');
    if (res && view === 'architect') res.innerHTML = `<h2 class="a-title">Results</h2>${resultsStack(cx, false)}`;
    if (res && view === 'meeting') res.innerHTML = resultsStack(cx, true);
    updateSummaryBar();
    X.persistence.autosave(state, weightOverrides);
  }

  const debouncedRefresh = () => { clearTimeout(recomputeTimer); recomputeTimer = setTimeout(refreshResults, 180); };

  /* ---------- events ---------- */
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.field && !t.dataset.toggle && t.dataset.likert === undefined) {
      const raw = t.value;
      const val = (t.type === 'number' || t.type === 'range') ? (raw === '' ? null : Number(raw)) : raw;
      setPath(state, t.dataset.field, val);
      if (t.dataset.field === 'topologyType' && TOPOLOGY_PRESETS[raw]) Object.assign(state, TOPOLOGY_PRESETS[raw]);
      debouncedRefresh();
    }
    if (t.type === 'range' && t.dataset.field) {
      const lab = t.parentElement.querySelector('.slider-val');
      if (lab) lab.textContent = t.dataset.field === 'gpuQuote' ? '$' + Number(t.value).toLocaleString() : (t.dataset.field === 'financeAprPercent' ? t.value + '%' : t.value);
    }
    if (t.dataset.weight !== undefined) {
      weightOverrides[t.dataset.weight] = Number(t.value);
      t.parentElement.querySelector('.slider-val').textContent = t.value;
      debouncedRefresh();
    }
    if (t.dataset.rate !== undefined) {
      const r = rates[Number(t.dataset.rate)];
      r[t.dataset.ratefield] = t.value === '' ? null : Number(t.value);
      r.userSupplied = true;
      debouncedRefresh();
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.tagName === 'SELECT' && t.dataset.field) {
      setPath(state, t.dataset.field, t.value);
      if (t.dataset.field === 'topologyType' && TOPOLOGY_PRESETS[t.value]) Object.assign(state, TOPOLOGY_PRESETS[t.value]);
      if (t.dataset.field === 'modelSizeQuickPick' && t.value) state.modelParamsB = Number(t.value);
      if (view === 'architect') render(); else debouncedRefresh();
    }
    if (t.id === 'preset-select' && t.value) {
      const p = WORKLOAD_PRESETS[t.value];
      state = { ...structuredClone(data.defaults), ...p.patch, scenarioName: p.label };
      if (view !== 'chooser') render();
    }
    if (t.id === 'load-select' && t.value) {
      const saved = X.persistence.load(t.value);
      if (saved) { state = saved.state; weightOverrides = saved.weightOverrides ?? {}; render(); }
    }
    if (t.id === 'import-json' && t.files?.[0]) {
      t.files[0].text().then((txt) => {
        try { const p = JSON.parse(txt); state = p.state ?? state; weightOverrides = p.weightOverrides ?? {}; render(); }
        catch { alert('Could not parse that JSON file.'); }
      });
    }
  });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.goto) { view = b.dataset.goto; meetingStep = 0; render(); window.scrollTo(0, 0); return; }
    if (b.dataset.wiz === 'next') { meetingStep++; renderMeeting(); updateSummaryBar(); window.scrollTo(0, 0); return; }
    if (b.dataset.wiz === 'back') { meetingStep = Math.max(0, meetingStep - 1); renderMeeting(); updateSummaryBar(); window.scrollTo(0, 0); return; }
    if (b.dataset.toggle) {
      const cur = getPath(state, b.dataset.field);
      setPath(state, b.dataset.field, !cur);
      b.classList.toggle('on', !cur); b.textContent = !cur ? 'yes' : 'no'; b.setAttribute('aria-checked', String(!cur));
      if (view === 'architect') render(); else debouncedRefresh();
      return;
    }
    if (b.dataset.likert !== undefined) {
      setPath(state, b.dataset.field, Number(b.dataset.likert));
      b.parentElement.querySelectorAll('.lik').forEach((x) => x.classList.toggle('on', x === b));
      debouncedRefresh(); return;
    }
    if (b.dataset.copy !== undefined) {
      navigator.clipboard.writeText(b.dataset.copy).then(() => { const t = b.textContent; b.textContent = 'copied'; setTimeout(() => (b.textContent = t), 1200); });
      return;
    }
    if (b.dataset.pick) { state.gpuChoice = b.dataset.pick; refreshResults(); return; }
    if (b.id === 'reset-weights') { weightOverrides = {}; render(); return; }
    if (b.id === 'reset-all') { state = structuredClone(data.defaults); weightOverrides = {}; render(); return; }
    if (b.dataset.export) handleExport(b.dataset.export);
  });

  function exportContext() {
    const cx = compute();
    const totals = {
      monthlyRuns: cx.values.monthlyRuns ?? 0,
      monthlyTokens: cx.values.totalMonthlyTokens ?? 0,
      tps: cx.values.weightedTokensPerSecond ?? 0,
      costMin: cx.cmp.min, costMax: cx.cmp.max,
      costPerRun: cx.values.monthlyRuns ? cx.providerBaseline / cx.values.monthlyRuns : null,
    };
    // Detailed export and print must include the economics math too (audit
    // finding: ceiling, break even, caching, and rented traces were omitted).
    const allTraces = { ...cx.traces };
    for (const t of [...cx.ceiling.traces, cx.be, cx.caching, cx.rented].filter(Boolean)) allTraces[t.id] = t;
    return { cx, ctx: { state, rec: cx.rec, conf: cx.conf, totals, ceiling: cx.ceiling, be: cx.be, traces: allTraces, rates, hardware, sources, version: VERSION, weightOverrides, levers: cx.levers, assumptions: assumptionItems() } };
  }

  function handleExport(kind) {
    const { ctx } = exportContext();
    const warnName = X.customerNameWarning(state);
    if (kind === 'summary') { if (warnName && !confirm(warnName)) return; X.download('tokenops-summary.md', X.customerSummaryMarkdown(ctx)); }
    if (kind === 'math') { if (warnName && !confirm(warnName)) return; X.download('tokenops-detailed-math.md', X.detailedMathMarkdown(ctx)); }
    if (kind === 'json') { if (warnName && !confirm(warnName)) return; X.download('tokenops-scenario.json', X.scenarioJson(state, weightOverrides, VERSION), 'application/json'); }
    if (kind === 'print') { if (warnName && !confirm(warnName)) return; preparePrint(ctx); window.print(); }
    if (kind === 'share') {
      if (warnName && !confirm(warnName + ' Create the link anyway?')) return;
      navigator.clipboard.writeText(X.shareLink(state, weightOverrides)).then(() => alert('Share link copied to clipboard.'));
    }
    if (kind === 'share-sanitized') {
      navigator.clipboard.writeText(X.shareLink(X.sanitizedState(state), weightOverrides)).then(() => alert('Sanitized share link copied to clipboard.'));
    }
    if (kind === 'save') {
      const name = document.getElementById('save-name')?.value?.trim();
      if (!name) { alert('Name the scenario first.'); return; }
      X.persistence.save(name, state, weightOverrides); render();
    }
    if (kind === 'wipe') {
      if (confirm('Clear autosave and all locally saved scenarios on this browser?')) { X.persistence.clearAll(); state = structuredClone(data.defaults); weightOverrides = {}; render(); }
    }
  }

  function preparePrint(ctx) {
    let holder = document.getElementById('print-report');
    if (!holder) { holder = document.createElement('div'); holder.id = 'print-report'; document.body.appendChild(holder); }
    const oldest = sources.reduce((a, s) => (!a || s.lastReviewed < a ? s.lastReviewed : a), null);
    holder.innerHTML = `
      <h1>TokenOps report: ${esc(state.scenarioName)}</h1>
      <p>${new Date().toISOString().slice(0, 10)} &middot; TokenOps ${VERSION} &middot; oldest source review ${esc(oldest)}</p>
      <h2>Executive recommendation</h2><p>${esc(ctx.rec.headline)}</p>
      <p>Confidence: ${esc(ctx.conf.band)}. ${esc(ctx.conf.reasons.join(' '))}</p>
      <h2>Summary</h2>
      <table><tbody>
        <tr><td>Monthly runs</td><td>${fmt(ctx.totals.monthlyRuns)}</td></tr>
        <tr><td>Monthly tokens</td><td>${fmt(ctx.totals.monthlyTokens)}</td></tr>
        <tr><td>Provider cost range</td><td>${money(ctx.totals.costMin)} to ${money(ctx.totals.costMax)}</td></tr>
        <tr><td>Hardware budget ceiling</td><td>${money(ctx.ceiling.ceilingCapex)} (${money(ctx.ceiling.ceilingMonthly)}/mo over ${state.usefulLifeMonths} months)</td></tr>
        <tr><td>Break even</td><td>${ctx.be?.result ? fmt(ctx.be.result) + ' million tokens per month' : 'pending'}</td></tr>
      </tbody></table>
      <h2>Formula appendix</h2>
      ${Object.values(ctx.traces).map((t) => `<div class="p-formula"><h3>${esc(t.title)}: ${fmt(t.result)} ${esc(t.resultUnit)}</h3><p>${esc(t.plainEnglish)}</p><p class="mono">${esc(t.algebra)}</p><p class="mono">${esc(t.substitution)}</p>${t.assumptions.map((a) => `<p>Assumption: ${esc(a)}</p>`).join('')}${t.warnings.map((w) => `<p>Warning (${esc(w.severity)}): ${esc(w.message)}</p>`).join('')}</div>`).join('')}
      <h2>Sources</h2>
      <ol>${sources.map((s) => `<li>${esc(s.label)} (reviewed ${esc(s.lastReviewed)}): ${esc(s.url)}</li>`).join('')}</ol>
      <p class="p-footer">Directional sizing and placement estimate. Not a vendor quote. &middot; calc.nixfred.com/tokenops &middot; ${new Date().toISOString().slice(0, 10)} &middot; TokenOps ${VERSION} &middot; oldest source review ${esc(oldest)} &middot; Built by Fred Nix</p>`;
  }

  window.addEventListener('beforeunload', () => X.persistence.autosave(state, weightOverrides));

  render();
  return {
    compute,
    getState: () => state,
    // Test handles: the audit harness exercises exports and share links
    // through these instead of trusting that buttons exist.
    _test: {
      exportSummary: () => X.customerSummaryMarkdown(exportContext().ctx),
      exportMath: () => X.detailedMathMarkdown(exportContext().ctx),
      exportJson: () => X.scenarioJson(state, weightOverrides, VERSION),
      shareLink: () => X.shareLink(state, weightOverrides),
      reset: () => { state = structuredClone(data.defaults); weightOverrides = {}; render(); },
    },
  };
}
