/* Nutanix Conversation Sizer app. Single scroll, quiet build-in,
   four outputs per site law: answer, whiteboard card, script, next action. */

import { fmt } from '../tokenops/engine.js';
import { formulaTrace } from '../tokenops/components.js';
import { sizerEngine, SIZER_DEFAULTS, PRESETS, RF, CVM, applyPreset } from './formulas.js';
import { infoButton, openTeach } from '../tokenops/teach.js';
import { SIZER_CATEGORIES, SIZER_PERSONAS, SIZER_SOURCE_LINKS } from './presets.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const SIZER_SOURCES = [
  { id: 'hpe_dx', label: 'HPE ProLiant DX380 Gen11 QuickSpecs (Nutanix-certified)', url: 'https://www.hpe.com/us/en/collaterals/collateral.a50006994enw.html', sourceType: 'server QuickSpecs', vendor: 'HPE', lastReviewed: '2026-07-03' },
  { id: 'hpe_gen12_nutanix', label: 'HPE ProLiant Compute Gen12 for Nutanix QuickSpecs', url: 'https://www.hpe.com/us/en/collaterals/collateral.a50009240enw.html', sourceType: 'solution QuickSpecs', vendor: 'HPE', lastReviewed: '2026-07-03' },
  { id: 'nutanix_appendix_f', label: 'NutaNIX field guide, appendix F sizing rules', url: 'https://github.com/nixfred/nutanix/blob/main/curriculum/nutanix/appendices/appendix-f-sizing-rules.md', sourceType: 'methodology', vendor: 'nixfred/nutanix (public)', lastReviewed: '2026-07-03' },
  { id: 'nutanix_sizer_official', label: 'Nutanix Sizer (the official tool, the source of truth)', url: 'https://sizer.nutanix.com/', sourceType: 'official sizing tool', vendor: 'Nutanix', lastReviewed: '2026-07-03' },
];

