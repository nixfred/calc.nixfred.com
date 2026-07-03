/* Nutanix Conversation Sizer. Logic from Fred's public field guide,
   appendix-f-sizing-rules.md (github.com/nixfred/nutanix). Every default is
   a labeled heuristic from the guide, or Fred's stated field ratio where the
   guide is silent (overcommit). Ranges, never point estimates.
   QA anchor from the guide's own worked example:
   8 nodes x 4 x 7.68 TB = 245.76 TB raw -> RF2 -12% reservation ~ 108 TB
   usable -> ~216 TB effective at 2x compression. */

import { makeEngine } from '../tokenops/engine.js';

export const RF = {
  rf2: { label: 'RF2', factor: 0.50, minNodes: 3, failureReserve: 1 },
  rf3: { label: 'RF3', factor: 0.33, minNodes: 5, failureReserve: 2 },
  ecx41: { label: 'EC-X 4+1', factor: 0.80, minNodes: 6, failureReserve: 1 },
  ecx42: { label: 'EC-X 4+2', factor: 0.67, minNodes: 7, failureReserve: 2 },
};

export const CVM = {
  light: { label: 'Light', vcpu: 8, ramGb: 32 },
  standard: { label: 'Standard', vcpu: 12, ramGb: 48 },
  heavy: { label: 'Heavy', vcpu: 16, ramGb: 64 },
};

/* Presets cite appendix-f. Overcommit ratios are Fred's field heuristics
   (the guide's overcommit anchor is a documented gap). */
export const PRESETS = {
  general: { label: 'General virtualization', vcpuToPcpu: 4, compressionRatio: 1.75, dedupRatio: 1.0, cvmProfile: 'standard' },
  vdi: { label: 'VDI (non-persistent)', vcpuToPcpu: 4, compressionRatio: 1.75, dedupRatio: 3.0, cvmProfile: 'heavy' },
  database: { label: 'Database', vcpuToPcpu: 2, compressionRatio: 1.5, dedupRatio: 1.0, cvmProfile: 'heavy' },
};

export const SIZER_DEFAULTS = {
  vmCount: 200,
  avgVcpuPerVm: 4,
  avgRamGbPerVm: 16,
  usedStorageTb: 50,
  workloadType: 'general',
  growthPercentPerYear: 20,
  growthWindowMonths: 24,
  rf: 'rf2',
  vcpuToPcpu: 4,
  compressionRatio: 1.75,
  dedupRatio: 1.0,
  cvmProfile: 'standard',
  nodeCores: 32,
  nodeRamGb: 768,
  nodeRawTb: 30.72,
  reservationPercent: 12,
  storageCeiling: 0.75,
  cpuCeiling: 0.70,
  ramCeiling: 0.80,
  rangePlusPercent: 25,
};

const defs = [];

defs.push({
  id: 'growthFactor', section: 'demand', unit: 'x',
  title: 'Growth factor',
  shortAnswer: 'How much the estate grows over the sizing window.',
  whyItMatters: 'The guide says size for 18 to 24 months of growth, then expand.',
  plainEnglish: 'one plus annual growth, compounded over the window',
  algebra: 'growthFactor = (1 + growthPercentPerYear/100) ^ (growthWindowMonths/12)',
  vars: (s) => [
    { symbol: 'growthPercentPerYear', label: 'Annual growth percent', value: s.growthPercentPerYear, editable: true },
    { symbol: 'growthWindowMonths', label: 'Sizing window months', value: s.growthWindowMonths, editable: true, source: 'guide default 18-24 months' },
  ],
  compute: (v) => Math.pow(1 + v.growthPercentPerYear / 100, v.growthWindowMonths / 12),
  assumptions: () => ['Size for 18 to 24 months of growth at the projected rate; beyond that plan cluster expansion (appendix-f).'],
  sourceIds: ['nutanix_appendix_f'],
});

