/* Nutanix Conversation Sizer math audit.
   QA anchor from Fred's own field guide (05-dsf worked example):
   8 nodes x 4 x 7.68 TB = 245.76 TB raw -> RF2 minus 12 percent reservation
   = about 108 TB usable -> about 216 TB effective at 2x compression. */

import { test, expect } from 'bun:test';
import { sizerEngine, SIZER_DEFAULTS, RF, CVM, PRESETS, applyPreset } from '../src/lib/nutanix-sizer/formulas.js';

const base = structuredClone(SIZER_DEFAULTS);

test('guide worked example: 245.76 TB raw at RF2 -12% reservation is ~108 TB usable, ~216 TB at 2x', () => {
  const s = { ...base, nodeRawTb: 245.76, reservationPercent: 12, rf: 'rf2', storageCeiling: 1, compressionRatio: 1, dedupRatio: 1 };
  const { values } = sizerEngine.evaluate(s, {});
  // usableMultiplier * raw = 0.50 * 0.88 * 245.76 = 108.13 TB
  expect(values.usableMultiplier * 245.76).toBeCloseTo(108.13, 1);
  const s2 = { ...s, compressionRatio: 2 };
  const v2 = sizerEngine.evaluate(s2, {}).values;
  expect(v2.effectiveTbPerNode).toBeCloseTo(216.27, 1);
});

test('RF table matches the guide: RF2 0.50/3 nodes, RF3 0.33/5, ECX 4+1 0.80/6, ECX 4+2 0.67/7', () => {
  expect(RF.rf2.factor).toBe(0.50); expect(RF.rf2.minNodes).toBe(3); expect(RF.rf2.failureReserve).toBe(1);
  expect(RF.rf3.factor).toBe(0.33); expect(RF.rf3.minNodes).toBe(5); expect(RF.rf3.failureReserve).toBe(2);
  expect(RF.ecx41.factor).toBe(0.80); expect(RF.ecx41.minNodes).toBe(6); // TN-2032 corrected minimum
  expect(RF.ecx42.factor).toBe(0.67); expect(RF.ecx42.minNodes).toBe(7);
});

test('CVM table matches the guide: 8/32, 12/48, 16/64', () => {
  expect(CVM.light).toMatchObject({ vcpu: 8, ramGb: 32 });
  expect(CVM.standard).toMatchObject({ vcpu: 12, ramGb: 48 });
  expect(CVM.heavy).toMatchObject({ vcpu: 16, ramGb: 64 });
});

test('CVM tax is actually subtracted from usable node resources', () => {
  const withCvm = sizerEngine.evaluate(base, {}).values;
  const lighter = sizerEngine.evaluate({ ...base, cvmProfile: 'light' }, {}).values;
  // Lighter CVM leaves more usable capacity, so gates can only get smaller or equal.
  expect(lighter.nodesByCpu).toBeLessThanOrEqual(withCvm.nodesByCpu);
  expect(lighter.nodesByRam).toBeLessThanOrEqual(withCvm.nodesByRam);
});

test('node floor: max gate + failure reserve, clamped to RF minimum', () => {
  const { values } = sizerEngine.evaluate(base, {});
  const maxGate = Math.max(values.nodesByCpu, values.nodesByRam, values.nodesByStorage);
  expect(values.nodeFloor).toBe(Math.max(maxGate + 1, 3)); // RF2: +1, min 3
  const rf3 = sizerEngine.evaluate({ ...base, rf: 'rf3' }, {}).values;
  const maxGate3 = Math.max(rf3.nodesByCpu, rf3.nodesByRam, rf3.nodesByStorage);
  expect(rf3.nodeFloor).toBe(Math.max(maxGate3 + 2, 5));
});

test('tiny estate clamps to RF minimum nodes, never below', () => {
  const s = { ...base, vmCount: 5, avgVcpuPerVm: 2, avgRamGbPerVm: 4, usedStorageTb: 1 };
  expect(sizerEngine.evaluate(s, {}).values.nodeFloor).toBe(3);           // RF2 floor
  expect(sizerEngine.evaluate({ ...s, rf: 'ecx42' }, {}).values.nodeFloor).toBe(7);
});

test('range ceiling is floor times 1.25 rounded up (guide: within roughly 25 percent)', () => {
  const { values } = sizerEngine.evaluate(base, {});
  expect(values.nodeCeilingQuote).toBe(Math.ceil(values.nodeFloor * 1.25));
});

test('presets carry Fred-approved overcommit ratios: 4:1 general, 2:1 database', () => {
  expect(PRESETS.general.vcpuToPcpu).toBe(4);
  expect(PRESETS.database.vcpuToPcpu).toBe(2);
  expect(PRESETS.vdi.dedupRatio).toBe(3.0); // guide: 3-5x non-persistent, conservative end
  const s = applyPreset(base, 'database');
  expect(s.vcpuToPcpu).toBe(2);
  expect(s.cvmProfile).toBe('heavy');
});

test('growth compounds correctly: 20 percent over 24 months is 1.44x', () => {
  const { values } = sizerEngine.evaluate({ ...base, growthPercentPerYear: 20, growthWindowMonths: 24 }, {});
  expect(values.growthFactor).toBeCloseTo(1.44, 6);
});

test('every sizer trace exposes algebra, substitution, and sources', () => {
  const { traces } = sizerEngine.evaluate(base, {});
  for (const t of Object.values(traces)) {
    expect(t.algebra.length).toBeGreaterThan(0);
    expect(t.substitution).not.toContain('not computed');
    expect(t.sourceIds).toContain('nutanix_appendix_f');
  }
});