export function createSizer(root, summaryEl) {
  let state = structuredClone(SIZER_DEFAULTS);
  let timer = null;
  let view = 'start';
  let landingMeta = null;
  let startCat = null;

  const navPills = () => `<nav class="app-nav mono" aria-label="Calculator navigation">
    <button type="button" class="nav-item ${view === 'start' ? 'on' : ''}" data-goto="start">Start</button>
    ${landingMeta ? `<button type="button" class="nav-item ${view === 'landing' ? 'on' : ''}" data-goto="landing">Starting point</button>` : ''}
    <button type="button" class="nav-item" data-goto="tool-answer">The answer</button>
    <button type="button" class="nav-item ${view === 'tool' ? 'on' : ''}" data-goto="tool">Every dial</button>
    <a class="nav-item" href="/howto/nutanix-sizer">Manual</a>
    <a class="nav-item" href="/">All calculators</a>
    <button type="button" class="nav-item nav-reset" data-ns-reset="1" title="Wipe inputs and begin fresh">Start over</button>
  </nav>`;

  function applyCategory(key) {
    const cat = SIZER_CATEGORIES[key];
    state = { ...structuredClone(SIZER_DEFAULTS), ...cat.patch };
    landingMeta = { title: cat.label, tagline: cat.tagline, howCommon: cat.howCommon, assumptions: cat.assumptions, variableNotes: null };
    view = 'landing';
    render(); window.scrollTo(0, 0);
  }

  function applyPersona(idx) {
    const p = SIZER_PERSONAS[idx];
    state = { ...structuredClone(SIZER_DEFAULTS), ...p.inputs };
    landingMeta = {
      title: p.companyName, story: p.story, groundedIn: p.groundedIn,
      assumptions: (p.variableNotes ?? []).map((n) => ({ label: `${n.variable} = ${n.value}`, why: n.meaning, verify: true })).slice(0, 5),
      variableNotes: p.variableNotes,
    };
    view = 'landing';
    render(); window.scrollTo(0, 0);
  }

  function renderStart() {
    const cats = Object.entries(SIZER_CATEGORIES).map(([k, c]) => `
      <button type="button" class="pattern-card ${startCat === k ? 'on' : ''}" data-cat="${k}">
        <span class="pc-label">${esc(c.label)}</span>
        <span class="pc-tag dim">${esc(c.tagline)}</span>
        <span class="pc-common mono">${esc(c.howCommon.split(';')[0].split(':')[0])}</span>
      </button>`).join('');
    const personas = SIZER_PERSONAS.map((p, i) => `
      <button type="button" class="persona-card" data-spersona="${i}">
        <span class="pc-tier mono">${esc(p.tier.toUpperCase())}</span>
        <span class="pc-label">${esc(p.companyName)}</span>
        <span class="pc-tag dim">${esc(p.industry)}</span>
      </button>`).join('');
    root.innerHTML = `${navPills()}
      <div class="start">
        <h1>What are you sizing?</h1>
        <p class="dim">Every session starts from a real Nutanix workload pattern, grounded in the public field guide's sizing rules and reference architectures. Every assumption shown and adjustable.</p>
        <div class="pattern-grid">${cats}</div>
        <p class="section-label" style="margin-top:2.2rem">or walk in an example Customer's shoes</p>
        <div class="persona-row">${personas}</div>
        <p class="dim start-skip">Prefer a blank sheet? <button class="linklike" data-goto="tool">Open every dial</button></p>
      </div>`;
    if (summaryEl) summaryEl.classList.add('hidden');
  }

  function renderLanding() {
    if (!landingMeta) { view = 'start'; renderStart(); return; }
    const rows = (landingMeta.assumptions ?? []).map((a) => `
      <tr class="${a.verify ? 'verify-row' : ''}">
        <td>${a.verify ? '<span class="verify-flag mono">VERIFY</span>' : ''}</td>
        <td><b>${esc(a.label)}</b><br><span class="dim">${esc(a.why)}</span></td>
        <td><button class="linklike" data-goto="tool">adjust</button></td>
      </tr>`).join('');
    const notes = landingMeta.variableNotes?.length ? `
      <details class="weight-group" open><summary>Every number, explained: what it means and what it drives</summary>
        <div class="table-wrap"><table class="cmp-table"><thead><tr><th>variable</th><th>value</th><th>what it means here</th><th>what it drives</th></tr></thead><tbody>
          ${landingMeta.variableNotes.map((n) => `<tr><td class="mono">${esc(n.variable)}</td><td class="mono num">${esc(n.value)}</td><td>${esc(n.meaning)}</td><td>${esc(n.drives)}</td></tr>`).join('')}
        </tbody></table></div>
      </details>` : '';
    root.innerHTML = `${navPills()}
      <div class="wizard" style="max-width: 52rem;">
        <h1>${esc(landingMeta.title)}</h1>
        ${landingMeta.story ? `<p class="landing-story">${esc(landingMeta.story)}</p>` : `<p class="dim">${esc(landingMeta.tagline ?? '')}</p>`}
        ${landingMeta.howCommon ? `<p class="dim"><span class="k">from the field guide</span> ${esc(landingMeta.howCommon)}</p>` : ''}
        ${landingMeta.groundedIn ? `<p class="dim"><span class="k">grounded in</span> ${esc(landingMeta.groundedIn)} <a href="${SIZER_SOURCE_LINKS.arch}" target="_blank" rel="noopener">(source)</a></p>` : ''}
        <div class="card">
          <h3 class="card-title">What we just assumed for you</h3>
          <p class="dim">Starting points from the guide, not truths. The flagged rows are the ones to verify with the Customer.</p>
          <div class="table-wrap"><table class="cmp-table"><tbody>${rows}</tbody></table></div>
        </div>
        ${notes}
        <div class="btn-row">
          <button class="primary" data-goto="tool-answer">See the answer</button>
          <button data-goto="tool">Open every dial</button>
          <button data-goto="start">Start over</button>
        </div>
      </div>`;
    if (summaryEl) summaryEl.classList.add('hidden');
  }

  const F = [
    ['vmCount', 'VM count', 'number'],
    ['avgVcpuPerVm', 'Average vCPU per VM', 'number'],
    ['avgRamGbPerVm', 'Average RAM GB per VM', 'number'],
    ['usedStorageTb', 'Used storage today (TB)', 'number'],
    ['growthPercentPerYear', 'Annual growth percent', 'number'],
    ['growthWindowMonths', 'Sizing window (months)', 'number'],
    ['vcpuToPcpu', 'vCPU to pCPU ratio', 'number'],
    ['compressionRatio', 'Compression ratio', 'number'],
    ['dedupRatio', 'Dedup ratio', 'number'],
    ['nodeCores', 'Cores per node', 'number'],
    ['nodeRamGb', 'RAM GB per node', 'number'],
    ['nodeRawTb', 'Raw TB per node', 'number'],
  ];

  function compute() {
    return sizerEngine.evaluate(state, {});
  }

  function inputsHtml() {
    const sel = (key, label, entries, cur) => `<div class="field"><label for="ns-${key}">${label}${infoButton('sizer-' + key)}</label>
      <select id="ns-${key}" data-ns="${key}">${entries.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    return `
      <div class="a-fields">
        ${sel('workloadType', 'Workload preset', Object.entries(PRESETS).map(([k, p]) => [k, p.label]), state.workloadType)}
        ${sel('rf', 'Data protection', Object.entries(RF).map(([k, r]) => [k, r.label]), state.rf)}
        ${sel('cvmProfile', 'CVM profile', Object.entries(CVM).map(([k, c]) => [k, `${c.label} (${c.vcpu} vCPU / ${c.ramGb} GB)`]), state.cvmProfile)}
        ${F.map(([key, label]) => `<div class="field"><label for="ns-${key}">${label}${infoButton('sizer-' + key)}</label><input id="ns-${key}" type="number" step="any" min="0" data-ns="${key}" value="${state[key]}"></div>`).join('')}
      </div>`;
  }

  function resultsHtml() {
    const { traces, values } = compute();
    const floor = values.nodeFloor, ceil = values.nodeCeilingQuote;
    const rf = RF[state.rf], cvm = CVM[state.cvmProfile];
    const gates = { CPU: values.nodesByCpu, RAM: values.nodesByRam, storage: values.nodesByStorage };
    const winner = Object.entries(gates).sort((a, b) => b[1] - a[1])[0][0];
    const answer = `This estate fits in roughly ${floor} to ${ceil} nodes (HPE ProLiant for Nutanix) (${state.nodeCores} cores / ${fmt(state.nodeRamGb)} GB / ${state.nodeRawTb} TB raw each) at ${rf.label}.`;

    const wbText = [
      `Estate: ${fmt(state.vmCount)} VMs, ${fmt(values.storageDemandTb)} TB after ${state.growthWindowMonths} months growth`,
      `Rough size: ${floor} to ${ceil} nodes (HPE ProLiant for Nutanix) at ${rf.label} (binding gate: ${winner})`,
      `Effective per node: ${fmt(values.effectiveTbPerNode)} TB after RF, reservation, 75 percent ceiling, and data efficiency`,
      `CVM tax paid: ${cvm.vcpu} vCPU + ${cvm.ramGb} GB per node`,
      `This is a pre-sizer estimate, within roughly 25 percent. Nutanix Sizer produces the number that goes in the contract.`,
    ];

    const script = [
      `On the range: "Rough math says ${floor} to ${ceil} nodes. A single number this early would imply precision nobody has yet. Sizer with your real workload data produces the committed number."`,
      `On ${rf.label}: ${state.rf === 'rf3' ? '"RF3 needs about 50 percent more raw capacity than RF2 for the same data, because it stores a third full copy. Before we pay that, what are the actual RTO and RPO requirements, and what does the backup layer already cover?"' : '"RF2 with N+1 tolerates a node failure while keeping your data protected. RF3 exists for the workloads where two simultaneous failures must be survivable, and storing that third copy needs about 50 percent more raw capacity for the same data."'}`,
      `On the CVM: "Every node reserves about ${cvm.vcpu} vCPUs and ${cvm.ramGb} GB for the storage controller. That is the honest overhead of hyperconvergence, and it is already subtracted in these numbers."`,
      `On data efficiency: "I planned ${state.compressionRatio}x compression${state.dedupRatio > 1 ? ` and ${state.dedupRatio}x dedup` : ''}. Anything better is a bonus. Nobody should quote you 4 to 6x without seeing your data."`,
      `On headroom: "These numbers keep CPU at 70 percent and storage at 75 percent at peak. A cluster sized to 100 percent has no room for a rebuild, a spike, or next quarter."`,
    ];

    const next = [
      `Run Nutanix Sizer with real workload data: VM inventory, resource consumption, growth. Sizer output becomes the proposal BoM, validated in a POC. The HPE configurator maps the node range onto specific models: DX380 Gen11 or ProLiant Compute Gen12 for Nutanix.`,
      `Collect before that meeting: per-VM CPU/RAM/storage actuals, peak IOPS and read/write split, RPO/RTO per workload tier, 3 year growth target.`,
      `Risk areas to say out loud: overcommit ratio is a field heuristic (the guide publishes none); CVM specs should be re-validated against current portal documentation; compression and dedup are unvalidated until a POC runs on real data.`,
    ];

    const order = ['growthFactor', 'usableMultiplier', 'effectiveTbPerNode', 'storageDemandTb', 'coresDemand', 'ramDemandGb', 'nodesByStorage', 'nodesByCpu', 'nodesByRam', 'nodeFloor', 'nodeCeilingQuote'];
    return `
      <div class="card"><h3 class="card-title">The answer</h3>
        <p class="rec-headline">${esc(answer)}</p>
        <p class="dim">Binding gate: ${winner}. Pre-sizer estimate, within roughly 25 percent. Never a quote; Nutanix Sizer is the source of truth.</p>
      </div>
      <div class="card" id="dx-config-card">
        <h3 class="card-title">The iron (all HPE, no prices)</h3>
        <p>${esc(`${floor} to ${ceil} x HPE nodes for Nutanix, each modeled at ${state.nodeCores} cores, ${fmt(state.nodeRamGb)} GB RAM, ${state.nodeRawTb} TB raw. Naming honesty, verified 2026: DX380 exists through Gen11; the Gen12 line is ProLiant Compute Gen12 for Nutanix on DL380-class hardware with AOS factory-installed. Exact models, drives, and NICs come from the HPE configurator, not this page.`)}</p>
        <p class="dim">Not an orderable BOM. Edit the node profile above to model the box actually under discussion.</p>
                <div class="src-pills"><a class="src-pill" href="https://www.hpe.com/us/en/collaterals/collateral.a50006994enw.html" target="_blank" rel="noopener">DX380 Gen11 QuickSpecs &middot; reviewed 2026-07-03</a><a class="src-pill" href="https://www.hpe.com/us/en/collaterals/collateral.a50009240enw.html" target="_blank" rel="noopener">Gen12 for Nutanix QuickSpecs &middot; reviewed 2026-07-03</a></div>
      </div>
      <div class="card wb-card"><h3 class="card-title">Whiteboard card</h3>
        <div class="wb-inner">${wbText.map((l) => `<p class="wb-line">${esc(l)}</p>`).join('')}</div>
        <button class="copy-btn wb-copy" data-copy="${esc(wbText.join('\n'))}">copy whiteboard card</button>
      </div>
      <div class="card"><h3 class="card-title">Conversation script</h3>
        <ol>${script.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
        <button class="copy-btn" data-copy="${esc(script.join('\n\n'))}">copy script</button>
      </div>
      <div class="card"><h3 class="card-title">Next action</h3>
        <ol>${next.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
      </div>
      <h2 class="a-title" id="ns-formulas">Every formula</h2>
      ${order.map((id) => formulaTrace(traces[id], SIZER_SOURCES)).join('')}`;
  }

  function renderTool() {
    root.innerHTML = `${navPills()}
      <section class="a-section" id="ns-estate"><h2 class="a-title">The estate</h2>
        <p class="dim">Rough conversation sizing from the public NutaNIX field guide, appendix F. Ranges on purpose. Not a quote, not formal sizing.</p>
        <div id="ns-inputs">${inputsHtml()}</div>
      </section>
      <section id="ns-results">${resultsHtml()}</section>`;
    updateSummary();
  }

  function render() {
    if (view === 'start') { renderStart(); return; }
    if (view === 'landing') { renderLanding(); return; }
    renderTool();
  }

  function refresh() {
    document.getElementById('ns-results').innerHTML = resultsHtml();
    updateSummary();
  }

  function updateSummary() {
    if (!summaryEl) return;
    const { values } = compute();
    summaryEl.classList.remove('hidden');
    summaryEl.innerHTML = `
      <div class="sum-cell"><span class="sum-label">node range</span><span class="sum-value mono">${values.nodeFloor} to ${values.nodeCeilingQuote}</span></div>
      <div class="sum-cell"><span class="sum-label">binding gate</span><span class="sum-value mono">${['CPU', 'RAM', 'storage'].reduce((a, b) => ((({ CPU: values.nodesByCpu, RAM: values.nodesByRam, storage: values.nodesByStorage })[a] >= ({ CPU: values.nodesByCpu, RAM: values.nodesByRam, storage: values.nodesByStorage })[b]) ? a : b))}</span></div>
      <div class="sum-cell"><span class="sum-label">effective TB/node</span><span class="sum-value mono">${fmt(values.effectiveTbPerNode)}</span></div>
      <div class="sum-cell"><span class="sum-label">storage demand</span><span class="sum-value mono">${fmt(values.storageDemandTb)} TB</span></div>`;
  }

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset.ns) return;
    if (t.tagName === 'SELECT') {
      if (t.dataset.ns === 'workloadType') { state = applyPreset(state, t.value); render(); return; }
      state[t.dataset.ns] = t.value;
      refresh(); return;
    }
    state[t.dataset.ns] = t.value === '' ? 0 : Number(t.value);
    clearTimeout(timer); timer = setTimeout(refresh, 150);
  });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.teach) { openTeach(b.dataset.teach); return; }
    if (b?.dataset.cat) { startCat = b.dataset.cat; applyCategory(b.dataset.cat); return; }
    if (b?.dataset.spersona !== undefined && b?.dataset.spersona !== null && b.dataset.spersona !== '') { applyPersona(Number(b.dataset.spersona)); return; }
    if (b?.dataset.goto) {
      const g = b.dataset.goto;
      if (g === 'tool-answer') { view = 'tool'; render(); document.getElementById('ns-results')?.scrollIntoView(); return; }
      view = g; render(); window.scrollTo(0, 0); return;
    }
    if (b?.dataset.nsReset) {
      state = structuredClone(SIZER_DEFAULTS);
      landingMeta = null; startCat = null; view = 'start';
      history.replaceState(null, '', location.pathname);
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (b?.dataset.copy !== undefined && b?.dataset.copy !== null) {
      navigator.clipboard.writeText(b.dataset.copy).then(() => { const t = b.textContent; b.textContent = 'copied'; setTimeout(() => (b.textContent = t), 1200); });
    }
  });

  render();
  return { compute, getState: () => state };
}