defs.push({
  id: 'usableMultiplier', section: 'capacity', unit: 'x of raw',
  title: 'Raw to usable multiplier',
  shortAnswer: 'What fraction of raw capacity is actually usable.',
  whyItMatters: 'RF or erasure coding plus the platform capacity reservation set the floor of every storage number.',
  plainEnglish: 'the replication factor multiplier times one minus the capacity reservation',
  algebra: 'usableMultiplier = rfFactor * (1 - reservationPercent/100)',
  vars: (s) => [
    { symbol: 'rfFactor', label: `${RF[s.rf].label} multiplier`, value: RF[s.rf].factor, source: 'appendix-f raw-to-usable table' },
    { symbol: 'reservationPercent', label: 'Capacity reservation percent', value: s.reservationPercent, editable: true, source: 'guide: 10-15 percent, worked example uses 12' },
  ],
  compute: (v) => v.rfFactor * (1 - v.reservationPercent / 100),
  assumptions: (s) => [`${RF[s.rf].label}: minimum ${RF[s.rf].minNodes} nodes, tolerates ${RF[s.rf].failureReserve} node failure(s) (appendix-f).`],
  sourceIds: ['nutanix_appendix_f'],
});

defs.push({
  id: 'effectiveTbPerNode', section: 'capacity', unit: 'TB per node',
  title: 'Effective capacity per node',
  shortAnswer: 'What one node really holds after RF, reservation, headroom, and data efficiency.',
  whyItMatters: 'Raw TB on the spec sheet is not what the customer gets. This line is the honest number.',
  plainEnglish: 'raw TB per node times the usable multiplier times the 75 percent storage ceiling times compression times dedup',
  algebra: 'effectiveTbPerNode = nodeRawTb * usableMultiplier * storageCeiling * compressionRatio * dedupRatio',
  vars: (s, R) => [
    { symbol: 'nodeRawTb', label: 'Raw TB per node', value: s.nodeRawTb, editable: true },
    { symbol: 'usableMultiplier', label: 'Raw to usable', value: R.usableMultiplier, source: 'calculated above' },
    { symbol: 'storageCeiling', label: 'Storage utilization ceiling', value: s.storageCeiling, editable: true, source: 'guide: never plan past 75 percent; snapshots live inside this headroom' },
    { symbol: 'compressionRatio', label: 'Compression ratio', value: s.compressionRatio, editable: true, source: 'guide range by workload; never quote marketing 4-6x' },
    { symbol: 'dedupRatio', label: 'Dedup ratio', value: s.dedupRatio, editable: true, source: 'guide: conservative 1.0x unless VDI' },
  ],
  compute: (v) => v.nodeRawTb * v.usableMultiplier * v.storageCeiling * v.compressionRatio * v.dedupRatio,
  assumptions: () => ['Snapshot space is folded into the 75 percent storage ceiling, matching the guide.', 'Data efficiency ranges are planning numbers, validated only by a POC on real data.'],
  sourceIds: ['nutanix_appendix_f'],
});

defs.push({
  id: 'storageDemandTb', section: 'demand', unit: 'TB',
  title: 'Storage demand at end of window',
  shortAnswer: 'Logical data the cluster must hold after growth.',
  whyItMatters: 'Sizing to today fills the cluster the day the growth arrives.',
  plainEnglish: 'used storage times the growth factor',
  algebra: 'storageDemandTb = usedStorageTb * growthFactor',
  vars: (s, R) => [
    { symbol: 'usedStorageTb', label: 'Used storage today TB', value: s.usedStorageTb, editable: true },
    { symbol: 'growthFactor', label: 'Growth factor', value: R.growthFactor, source: 'calculated above' },
  ],
  compute: (v) => v.usedStorageTb * v.growthFactor,
  sourceIds: ['nutanix_appendix_f'],
});

defs.push({
  id: 'coresDemand', section: 'demand', unit: 'physical cores',
  title: 'Physical core demand',
  shortAnswer: 'Cores the VM estate needs after overcommit, before headroom.',
  whyItMatters: 'The overcommit ratio is the single biggest lever in CPU sizing, and the guide deliberately does not publish one. These ratios are field heuristics, stated as such.',
  plainEnglish: 'VM count times average vCPU, divided by the vCPU to physical core ratio, grown over the window',
  algebra: 'coresDemand = vmCount * avgVcpuPerVm / vcpuToPcpu * growthFactor',
  vars: (s, R) => [
    { symbol: 'vmCount', label: 'VM count', value: s.vmCount, editable: true },
    { symbol: 'avgVcpuPerVm', label: 'Average vCPU per VM', value: s.avgVcpuPerVm, editable: true },
    { symbol: 'vcpuToPcpu', label: 'vCPU to pCPU ratio', value: s.vcpuToPcpu, editable: true, source: 'field heuristic (4:1 general, 2:1 database, 1:1 latency critical); the guide has no published ratio' },
    { symbol: 'growthFactor', label: 'Growth factor', value: R.growthFactor, source: 'calculated above' },
  ],
  compute: (v) => v.vmCount * v.avgVcpuPerVm / v.vcpuToPcpu * v.growthFactor,
  sourceIds: ['nutanix_appendix_f'],
});

