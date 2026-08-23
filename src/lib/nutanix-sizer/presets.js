/* Nutanix sizer front door: categories and example Customers, all grounded
   in the public NutaNIX field guide (appendix F sizing rules, appendix I
   reference architectures). Same preset-driven law as TokenOps (20c). */

const GUIDE = 'https://github.com/nixfred/nutanix/blob/main/curriculum/nutanix/appendices/appendix-f-sizing-rules.md';
const ARCH = 'https://github.com/nixfred/nutanix/blob/main/curriculum/nutanix/appendices/appendix-i-reference-architectures.md';

export const SIZER_CATEGORIES = {
  'general-virt': {
    label: 'General server virtualization',
    tagline: 'The classic estate: mixed application VMs, often a VMware exit.',
    howCommon: 'The bread-and-butter Nutanix conversation; the guide’s default sizing case.',
    commonShort: 'The guide default sizing case',
    patch: { workloadType: 'general', vcpuToPcpu: 4, compressionRatio: 1.75, dedupRatio: 1.0, cvmProfile: 'standard', rf: 'rf2', vmCount: 200, avgVcpuPerVm: 4, avgRamGbPerVm: 16, usedStorageTb: 50, growthPercentPerYear: 20, growthWindowMonths: 24 },
    assumptions: [
      { field: 'vcpuToPcpu', label: '4:1 vCPU to core ratio', why: 'Field heuristic for mixed server workloads; the guide publishes no ratio on purpose.', verify: true },
      { field: 'compressionRatio', label: '1.75x compression', why: 'Guide planning band for mixed enterprise data is 1.5 to 2.0x. Never quote marketing 4 to 6x.', verify: true },
      { field: 'rf', label: 'RF2 with N+1', why: 'The guide default for most estates. RF3 must be earned by real RTO/RPO requirements.', verify: false },
      { field: 'growthWindowMonths', label: '24 month sizing window', why: 'Size for 18 to 24 months, then add nodes (guide discipline).', verify: true },
    ],
  },
  'vdi-euc': {
    label: 'VDI and end user computing',
    tagline: 'Desktops at density: task workers to power users.',
    howCommon: 'Guide gives hard density bands: task worker 120 to 180 per node, knowledge worker 80 to 120, power user 50 to 80.',
    commonShort: 'Task worker 120 to 180 desktops per node',
    patch: { workloadType: 'vdi', vcpuToPcpu: 4, compressionRatio: 1.75, dedupRatio: 3.0, cvmProfile: 'heavy', rf: 'rf2', vmCount: 500, avgVcpuPerVm: 2, avgRamGbPerVm: 8, usedStorageTb: 30, growthPercentPerYear: 10, growthWindowMonths: 24 },
    assumptions: [
      { field: 'dedupRatio', label: '3x dedup', why: 'Non-persistent VDI dedups 3 to 5x per the guide; 3 is the conservative end. Persistent profiles dedup less.', verify: true },
      { field: 'avgVcpuPerVm', label: '2 vCPU / 8 GB per desktop', why: 'The guide’s task-to-knowledge worker profile. Power users run 4/16 and halve density.', verify: true },
      { field: 'cvmProfile', label: 'Heavy CVM', why: 'Dedup enabled pushes CVM RAM toward 64 GB per the guide.', verify: false },
    ],
  },
  'database': {
    label: 'Business critical databases',
    tagline: 'SQL, Oracle, and the workloads that get people fired.',
    howCommon: 'Guide: all-NVMe non-negotiable, p99 under 2 to 3 ms, dedicated clusters past 50 TB of DB.',
    commonShort: 'All-NVMe, p99 under 2 to 3 ms',
    patch: { workloadType: 'database', vcpuToPcpu: 2, compressionRatio: 1.5, dedupRatio: 1.0, cvmProfile: 'heavy', rf: 'rf2', vmCount: 40, avgVcpuPerVm: 8, avgRamGbPerVm: 48, usedStorageTb: 25, growthPercentPerYear: 25, growthWindowMonths: 24 },
    assumptions: [
      { field: 'vcpuToPcpu', label: '2:1 ratio for databases', why: 'Fred’s field heuristic; databases do not tolerate CPU contention.', verify: true },
      { field: 'compressionRatio', label: '1.5x compression', why: 'Guide DB band is 1.3 to 2.0x; plan low-mid.', verify: true },
      { field: 'vmCount', label: 'Cluster suggestion by DB size', why: 'Guide: 5 to 20 TB wants 6+ nodes, 20 to 50 TB wants 8+, past 50 TB dedicate the cluster.', verify: true },
    ],
  },
  'files': {
    label: 'Files (NAS consolidation)',
    tagline: 'SMB and NFS shares on the cluster instead of a filer.',
    howCommon: 'Guide bands: 3 FSVMs to 50 TB, 3 to 5 FSVMs to 200 TB, 5+ beyond; plan 20 percent overhead for snapshots and metadata.',
    commonShort: '3 FSVMs to 50 TB, 20 percent snapshot overhead',
    patch: { workloadType: 'general', vcpuToPcpu: 4, compressionRatio: 1.5, dedupRatio: 1.0, cvmProfile: 'standard', rf: 'rf2', vmCount: 12, avgVcpuPerVm: 4, avgRamGbPerVm: 16, usedStorageTb: 120, growthPercentPerYear: 25, growthWindowMonths: 24 },
    assumptions: [
      { field: 'usedStorageTb', label: 'Storage is the gate here', why: 'Files clusters bind on capacity, not CPU. The VM count models the FSVMs plus utility machines.', verify: true },
      { field: 'growthPercentPerYear', label: '25 percent file growth', why: 'Unstructured data grows faster than anyone admits. Verify against 12 months of share history.', verify: true },
    ],
  },
  'objects': {
    label: 'Objects (S3 on cluster)',
    tagline: 'Object storage for backups, data lakes, and app buckets.',
    howCommon: 'Guide: minimum 3 Object Service VMs for HA; cold data is the natural erasure coding case.',
    commonShort: 'EC-X natural case for cold data',
    patch: { workloadType: 'general', vcpuToPcpu: 4, compressionRatio: 1.2, dedupRatio: 1.0, cvmProfile: 'standard', rf: 'ecx41', vmCount: 8, avgVcpuPerVm: 4, avgRamGbPerVm: 16, usedStorageTb: 250, growthPercentPerYear: 30, growthWindowMonths: 24 },
    assumptions: [
      { field: 'rf', label: 'EC-X 4+1 instead of RF2', why: 'Cold object data earns erasure coding: 80 percent usable versus 50, at a 6 node minimum (TN-2032 corrected).', verify: true },
      { field: 'compressionRatio', label: '1.2x compression', why: 'Backup and already-compressed object data barely compresses (guide band 1.0 to 1.2x).', verify: false },
    ],
  },
  'kubernetes': {
    label: 'Kubernetes and cloud native',
    tagline: 'Worker nodes for containerized platforms.',
    howCommon: 'Guide: 3 to 5 workers for small clusters, scaling to 100+; add 20 to 30 percent for Kubernetes overhead.',
    commonShort: '3 to 5 workers, add 20 to 30 percent overhead',
    patch: { workloadType: 'general', vcpuToPcpu: 4, compressionRatio: 1.5, dedupRatio: 1.0, cvmProfile: 'standard', rf: 'rf2', vmCount: 24, avgVcpuPerVm: 4, avgRamGbPerVm: 16, usedStorageTb: 20, growthPercentPerYear: 30, growthWindowMonths: 18 },
    assumptions: [
      { field: 'growthPercentPerYear', label: '30 percent growth, 18 month window', why: 'Container platforms sprawl; the guide overhead rule (20 to 30 percent) is baked into the VM sizing here.', verify: true },
    ],
  },
  'robo-edge': {
    label: 'ROBO and edge sites',
    tagline: 'Small sites, small clusters, sometimes one or two nodes.',
    howCommon: 'Guide: 1 and 2 node clusters are supported with specific licensing and feature limits; 3 nodes is the production floor elsewhere.',
    commonShort: '1 and 2 node clusters supported at the edge',
    patch: { workloadType: 'general', vcpuToPcpu: 4, compressionRatio: 1.75, dedupRatio: 1.0, cvmProfile: 'light', rf: 'rf2', vmCount: 25, avgVcpuPerVm: 2, avgRamGbPerVm: 8, usedStorageTb: 8, growthPercentPerYear: 10, growthWindowMonths: 24, nodeCores: 16, nodeRamGb: 384, nodeRawTb: 15.36 },
    assumptions: [
      { field: 'nodeCores', label: 'Smaller node profile', why: 'Edge boxes run 16 core / 384 GB class hardware, not datacenter monsters.', verify: true },
      { field: 'cvmProfile', label: 'Light CVM', why: 'Low IOPS small clusters run the 8 vCPU / 32 GB controller footprint.', verify: false },
    ],
  },
  'dr-target': {
    label: 'DR target cluster',
    tagline: 'The other site: sized against the primary, not from scratch.',
    howCommon: 'Guide: warm DR runs 50 to 100 percent of primary, the working rule is 60 to 80 percent for steady-state DR.',
    commonShort: 'Warm DR runs 60 to 80 percent of primary',
    patch: { workloadType: 'general', vcpuToPcpu: 5, compressionRatio: 1.75, dedupRatio: 1.0, cvmProfile: 'standard', rf: 'rf2', vmCount: 140, avgVcpuPerVm: 4, avgRamGbPerVm: 16, usedStorageTb: 50, growthPercentPerYear: 15, growthWindowMonths: 24, usagePattern: 'steady' },
    assumptions: [
      { field: 'vmCount', label: 'Enter about 70 percent of the primary estate', why: 'The guide’s 60 to 80 percent DR sizing rule; failover does not need day-one full performance for every tier.', verify: true },
      { field: 'vcpuToPcpu', label: 'Looser 5:1 ratio', why: 'A DR target tolerates more contention until the day it does not; make the Customer say which tiers must run full speed.', verify: true },
    ],
  },
  'backup-repo': {
    label: 'Backup repository',
    tagline: 'Storage-heavy target for backup workloads.',
    howCommon: 'Guide: storage-only and storage-heavy nodes are full cluster citizens; backup data is the EC-X 4+2 natural case.',
    commonShort: 'EC-X 4+2 natural case, storage-heavy nodes',
    patch: { workloadType: 'general', vcpuToPcpu: 6, compressionRatio: 1.2, dedupRatio: 1.0, cvmProfile: 'standard', rf: 'ecx42', vmCount: 6, avgVcpuPerVm: 4, avgRamGbPerVm: 16, usedStorageTb: 400, growthPercentPerYear: 25, growthWindowMonths: 24 },
    assumptions: [
      { field: 'rf', label: 'EC-X 4+2', why: 'Two-failure tolerance on cold data at 67 percent usable, 7 node minimum. Backup data compresses and dedups poorly (already processed upstream).', verify: true },
    ],
  },
};

