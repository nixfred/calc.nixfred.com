/* Importer unit tests. Fixtures are built to the VERIFIED schemas
   (Collector 6.1 User Guide, RVTools 4.x via RvToolsMerge mappings) and
   every expected number below is hand-computed in the fixture comments. */

import { describe, test, expect } from 'bun:test';
import { importEstateFile, parseWorkbook, detectFormat, scopeResult } from '../src/lib/nutanix-sizer/importer.js';
import { collectorFixture, rvtoolsFixture, makeXlsx } from './helpers/make-xlsx.js';

describe('format detection', () => {
  test('Collector detected by vmList + Metadata', () => {
    expect(detectFormat(parseWorkbook(collectorFixture()))).toBe('collector');
  });
  test('RVTools detected by vInfo', () => {
    expect(detectFormat(parseWorkbook(rvtoolsFixture()))).toBe('rvtools');
  });
  test('unrelated workbook is rejected loudly', () => {
    const junk = makeXlsx({ Sheet1: [['a', 'b'], [1, 2]] });
    expect(() => importEstateFile(junk)).toThrow(/Not a Collector or RVTools export/);
  });
  test('garbage bytes are rejected loudly', () => {
    expect(() => importEstateFile(new Uint8Array([1, 2, 3, 4]))).toThrow(/Not a readable \.xlsx/);
  });
});

describe('Collector vmList import', () => {
  const result = importEstateFile(collectorFixture());

  test('counts only powered-on, sizing-enabled, non-template VMs', () => {
    expect(result.included).toBe(6);
    expect(result.excluded.poweredOff).toBe(2);
    expect(result.excluded.templates).toBe(1);
    expect(result.excluded.sizingDisabled).toBe(1);
  });
  test('derived averages match hand math', () => {
    expect(result.patch.vmCount).toBe(6);
    expect(result.patch.avgVcpuPerVm).toBe(6.0);       // 36 vCPU / 6
    expect(result.patch.avgRamGbPerVm).toBe(17.3);      // 106496 MiB / 1024 / 6
  });
  test('storage sums Consumed plus attached volume groups, in decimal TB', () => {
    expect(result.patch.usedStorageTb).toBe(9.0);       // 8576000 MiB x 1.048576e-6
  });
  test('provenance carries version, hypervisor, window', () => {
    expect(result.provenance).toContain('Collector 6.1');
    expect(result.provenance).toContain('ESXi');
    expect(result.provenance).toContain('7 days');
  });
  test('every note the landing shows exists and flags the real leaps', () => {
    const labels = result.notes.map((n) => n.label).join(' | ');
    expect(labels).toContain('6 powered-on VMs');
    expect(labels).toContain('Workload preset still General');
    expect(labels).toContain('Growth still the default');
    expect(result.notes.filter((n) => n.verify).length).toBeGreaterThanOrEqual(3);
  });
});

describe('RVTools vInfo import', () => {
  const result = importEstateFile(rvtoolsFixture());

  test('counts exclude powered off, templates, SRM placeholders', () => {
    expect(result.included).toBe(5);
    expect(result.excluded.poweredOff).toBe(1);
    expect(result.excluded.templates).toBe(1);
    expect(result.excluded.srmPlaceholders).toBe(1);
  });
  test('derived numbers match hand math', () => {
    expect(result.patch.vmCount).toBe(5);
    expect(result.patch.avgVcpuPerVm).toBe(4.0);        // 20 / 5
    expect(result.patch.avgRamGbPerVm).toBe(12.8);      // 65536 MiB / 1024 / 5
    expect(result.patch.usedStorageTb).toBe(4.1);       // 3950000 MiB x 1.048576e-6
  });
  test('storage basis is In Use, stated', () => {
    expect(result.storageBasis).toContain('In Use MiB');
  });
  test('provenance names RVTools and version', () => {
    expect(result.provenance).toContain('RVTools 4.7.1');
  });
});