defs.push({
  id: 'ramDemandGb', section: 'demand', unit: 'GB',
  title: 'RAM demand',
  shortAnswer: 'Memory the estate needs at end of window.',
  whyItMatters: 'The guide says size RAM to the actual working set; no aggressive overcommit in production.',
  plainEnglish: 'VM count times average RAM per VM, grown over the window',
  algebra: 'ramDemandGb = vmCount * avgRamGbPerVm * growthFactor',
  vars: (s, R) => [
    { symbol: 'vmCount', label: 'VM count', value: s.vmCount },
    { symbol: 'avgRamGbPerVm', label: 'Average RAM GB per VM', value: s.avgRamGbPerVm, editable: true },
    { symbol: 'growthFactor', label: 'Growth factor', value: R.growthFactor, source: 'calculated above' },
  ],
  compute: (v) => v.vmCount * v.avgRamGbPerVm * v.growthFactor,
  assumptions: () => ['No memory overcommit assumed: size to the working set (guide, module 3).'],
  sourceIds: ['nutanix_appendix_f'],
});

defs.push({
  id: 'nodesByStorage', section: 'nodes', unit: 'nodes',
  title: 'Nodes required by storage',
  shortAnswer: 'The storage-bound node count.',
  whyItMatters: 'One of three gates; the largest wins.',
  plainEnglish: 'storage demand divided by effective capacity per node, rounded up',
  algebra: 'nodesByStorage = ceil(storageDemandTb / effectiveTbPerNode)',
  vars: (s, R) => [
    { symbol: 'storageDemandTb', label: 'Storage demand', value: R.storageDemandTb, source: 'calculated above' },
    { symbol: 'effectiveTbPerNode', label: 'Effective TB per node', value: R.effectiveTbPerNode, source: 'calculated above' },
  ],
  compute: (v) => Math.ceil(v.storageDemandTb / v.effectiveTbPerNode),
  sourceIds: ['nutanix_appendix_f'],
});

defs.push({
  id: 'nodesByCpu', section: 'nodes', unit: 'nodes',
  title: 'Nodes required by CPU',
  shortAnswer: 'The CPU-bound node count, CVM tax paid first.',
  whyItMatters: 'The CVM reserves real cores on every node before any VM runs. Honest sizing subtracts it.',
  plainEnglish: 'core demand divided by usable cores per node, where usable is node cores minus the CVM vCPUs, times the 70 percent ceiling',
  algebra: 'nodesByCpu = ceil(coresDemand / ((nodeCores - cvmVcpu) * cpuCeiling))',
  vars: (s, R) => [
    { symbol: 'coresDemand', label: 'Core demand', value: R.coresDemand, source: 'calculated above' },
    { symbol: 'nodeCores', label: 'Cores per node', value: s.nodeCores, editable: true },
    { symbol: 'cvmVcpu', label: `CVM vCPU (${CVM[s.cvmProfile].label})`, value: CVM[s.cvmProfile].vcpu, source: 'appendix-f CVM table; re-validate against portal specs' },
    { symbol: 'cpuCeiling', label: 'CPU utilization ceiling', value: s.cpuCeiling, editable: true, source: 'guide: 70 percent at peak' },
  ],
  compute: (v) => Math.ceil(v.coresDemand / ((v.nodeCores - v.cvmVcpu) * v.cpuCeiling)),
  sourceIds: ['nutanix_appendix_f'],
});

