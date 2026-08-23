/* Nutanix Conversation Sizer. Logic from Fred's public field guide,
   appendix-f-sizing-rules.md (github.com/nixfred/nutanix). Every default is
   a labeled heuristic from the guide, or Fred's stated field ratio where the
   guide is silent (overcommit). Ranges, never point estimates.
   QA anchor from the guide's own worked example:
   8 nodes x 4 x 7.68 TB = 245.76 TB raw -> RF2 -12% reservation ~ 108 TB
   usable -> ~216 TB effective at 2x compression. */

import { makeEngine, fmt } from '../tokenops/engine.js';

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
  // Compression held low deliberately: heavily deduped VDI has little
  // redundancy left for compression to find, so 1.3 x 3.0 = 3.9x combined,
  // not 1.75 x 3.0 = 5.25x. The two ratios overlap on the same duplicate data.
  vdi: { label: 'VDI (non-persistent)', vcpuToPcpu: 4, compressionRatio: 1.3, dedupRatio: 3.0, cvmProfile: 'heavy' },
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
  // Fraction of data that has gone write-cold and can be erasure coded.
  // Only used when rf is an EC-X profile; hot data stays at RF2 until it
  // cools. Default 100 keeps every existing path identical.
  coldDataPercent: 100,
  // Largest single VM in the estate. 0 means unknown (manual entry) or not
  // yet imported. The biggest VM sizes the node; the averages size the
  // cluster. Populated automatically by the file importer.
  largestVmVcpu: 0,
  largestVmRamGb: 0,
};

// The RF2 factor is the fallback for hot data when EC-X is selected: hot
// extents stay two-copy until they cool enough to be encoded.
const HOT_FALLBACK_FACTOR = RF.rf2.factor;

/* When EC-X is selected, only write-cold data is actually encoded; hot data
   stays at RF2. Blend the two by the cold fraction. RF2/RF3 are unaffected. */
