/* All-HPE conversation configuration (Fred's go, 2026-07-03).
   Turns the recommended GPU count into an actual HPE parts list, WITHOUT
   pricing anything, paired with the ceiling: the whole stack must land
   under that number to be the smarter buy. Chassis facts are the verified
   hardware profiles; this is packing math plus honest labels.
   NOT a BOM for ordering: a conversation configuration. The HPE
   configurator and a formal sizing exercise produce the real one. */

import { fmt, money } from './engine.js';

const CHASSIS = {
  nvidia_rtx_pro_6000_blackwell: {
    server: 'HPE ProLiant Compute DL380a Gen12',
    perServer: 8,
    form: '4U',
    sourceId: 'hpe_dl380a_gen12',
    note: 'Up to 8 double-wide RTX PRO 6000 Blackwell per chassis (verified vendor spec).',
  },
  nvidia_h200: {
    server: 'HPE ProLiant Compute XD685',
    perServer: 8,
    form: '5U-class dense',
    sourceId: 'hpe_xd685',
    note: 'Eight H200 SXM per chassis. Ten or fewer GPUs can also land in a DL380a Gen12 with H200 NVL; the configurator decides.',
  },
  amd_mi355x: {
    server: 'HPE ProLiant Compute XD685',
    perServer: 8,
    form: '5U-class dense',
    sourceId: 'hpe_xd685',
    note: 'Eight MI355X per chassis. Validate ROCm and the serving stack before recommending (the guide law).',
  },
};

export function buildHpeConfig(state, values, ceiling, fin, hardware) {
  const gpuCount = values.recommendedGpuCount;
  if (!gpuCount || gpuCount < 1) return null;
  const hw = hardware.find((h) => h.id === state.gpuChoice);
  const chassis = CHASSIS[state.gpuChoice];
  if (!hw || !chassis) return null;
  const servers = Math.ceil(gpuCount / chassis.perServer);
  const gpuPowerKw = (gpuCount * (hw.typicalBoardPowerW ?? 0)) / 1000;
  const storageTb = values.protectedStorageTB ?? 0;
  const fabric = gpuCount <= 1
    ? 'Host networking plus a management network; no backend fabric needed.'
    : gpuCount <= chassis.perServer
      ? 'Single dense server: intra-server interconnect carries the GPU traffic; plan 100 to 400GbE for data path and storage.'
      : 'Multiple GPU servers: a dedicated 400GbE-class backend fabric is REQUIRED. HPE fabric per formal design: Aruba CX 9300 Ethernet or Juniper QFX/PTX class (both are the honest 2026 answer).';
  const budgetLine = state.gpuQuote != null && fin?.payment
    ? `Your ${money(state.gpuQuote)} quote covers this list ${fin.verdict === 'buy' ? 'and clears the bar: smarter to buy' : fin.verdict === 'negotiate' ? 'but does not clear your margin: negotiate' : 'only above the token bill: stay on tokens'}.`
    : `Everything below, all-in (servers, storage, network, services), must land under ${money(ceiling.ceilingCapex)} to be the smarter buy versus tokens. That is the number to negotiate toward.`;
  return {
    gpuCount, servers, chassis, hw, gpuPowerKw, storageTb, fabric, budgetLine,
    lines: [
      { qty: servers, item: chassis.server, detail: `${chassis.form}, ${Math.min(chassis.perServer, gpuCount)}x ${hw.vendor} ${hw.name} each${servers > 1 ? `, ${gpuCount} GPUs total` : ''}`, sourceId: chassis.sourceId },
      { qty: 1, item: 'HPE Alletra Storage MP B10000', detail: `sized to about ${fmt(storageTb, 1)} TB protected (models, vectors, traces at your retention)`, sourceId: 'hpe_alletra_mp' },
      { qty: 1, item: 'HPE AI fabric (Aruba CX 9300 / Juniper QFX-PTX)', detail: fabric, sourceId: 'hpe_networking_ai' },
    ],
    alt: 'The integrated version of this configuration is HPE Private Cloud AI, already scored on your route board.',
    caveats: [
      'A conversation configuration, not an orderable BOM. Head nodes, risers, power, and services come from the HPE configurator and a formal sizing pass.',
      `GPU board power alone is roughly ${fmt(gpuPowerKw, 1)} kW (ESTIMATE, GPUs only; whole-rack power is higher). Capex-only economics per the settled decision.`,
      state.userBenchmarkTpsPerGpu == null ? 'GPU count rests on a labeled benchmark ESTIMATE; validate with a real benchmark before any purchase.' : null,
      'Add one server of headroom if this cluster must survive maintenance windows at full load.',
    ].filter(Boolean),
  };
}