defs.push({
  id: 'nodesByRam', section: 'nodes', unit: 'nodes',
  title: 'Nodes required by RAM',
  shortAnswer: 'The memory-bound node count, CVM tax paid first.',
  whyItMatters: 'Standard CVM takes 48 GB per node before the first guest boots.',
  plainEnglish: 'RAM demand divided by usable RAM per node, where usable is node RAM minus CVM RAM, times the 80 percent ceiling',
  algebra: 'nodesByRam = ceil(ramDemandGb / ((nodeRamGb - cvmRamGb) * ramCeiling))',
  vars: (s, R) => [
    { symbol: 'ramDemandGb', label: 'RAM demand GB', value: R.ramDemandGb, source: 'calculated above' },
    { symbol: 'nodeRamGb', label: 'RAM GB per node', value: s.nodeRamGb, editable: true },
    { symbol: 'cvmRamGb', label: `CVM RAM GB (${CVM[s.cvmProfile].label})`, value: CVM[s.cvmProfile].ramGb, source: 'appendix-f CVM table' },
    { symbol: 'ramCeiling', label: 'RAM utilization ceiling', value: s.ramCeiling, editable: true, source: 'guide: 75-85 percent; 80 used' },
  ],
  compute: (v) => Math.ceil(v.ramDemandGb / ((v.nodeRamGb - v.cvmRamGb) * v.ramCeiling)),
  sourceIds: ['nutanix_appendix_f'],
});

defs.push({
  id: 'nodeFloor', section: 'nodes', unit: 'nodes',
  title: 'Node floor with failure reserve',
  shortAnswer: 'Biggest gate, plus the failure reserve, clamped to the RF minimum.',
  whyItMatters: 'RF2 means N+1; RF3 means N+2. Sizing without the reserve is sizing to fail during the first maintenance window.',
  plainEnglish: 'the largest of the three gates plus the failure reserve, never below the RF minimum node count',
  algebra: 'nodeFloor = max(max(nodesByCpu, nodesByRam, nodesByStorage) + failureReserve, rfMinNodes)',
  vars: (s, R) => [
    { symbol: 'nodesByCpu', label: 'CPU gate', value: R.nodesByCpu, source: 'calculated above' },
    { symbol: 'nodesByRam', label: 'RAM gate', value: R.nodesByRam, source: 'calculated above' },
    { symbol: 'nodesByStorage', label: 'Storage gate', value: R.nodesByStorage, source: 'calculated above' },
    { symbol: 'failureReserve', label: `Failure reserve (${RF[s.rf].label})`, value: RF[s.rf].failureReserve, source: 'appendix-f: RF2 N+1, RF3 N+2' },
    { symbol: 'rfMinNodes', label: 'RF minimum nodes', value: RF[s.rf].minNodes, source: 'appendix-f minimums' },
  ],
  compute: (v) => Math.max(Math.max(v.nodesByCpu, v.nodesByRam, v.nodesByStorage) + v.failureReserve, v.rfMinNodes),
  warn: (value, v) => {
    const gates = { CPU: v.nodesByCpu, RAM: v.nodesByRam, STORAGE: v.nodesByStorage };
    const winner = Object.entries(gates).sort((a, b) => b[1] - a[1])[0][0];
    return [{ severity: 'info', message: `Binding gate: ${winner} (CPU ${v.nodesByCpu}, RAM ${v.nodesByRam}, storage ${v.nodesByStorage}), plus ${v.failureReserve} failure reserve.` }];
  },
  sourceIds: ['nutanix_appendix_f'],
});

defs.push({
  id: 'nodeCeilingQuote', section: 'nodes', unit: 'nodes',
  title: 'Honest range ceiling',
  shortAnswer: 'The top of the quoted range.',
  whyItMatters: 'The guide is blunt: these rules land within roughly 25 percent. Quote ranges. A single number implies precision you do not have.',
  plainEnglish: 'the node floor times one plus the range percent, rounded up',
  algebra: 'nodeCeilingQuote = ceil(nodeFloor * (1 + rangePlusPercent/100))',
  vars: (s, R) => [
    { symbol: 'nodeFloor', label: 'Node floor', value: R.nodeFloor, source: 'calculated above' },
    { symbol: 'rangePlusPercent', label: 'Heuristic accuracy band', value: s.rangePlusPercent, editable: true, source: 'guide: within roughly 25 percent' },
  ],
  compute: (v) => Math.ceil(v.nodeFloor * (1 + v.rangePlusPercent / 100)),
  sourceIds: ['nutanix_appendix_f'],
});

export const sizerEngine = makeEngine(defs);

export function applyPreset(state, presetKey) {
  const p = PRESETS[presetKey];
  return { ...state, workloadType: presetKey, vcpuToPcpu: p.vcpuToPcpu, compressionRatio: p.compressionRatio, dedupRatio: p.dedupRatio, cvmProfile: p.cvmProfile };
}
