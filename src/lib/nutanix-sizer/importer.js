/* Estate file import: Nutanix Collector and RVTools .xlsx exports, parsed
   entirely in the browser. The file NEVER leaves the machine (site law:
   no logins, no saved Customer data, all calculation client side).

   Schema ground truth:
   1. Collector 6.1 export sheets and vmList columns verified against the
      official Nutanix Collector User Guide (portal.nutanix.com, rendered
      2026-07-04). vmList is the consolidated sheet Sizer itself consumes.
   2. RVTools vInfo columns cross-validated against RvToolsMerge column
      mappings (MIT) and two independent parser projects.

   Parsing is deliberately DOM-free (no DOMParser) so the identical code
   runs under bun test. An .xlsx is a zip of XML; fflate unzips, and the
   small readers below walk only the elements we need. This is NOT a
   general xlsx reader and does not try to be one. */

import { unzipSync } from 'fflate';

const dec = new TextDecoder();

/* ---------- tiny XML helpers (machine-generated OOXML only) ---------- */

function xmlUnescape(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`));
  return m ? xmlUnescape(m[1]) : null;
}

/* Collect the text of every <t> inside a fragment (plain and rich runs). */
function tText(fragment) {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(fragment)) !== null) out += xmlUnescape(m[1] ?? '');
  return out;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(tText(m[1] ?? ''));
  return out;
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    if (ch < 'A' || ch > 'Z') break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/* Sheet XML to array-of-row-arrays. Cell types handled: shared string (s),
   inline string (inlineStr), formula string (str), boolean (b), number. */
function sheetRows(xml, shared) {
  const rows = [];
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  const cellRe = /<c(\s[^>]*)?\/>|<c(\s[^>]*)?>([\s\S]*?)<\/c>/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      const tag = cm[1] ?? cm[2] ?? '';
      const body = cm[3] ?? '';
      const ref = attr(`<c${tag}>`, 'r');
      const type = attr(`<c${tag}>`, 't');
      const idx = ref ? colIndex(ref) : cells.length;
      let value = null;
      if (type === 'inlineStr') {
        value = tText(body);
      } else {
        const vm = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
        const raw = vm ? xmlUnescape(vm[1]) : null;
        if (raw === null) value = null;
        else if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'b') value = raw === '1';
        else if (type === 'str') value = raw;
        else value = Number(raw);
      }
      cells[idx] = value;
    }
    rows.push(cells);
  }
  return rows;
}

/* ---------- workbook: sheet names to parsed rows ---------- */

export function parseWorkbook(bytes) {
  let files;
  try {
    files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch {
    throw new Error('Not a readable .xlsx file. Export from Collector or RVTools without renaming the contents.');
  }
  const read = (path) => (files[path] ? dec.decode(files[path]) : null);
  const wb = read('xl/workbook.xml');
  if (!wb) throw new Error('No workbook found inside the file. Is this really an .xlsx export?');

  const rels = {};
  const relXml = read('xl/_rels/workbook.xml.rels') ?? '';
  const relRe = /<Relationship\s[^>]*\/>|<Relationship\s[^>]*>/g;
  let rm;
  while ((rm = relRe.exec(relXml)) !== null) {
    const id = attr(rm[0], 'Id');
    let target = attr(rm[0], 'Target') ?? '';
    if (target.startsWith('/')) target = target.slice(1);
    else target = 'xl/' + target;
    if (id) rels[id] = target;
  }

  const shared = parseSharedStrings(read('xl/sharedStrings.xml'));
  const sheets = {};
  const sheetRe = /<sheet\s[^>]*\/>|<sheet\s[^>]*>/g;
  let sm;
  while ((sm = sheetRe.exec(wb)) !== null) {
    const name = attr(sm[0], 'name');
    const rid = attr(sm[0], 'id');
    const path = rels[rid];
    if (!name || !path) continue;
    const xml = read(path);
    if (xml) sheets[name] = { lazy: () => sheetRows(xml, shared) };
  }
  return sheets;
}

/* ---------- shared row utilities ---------- */

const norm = (s) => String(s ?? '').trim().toLowerCase();
const compact = (s) => norm(s).replace(/[^a-z0-9]/g, '');

/* Header row to column index map, matched on normalized names. */
function headerMap(rows) {
  const header = rows[0] ?? [];
  const map = {};
  header.forEach((h, i) => { if (h != null) map[norm(h)] = i; });
  return map;
}

const ON_STATES = new Set(['poweredon', 'on', 'running', 'kon']);
const truthy = (v) => v === true || ['true', 'yes', '1'].includes(norm(v));
const num = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/* Unit conversions, stated where shown: memory MiB to GiB, presented as GB
   per field convention (DIMMs are binary). Storage MiB to decimal TB, the
   unit disks and arrays are actually sold in. */
const MIB_TO_GB = 1 / 1024;
const MIB_TO_TB = 1.048576e-6;
const round1 = (n) => Math.round(n * 10) / 10;

/* Provenance sheets (Collector Metadata, RVTools vMetaData) are a header
   row plus one data row. Returns {headerName: value}. */
function kvSheet(rows) {
  if (!rows || rows.length < 2) return {};
  const out = {};
  (rows[0] ?? []).forEach((h, i) => {
    if (h != null && rows[1]?.[i] != null && rows[1][i] !== '') out[norm(h)] = rows[1][i];
  });
  return out;
}

function findSheet(sheets, wanted) {
  const key = Object.keys(sheets).find((n) => compact(n) === compact(wanted));
  return key ? sheets[key].lazy() : null;
}

/* ---------- format detection ---------- */

export function detectFormat(sheets) {
  const names = Object.keys(sheets).map(compact);
  if (names.includes('vmlist') && names.includes('metadata')) return 'collector';
  if (names.includes('vinfo') && (names.includes('vmetadata') || !names.includes('vmlist'))) return 'rvtools';
  return null;
}

/* ---------- Nutanix Collector (vmList sheet) ---------- */

function importCollector(sheets) {
  const rows = findSheet(sheets, 'vmList');
  if (!rows || rows.length < 2) throw new Error('Collector file has no vmList rows. Re-export from Collector 4.0 or later.');
  const h = headerMap(rows);
  const need = ['vm name', 'power state', 'vcpus', 'memory (mib)', 'consumed (mib)'];
  const missing = need.filter((c) => h[c] === undefined);
  if (missing.length) throw new Error(`Collector vmList is missing expected columns: ${missing.join(', ')}. This build reads the Collector 6.x layout.`);

  const excluded = { poweredOff: 0, templates: 0, sizingDisabled: 0 };
  let vms = 0, vcpu = 0, ramMib = 0, consumedMib = 0;
  for (const r of rows.slice(1)) {
    if (r[h['vm name']] == null || r[h['vm name']] === '') continue;
    if (h['template'] !== undefined && truthy(r[h['template']])) { excluded.templates++; continue; }
    if (h['sizing enabled'] !== undefined && r[h['sizing enabled']] != null && r[h['sizing enabled']] !== '' && !truthy(r[h['sizing enabled']])) { excluded.sizingDisabled++; continue; }
    if (!ON_STATES.has(compact(r[h['power state']]))) { excluded.poweredOff++; continue; }
    vms++;
    vcpu += num(r[h['vcpus']]);
    ramMib += num(r[h['memory (mib)']]);
    consumedMib += num(r[h['consumed (mib)']]);
    if (h['volume group attached'] !== undefined && truthy(r[h['volume group attached']]) && h['volume group consumed (mib)'] !== undefined) {
      consumedMib += num(r[h['volume group consumed (mib)']]);
    }
  }
  if (vms === 0) throw new Error('No powered-on, sizing-enabled VMs found in vmList. Nothing to size.');

  const meta = kvSheet(findSheet(sheets, 'Metadata'));
  const provenance = [
    meta['collection version'] ? `Collector ${meta['collection version']}` : 'Collector export',
    meta['hypervisor'] ? `hypervisor ${meta['hypervisor']}` : null,
    meta['connection mode'] ? `via ${meta['connection mode']}` : null,
    meta['collection date & time'] ? `collected ${meta['collection date & time']}` : null,
    meta['performance data duration'] ? `${meta['performance data duration']} of performance data` : null,
  ].filter(Boolean).join(', ');

  return { format: 'collector', vms, vcpu, ramMib, consumedMib, excluded, provenance, storageBasis: 'Consumed (MiB) per VM, plus attached volume group consumption' };
}

/* ---------- RVTools (vInfo sheet) ---------- */

function importRvtools(sheets) {
  const rows = findSheet(sheets, 'vInfo');
  if (!rows || rows.length < 2) throw new Error('RVTools file has no vInfo rows. Export the full workbook from RVTools, not a single tab.');
  const h = headerMap(rows);
  const need = ['vm', 'powerstate', 'cpus', 'memory', 'in use mib'];
  const missing = need.filter((c) => h[c] === undefined);
  if (missing.length) throw new Error(`RVTools vInfo is missing expected columns: ${missing.join(', ')}. This build reads RVTools 4.x MiB-unit exports.`);

  const excluded = { poweredOff: 0, templates: 0, srmPlaceholders: 0 };
  let vms = 0, vcpu = 0, ramMib = 0, usedMib = 0;
  for (const r of rows.slice(1)) {
    if (r[h['vm']] == null || r[h['vm']] === '') continue;
    if (h['template'] !== undefined && truthy(r[h['template']])) { excluded.templates++; continue; }
    if (h['srm placeholder'] !== undefined && truthy(r[h['srm placeholder']])) { excluded.srmPlaceholders++; continue; }
    if (!ON_STATES.has(compact(r[h['powerstate']]))) { excluded.poweredOff++; continue; }
    vms++;
    vcpu += num(r[h['cpus']]);
    ramMib += num(r[h['memory']]);
    usedMib += num(r[h['in use mib']]);
  }
  if (vms === 0) throw new Error('No powered-on VMs found in vInfo. Nothing to size.');

  const meta = kvSheet(findSheet(sheets, 'vMetaData'));
  const provenance = [
    meta['rvtools version'] ? `RVTools ${meta['rvtools version']}` : 'RVTools export',
    meta['xlsx creation datetime'] ? `created ${meta['xlsx creation datetime']}` : null,
  ].filter(Boolean).join(', ');

  return { format: 'rvtools', vms, vcpu, ramMib, consumedMib: usedMib, excluded, provenance, storageBasis: 'In Use MiB per VM (datastore footprint, not provisioned size)' };
}

/* ---------- public entry ---------- */

export function importEstateFile(bytes) {
  const sheets = parseWorkbook(bytes);
  const format = detectFormat(sheets);
  if (!format) {
    throw new Error(`Not a Collector or RVTools export. Found sheets: ${Object.keys(sheets).slice(0, 6).join(', ') || 'none'}. Expected vmList plus Metadata (Collector) or vInfo (RVTools).`);
  }
  const raw = format === 'collector' ? importCollector(sheets) : importRvtools(sheets);

  const patch = {
    vmCount: raw.vms,
    avgVcpuPerVm: round1(raw.vcpu / raw.vms),
    avgRamGbPerVm: round1((raw.ramMib * MIB_TO_GB) / raw.vms),
    usedStorageTb: round1(raw.consumedMib * MIB_TO_TB),
  };

  const excludedTotal = Object.values(raw.excluded).reduce((a, b) => a + b, 0);
  return {
    format: raw.format,
    formatLabel: raw.format === 'collector' ? 'Nutanix Collector' : 'RVTools',
    provenance: raw.provenance,
    patch,
    included: raw.vms,
    excluded: raw.excluded,
    excludedTotal,
    storageBasis: raw.storageBasis,
    notes: [
      { label: `${raw.vms} powered-on VMs counted`, why: `${excludedTotal} rows excluded: ${describeExcluded(raw.excluded)}. Off VMs consume storage but no CPU or RAM; include them by editing VM count if they will be migrated.`, verify: true },
      { label: `Average vCPU ${patch.avgVcpuPerVm}, average RAM ${patch.avgRamGbPerVm} GB`, why: 'Averages across the included VMs. Memory MiB converted to GB at 1024 MiB per GB, the binary convention memory is actually built in.', verify: false },
      { label: `${patch.usedStorageTb} TB used storage`, why: `Basis: ${raw.storageBasis}. MiB converted to decimal TB, the unit storage is sold in. Provisioned-but-unwritten space is not counted.`, verify: true },
      { label: 'Workload preset still General', why: 'The file says what exists, not what it does. If this estate is VDI or database heavy, pick that pattern so overcommit and CVM assumptions match.', verify: true },
      { label: 'Growth still the default', why: 'No inventory export knows your growth plan. Set annual growth and the sizing window from the Customer conversation.', verify: true },
    ],
  };
}

function describeExcluded(e) {
  const parts = [];
  if (e.poweredOff) parts.push(`${e.poweredOff} powered off or suspended`);
  if (e.templates) parts.push(`${e.templates} templates`);
  if (e.sizingDisabled) parts.push(`${e.sizingDisabled} marked not for sizing in Collector`);
  if (e.srmPlaceholders) parts.push(`${e.srmPlaceholders} SRM placeholders`);
  return parts.join(', ') || 'none';
}