export function effectiveRfFactor(s) {
  const rf = RF[s.rf];
  const isEcx = s.rf === 'ecx41' || s.rf === 'ecx42';
  if (!isEcx) return rf.factor;
  const cold = Math.max(0, Math.min(100, s.coldDataPercent ?? 100)) / 100;
  return cold * rf.factor + (1 - cold) * HOT_FALLBACK_FACTOR;
}

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
  vars: (s) => {
    const isEcx = s.rf === 'ecx41' || s.rf === 'ecx42';
    const rfVar = isEcx
      ? { symbol: 'rfFactor', label: `${RF[s.rf].label} blended factor (${s.coldDataPercent ?? 100} percent cold)`, value: effectiveRfFactor(s), source: `EC-X encodes write-cold data only; blend = ${s.coldDataPercent ?? 100}% x ${RF[s.rf].factor} + ${100 - (s.coldDataPercent ?? 100)}% x ${HOT_FALLBACK_FACTOR} (RF2 for hot data)` }
      : { symbol: 'rfFactor', label: `${RF[s.rf].label} multiplier`, value: RF[s.rf].factor, source: 'appendix-f raw-to-usable table' };
    return [
      rfVar,
      { symbol: 'reservationPercent', label: 'Capacity reservation percent', value: s.reservationPercent, editable: true, source: 'guide: 10-15 percent, worked example uses 12' },
    ];
  },
  compute: (v, s) => effectiveRfFactor(s) * (1 - v.reservationPercent / 100),
  assumptions: (s) => {
    const base = [`${RF[s.rf].label}: minimum ${RF[s.rf].minNodes} nodes, tolerates ${RF[s.rf].failureReserve} node failure(s) (appendix-f).`];
    if (s.rf === 'ecx41' || s.rf === 'ecx42') {
      base.push(`EC-X applies to write-cold data only; hot data stays at RF2 until it cools. Cold fraction assumed ${s.coldDataPercent ?? 100} percent. Verify against the real workload write pattern before quoting.`);
    }
    return base;
  },
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
  warn: (value, v) => {
    const combined = v.compressionRatio * v.dedupRatio;
    if (combined > 3) {
      return [{ severity: 'caution', message: `Combined data efficiency of ${fmt(combined, 2)}x is in vendor marketing territory. Compression and dedup overlap on the same redundant data, so treat anything past 3x as unproven until a POC runs on real data.` }];
    }
    return [];
  },
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
  compute: (v) => {
    const usable = (v.nodeCores - v.cvmVcpu) * v.cpuCeiling;
    if (usable <= 0) return Infinity; // guarded in warn: CVM bigger than node
    return Math.ceil(v.coresDemand / usable);
  },
  warn: (value, v, s) => {
    const out = [];
    const usableCores = (v.nodeCores - v.cvmVcpu) * v.cpuCeiling;
    if (usableCores <= 0) {
      out.push({ severity: 'critical', message: `The ${CVM[s.cvmProfile].label} CVM reserves ${v.cvmVcpu} vCPU, which leaves no usable cores on a ${v.nodeCores} core node at the ${fmt(v.cpuCeiling * 100)} percent ceiling. Pick a larger node profile or a lighter CVM.` });
    } else if (s.largestVmVcpu > 0 && s.largestVmVcpu > usableCores) {
      out.push({ severity: 'critical', message: `Your largest VM needs ${fmt(s.largestVmVcpu)} vCPU but one node offers only ${fmt(usableCores)} usable cores after the CVM tax and the ${fmt(v.cpuCeiling * 100)} percent ceiling. A single VM past usable cores per node guarantees contention. The biggest VM sizes the node; averages size the cluster.` });
    }
    return out;
  },
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
  compute: (v) => {
    const usable = (v.nodeRamGb - v.cvmRamGb) * v.ramCeiling;
    if (usable <= 0) return Infinity; // guarded in warn: CVM bigger than node
    return Math.ceil(v.ramDemandGb / usable);
  },
  warn: (value, v, s) => {
    const out = [];
    const usableRam = (v.nodeRamGb - v.cvmRamGb) * v.ramCeiling;
    if (usableRam <= 0) {
      out.push({ severity: 'critical', message: `The ${CVM[s.cvmProfile].label} CVM reserves ${v.cvmRamGb} GB, which leaves no usable memory on a ${fmt(v.nodeRamGb)} GB node at the ${fmt(v.ramCeiling * 100)} percent ceiling. Pick a larger node profile or a lighter CVM.` });
    } else if (s.largestVmRamGb > 0 && s.largestVmRamGb > usableRam) {
      out.push({ severity: 'critical', message: `Your largest VM needs ${fmt(s.largestVmRamGb)} GB but one node offers only ${fmt(usableRam)} GB usable after the CVM tax and the ${fmt(v.ramCeiling * 100)} percent ceiling. The biggest VM sizes the node; averages size the cluster. This can force a larger node profile than the averages suggest.` });
    }
    return out;
  },
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
  warn: (value, v, s, R) => {
    const gates = { CPU: v.nodesByCpu, RAM: v.nodesByRam, STORAGE: v.nodesByStorage };
    const winner = Object.entries(gates).sort((a, b) => b[1] - a[1])[0][0];
    const out = [{ severity: 'info', message: `Binding gate: ${winner} (CPU ${v.nodesByCpu}, RAM ${v.nodesByRam}, storage ${v.nodesByStorage}), plus ${v.failureReserve} failure reserve.` }];
    // Sanity cross-check for VDI: implied desktops per node against the
    // guide's published task-worker band (120 to 180 per node). A number
    // far outside it means the estate is not really task-worker VDI, or the
    // node profile is wrong.
    if (s.workloadType === 'vdi' && value > 0) {
      const grown = s.vmCount * (R?.growthFactor ?? 1);
      const perNode = grown / value;
      if (perNode > 180) {
        out.push({ severity: 'caution', message: `Implied density is about ${fmt(perNode)} desktops per node, above the guide's task-worker band of 120 to 180. Confirm these are light task-worker desktops, not knowledge-worker or GPU-accelerated seats, which pack far fewer per node.` });
      } else if (perNode < 60) {
        out.push({ severity: 'info', message: `Implied density is about ${fmt(perNode)} desktops per node, below the guide's task-worker band. That is fine for heavier seats, but if these are light desktops the node profile may be larger than this workload needs.` });
      }
    }
    return out;
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