/* Example Customers, anchored to the guide's own appendix I reference
   architectures: Small = 6-8 nodes / 100-250 VMs / 30-60 TB usable;
   Medium = 12-16 nodes / 400-800 VMs / 100-200 TB;
   Large = 16-32 nodes per cluster / 1,500-5,000+ VMs / 500 TB-2 PB. */
export const SIZER_PERSONAS = [
  {
    tier: 'small',
    companyName: 'Beacon Ridge Credit Union',
    industry: 'Regional financial services (14 branches)',
    story: 'Beacon Ridge runs 180 VMs of core banking adjacency: file, print, a small SQL estate, and the member services desktop pool. The VMware renewal tripled and the board said find another answer. They want one cluster, boring and reliable, sized for the next two years of steady growth with no science projects.',
    inputs: { workloadType: 'general', vmCount: 180, avgVcpuPerVm: 3, avgRamGbPerVm: 12, usedStorageTb: 45, growthPercentPerYear: 15, growthWindowMonths: 24, rf: 'rf2', vcpuToPcpu: 4, compressionRatio: 1.75, dedupRatio: 1.0, cvmProfile: 'standard' },
    variableNotes: [
      { variable: 'vmCount', value: '180', meaning: 'The whole estate off the RVTools export, utility VMs included.', drives: 'With average vCPU it sets core demand and lands this squarely in the guide’s Small reference architecture of 6 to 8 nodes.' },
      { variable: 'avgVcpuPerVm', value: '3', meaning: 'Mixed light servers pull the average under the default 4.', drives: 'Core demand: 180 x 3 / 4:1 overcommit is 135 cores before headroom, usually the binding gate in this tier.' },
      { variable: 'usedStorageTb', value: '45', meaning: 'Actual used, not provisioned; thin provisioning inflates provisioned numbers badly.', drives: 'Against RF2 and the 75 percent ceiling this fits the Small architecture’s 30 to 60 TB usable band exactly.' },
      { variable: 'rf', value: 'RF2', meaning: 'One node can fail with data protected; the backup layer covers deeper disasters.', drives: 'Halves raw capacity. RF3 would push the node count up for protection this Customer’s RPO does not demand.' },
      { variable: 'growthPercentPerYear', value: '15', meaning: 'Branch count is flat; growth is organic data creep.', drives: 'Compounds to 1.32x over the window and is the difference between fitting 6 nodes comfortably or thin.' },
    ],
    groundedIn: 'Appendix I Small reference architecture (6 to 8 nodes, 100 to 250 VMs, 30 to 60 TB usable, 25GbE).',
  },
  {
    tier: 'medium',
    companyName: 'Cardinal Freight Systems',
    industry: 'Regional logistics and freight (three DCs, one main site)',
    story: 'Cardinal runs 600 VMs across dispatch, telematics ingestion, a heavy SQL tier for load boards, and a 250 seat knowledge worker VDI pool. IT is five people, so operational simplicity beats every clever architecture. They are consolidating two aging clusters into one platform and want the honest node range before the vendor pitch meeting next week.',
    inputs: { workloadType: 'general', vmCount: 600, avgVcpuPerVm: 4, avgRamGbPerVm: 16, usedStorageTb: 150, growthPercentPerYear: 20, growthWindowMonths: 24, rf: 'rf2', vcpuToPcpu: 4, compressionRatio: 1.75, dedupRatio: 1.0, cvmProfile: 'standard' },
    variableNotes: [
      { variable: 'vmCount', value: '600', meaning: 'The consolidated estate across both old clusters.', drives: 'Places this in the guide’s Medium reference architecture: 12 to 16 nodes, 400 to 800 VMs.' },
      { variable: 'usedStorageTb', value: '150', meaning: 'Telematics history is the pig: sensor data nobody deletes.', drives: 'Right in the Medium band of 100 to 200 TB usable; watch the growth rate more than the base.' },
      { variable: 'avgRamGbPerVm', value: '16', meaning: 'SQL tier pulls the average up; most VMs are lighter.', drives: 'RAM demand of 9.6 TB plus growth is why the RAM gate competes with CPU in this tier.' },
      { variable: 'cvmProfile', value: 'Standard (12/48)', meaning: 'The canonical controller footprint per node.', drives: 'Across 14 nodes that is 168 vCPU and 672 GB reserved before a single guest boots. Say it out loud before the competitor does.' },
      { variable: 'growthWindowMonths', value: '24', meaning: 'The guide’s discipline: size two years, then add nodes.', drives: 'Sizing five years buys idle hardware; the platform scales by adding nodes when growth actually arrives.' },
    ],
    groundedIn: 'Appendix I Medium reference architecture (12 to 16 nodes, 400 to 800 VMs, 100 to 200 TB usable).',
  },
  {
    tier: 'large',
    companyName: 'Meridian Health Network',
    industry: 'Hospital system (4 hospitals, 30 clinics)',
    story: 'Meridian runs 2,400 VMs: EHR adjacency, imaging index tiers, a big clinical VDI estate, and hundreds of departmental applications nobody remembers deploying. Compliance wants residency and audit trails, operations wants fewer platforms, and the CIO wants a defensible multi-cluster plan rather than one giant blast radius. This model sizes the primary general estate cluster; VDI and DR run their own math.',
    inputs: { workloadType: 'general', vmCount: 2400, avgVcpuPerVm: 4, avgRamGbPerVm: 20, usedStorageTb: 700, growthPercentPerYear: 20, growthWindowMonths: 24, rf: 'rf2', vcpuToPcpu: 4, compressionRatio: 1.75, dedupRatio: 1.0, cvmProfile: 'heavy' },
    variableNotes: [
      { variable: 'vmCount', value: '2,400', meaning: 'The general estate only; VDI and DR are separate clusters and separate runs of this sizer.', drives: 'The guide’s Large architecture and its blast-radius rule: past about 32 nodes, split clusters on purpose.' },
      { variable: 'usedStorageTb', value: '700', meaning: 'Imaging indexes and EHR adjacency dominate; the PACS archive itself lives elsewhere.', drives: 'Inside the Large band of 500 TB to 2 PB; at this scale the storage gate and the reservation percentage move whole nodes.' },
      { variable: 'cvmProfile', value: 'Heavy (16/64)', meaning: 'Dense IOPS and large cluster push the controller to the heavy footprint.', drives: 'The honest hyperconvergence tax at scale: over 30 nodes that is 480+ vCPU reserved for storage services.' },
      { variable: 'rf', value: 'RF2, argued', meaning: 'Compliance reflexively asks for RF3; the guide says make the RTO/RPO case first.', drives: 'RF3 here means roughly 50 percent more raw capacity for the same data. Flip the selector in the meeting and let them watch the node range jump.' },
      { variable: 'avgRamGbPerVm', value: '20', meaning: 'Healthcare apps are memory pigs.', drives: '48 TB of RAM demand plus growth makes RAM the binding gate; healthcare clusters are bought by the gigabyte.' },
    ],
    groundedIn: 'Appendix I Large reference architecture (16 to 32 nodes per cluster, 1,500 to 5,000+ VMs, 500 TB to 2 PB) plus the blast-radius guidance in appendix F.',
  },
];

export const SIZER_SOURCE_LINKS = { guide: GUIDE, arch: ARCH };
