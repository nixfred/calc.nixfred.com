/* Nutanix Conversation Sizer app. Single scroll, quiet build-in,
   four outputs per site law: answer, whiteboard card, script, next action. */

import { fmt } from '../tokenops/engine.js';
import { formulaTrace } from '../tokenops/components.js';
import { sizerEngine, SIZER_DEFAULTS, PRESETS, RF, CVM, applyPreset } from './formulas.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const SIZER_SOURCES = [
  { id: 'nutanix_appendix_f', label: 'NutaNIX field guide, appendix F sizing rules', url: 'https://github.com/nixfred/nutanix/blob/main/curriculum/nutanix/appendices/appendix-f-sizing-rules.md', sourceType: 'methodology', vendor: 'nixfred/nutanix (public)', lastReviewed: '2026-07-03' },
  { id: 'nutanix_sizer_official', label: 'Nutanix Sizer (the official tool, the source of truth)', url: 'https://sizer.nutanix.com/', sourceType: 'official sizing tool', vendor: 'Nutanix', lastReviewed: '2026-07-03' },
];

export function createSizer(root, summaryEl) {
  let state = structuredClone(SIZER_DEFAULTS);
  let timer = null;

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
    const sel = (key, label, entries, cur) => `<div class="field"><label for="ns-${key}">${label}</label>
      <select id="ns-${key}" data-ns="${key}">${entries.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    return `
      <div class="a-fields">
        ${sel('workloadType', 'Workload preset', Object.entries(PRESETS).map(([k, p]) => [k, p.label]), state.workloadType)}
        ${sel('rf', 'Data protection', Object.entries(RF).map(([k, r]) => [k, r.label]), state.rf)}
        ${sel('cvmProfile', 'CVM profile', Object.entries(CVM).map(([k, c]) => [k, `${c.label} (${c.vcpu} vCPU / ${c.ramGb} GB)`]), state.cvmProfile)}
        ${F.map(([key, label]) => `<div class="field"><label for="ns-${key}">${label}</label><input id="ns-${key}" type="number" step="any" min="0" data-ns="${key}" value="${state[key]}"></div>`).join('')}
      </div>`;
  }

  function resultsHtml() {
    const { traces, values } = compute();
    const floor = values.nodeFloor, ceil = values.nodeCeilingQuote;
    const rf = RF[state.rf], cvm = CVM[state.cvmProfile];
    const gates = { CPU: values.nodesByCpu, RAM: values.nodesByRam, storage: values.nodesByStorage };
    const winner = Object.entries(gates).sort((a, b) => b[1] - a[1])[0][0];
    const answer = `This estate fits in roughly ${floor} to ${ceil} nodes (${state.nodeCores} cores / ${fmt(state.nodeRamGb)} GB / ${state.nodeRawTb} TB raw each) at ${rf.label}.`;

    const wbText = [
      `Estate: ${fmt(state.vmCount)} VMs, ${fmt(values.storageDemandTb)} TB after ${state.growthWindowMonths} months growth`,
      `Rough size: ${floor} to ${ceil} nodes at ${rf.label} (binding gate: ${winner})`,
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
      `Run Nutanix Sizer with real workload data: VM inventory, resource consumption, growth. Sizer output becomes the proposal BoM, validated in a POC.`,
      `Collect before that meeting: per-VM CPU/RAM/storage actuals, peak IOPS and read/write split, RPO/RTO per workload tier, 3 year growth target.`,
      `Risk areas to say out loud: overcommit ratio is a field heuristic (the guide publishes none); CVM specs should be re-validated against current portal documentation; compression and dedup are unvalidated until a POC runs on real data.`,
    ];

    const order = ['growthFactor', 'usableMultiplier', 'effectiveTbPerNode', 'storageDemandTb', 'coresDemand', 'ramDemandGb', 'nodesByStorage', 'nodesByCpu', 'nodesByRam', 'nodeFloor', 'nodeCeilingQuote'];
    return `
      <div class="card"><h3 class="card-title">The answer</h3>
        <p class="rec-headline">${esc(answer)}</p>
        <p class="dim">Binding gate: ${winner}. Pre-sizer estimate, within roughly 25 percent. Never a quote; Nutanix Sizer is the source of truth.</p>
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

  function render() {
    root.innerHTML = `
      <nav class="app-nav mono" aria-label="Calculator navigation">
        <a class="nav-item" href="#ns-estate">The estate</a>
        <a class="nav-item" href="#ns-results">The answer</a>
        <a class="nav-item" href="#ns-formulas">Every formula</a>
        <a class="nav-item" href="/howto/nutanix-sizer">Manual</a>
        <a class="nav-item" href="/">All calculators</a>
        <button type="button" class="nav-item nav-reset" data-ns-reset="1" title="Wipe inputs and begin fresh">Start over</button>
      </nav>
      <section class="a-section" id="ns-estate"><h2 class="a-title">The estate</h2>
        <p class="dim">Rough conversation sizing from the public NutaNIX field guide, appendix F. Ranges on purpose. Not a quote, not formal sizing.</p>
        <div id="ns-inputs">${inputsHtml()}</div>
      </section>
      <section id="ns-results">${resultsHtml()}</section>`;
    updateSummary();
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
    if (b?.dataset.nsReset) {
      state = structuredClone(SIZER_DEFAULTS);
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