describe('multi-cluster, largest VM, provisioned, integrity', () => {
  const result = importEstateFile(collectorFixture());

  test('the fixture is detected as two clusters and can be scoped to one', () => {
    expect(result.clusters.map((c) => c.name).sort()).toEqual(['ClusterA', 'ClusterB']);
    expect(result.included).toBe(6); // all combined by default
    const b = scopeResult(result.raw, 'ClusterB');
    expect(b.included).toBe(1);               // only app-erp-01
    expect(b.patch.avgVcpuPerVm).toBe(16);
    expect(b.notes.some((n) => /spans 2 clusters/.test(n.label))).toBe(true);
  });

  test('largest VM is surfaced for the fit-node check', () => {
    expect(result.patch.largestVmVcpu).toBe(16);   // app-erp-01
    expect(result.patch.largestVmRamGb).toBe(64);  // 65536 MiB
    expect(result.notes.some((n) => /Largest VM/.test(n.label))).toBe(true);
  });

  test('provisioned is summed alongside used and shown, but used drives sizing', () => {
    expect(result.provisionedTb).toBeGreaterThan(result.patch.usedStorageTb);
    const storageNote = result.notes.find((n) => /used storage/.test(n.label));
    expect(storageNote.why).toMatch(/provisioned/);
  });

  test('blank cells and duplicate names are counted, not silently zeroed', () => {
    const dirty = makeXlsx({
      vInfo: [
        ['VM', 'Powerstate', 'CPUs', 'Memory', 'In Use MiB', 'Cluster'],
        ['a', 'poweredOn', 2, 4096, 200000, 'Prod'],
        ['a', 'poweredOn', 2, 4096, 200000, 'Prod'],   // duplicate name
        ['b', 'poweredOn', 4, '', 300000, 'Prod'],      // blank memory
        ['c', 'poweredOn', 2, 4096, '', 'Prod'],        // blank storage
      ],
    });
    const r = importEstateFile(dirty);
    expect(r.included).toBe(4);
    expect(r.integrity.duplicateNames).toBe(1);
    expect(r.integrity.blankRam).toBe(1);
    expect(r.integrity.blankStorage).toBe(1);
    expect(r.notes.some((n) => /Data quality flags/.test(n.label))).toBe(true);
  });

  test('a Collector JSON drop gets a helpful pointer, not a zip error', () => {
    const json = new TextEncoder().encode('{"vmList": []}');
    expect(() => importEstateFile(json)).toThrow(/Collector JSON export/);
  });

  test('pre-4.1 RVTools MB headers are accepted with a provenance note', () => {
    const legacy = makeXlsx({
      vInfo: [
        ['VM', 'Powerstate', 'CPUs', 'Memory', 'In Use MB'],
        ['a', 'poweredOn', 2, 4096, 1000000],
      ],
    });
    const r = importEstateFile(legacy);
    expect(r.included).toBe(1);
    expect(r.patch.usedStorageTb).toBe(1.0);
    expect(r.provenance).toMatch(/legacy MB headers/);
  });
});

describe('resilience against real-world file drift', () => {
  test('missing key columns produce a named, actionable error', () => {
    const broken = makeXlsx({
      vmList: [['VM Name', 'Power State'], ['a', 'poweredOn']],
      Metadata: [['Hypervisor'], ['ESXi']],
    });
    expect(() => importEstateFile(broken)).toThrow(/missing expected columns: vcpus, memory \(mib\), consumed \(mib\)/);
  });
  test('all VMs powered off is an explicit error, not a zero-VM import', () => {
    const off = makeXlsx({
      vmList: [
        ['VM Name', 'Sizing Enabled', 'Power State', 'vCPUs', 'Memory (MiB)', 'Consumed (MiB)'],
        ['a', 'Yes', 'poweredOff', 2, 4096, 100000],
      ],
      Metadata: [['Hypervisor'], ['ESXi']],
    });
    expect(() => importEstateFile(off)).toThrow(/No powered-on/);
  });
  test('boolean cells and Yes/No strings both count as flags', () => {
    const mixed = makeXlsx({
      vInfo: [
        ['VM', 'Powerstate', 'Template', 'CPUs', 'Memory', 'In Use MiB'],
        ['a', 'poweredOn', true, 2, 4096, 100000],
        ['b', 'poweredOn', 'True', 2, 4096, 100000],
        ['c', 'poweredOn', 'No', 4, 8192, 200000],
      ],
    });
    const r = importEstateFile(mixed);
    expect(r.included).toBe(1);
    expect(r.excluded.templates).toBe(2);
    expect(r.patch.avgVcpuPerVm).toBe(4);
  });
  test('shared-string cells resolve through the sst table', () => {
    // The Collector fixture writes 'Rocky Linux 9' as a t="s" shared string.
    const sheets = parseWorkbook(collectorFixture());
    const rows = sheets[Object.keys(sheets).find((n) => n === 'vmList')].lazy();
    const osCol = rows[0].indexOf('Guest OS');
    expect(rows[1][osCol]).toBe('Rocky Linux 9');
  });
  test('numbers with thousands separators still parse', () => {
    const sep = makeXlsx({
      vInfo: [
        ['VM', 'Powerstate', 'CPUs', 'Memory', 'In Use MiB'],
        ['a', 'poweredOn', 2, '4,096', '1,000,000'],
      ],
    });
    const r = importEstateFile(sep);
    expect(r.patch.avgRamGbPerVm).toBe(4);
    expect(r.patch.usedStorageTb).toBe(1.0);
  });
});
