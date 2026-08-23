/* Test fixture builder: produces real .xlsx bytes for the importer tests.
   Synthetic data only, shaped to the VERIFIED schemas:
   1. Collector 6.1 vmList/Metadata columns per the official User Guide.
   2. RVTools vInfo/vMetaData columns per RvToolsMerge (MIT) mappings.
   Uses inline strings so no sharedStrings table is needed, plus one shared
   string exercised deliberately in the Collector fixture to cover that path. */

import { zipSync, strToU8 } from 'fflate';

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colLetter(i) {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function sheetXml(rows, sharedLookup) {
  const body = rows.map((cells, ri) => {
    const cs = cells.map((v, ci) => {
      if (v === null || v === undefined) return '';
      const ref = `${colLetter(ci)}${ri + 1}`;
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
      if (sharedLookup && sharedLookup.has(v)) return `<c r="${ref}" t="s"><v>${sharedLookup.get(v)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cs}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function makeXlsx(sheets, sharedStrings = []) {
  const sharedLookup = new Map(sharedStrings.map((s, i) => [s, i]));
  const names = Object.keys(sheets);
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
${names.map((n, i) => `<sheet name="${escXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n')}
</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rIdSS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`,
    'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings.map((s) => `<si><t xml:space="preserve">${escXml(s)}</t></si>`).join('')}</sst>`,
  };
  names.forEach((n, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheets[n], sharedLookup)); });
  for (const k of Object.keys(files)) if (typeof files[k] === 'string') files[k] = strToU8(files[k]);
  return zipSync(files);
}

/* ---------- the two canonical fixtures ---------- */

const COLLECTOR_VMLIST_HEADER = ['VM Name', 'Sizing Enabled', 'Power State', 'vCPUs', 'Max CPU (MHz)', 'Memory (MiB)', 'Thin Provisioned', 'Capacity (MiB)', 'Consumed (MiB)', 'Datastore', 'Storage Container', 'Connection State', 'Volume Group Attached', 'Volume Group Capacity (MiB)', 'Volume Group Consumed (MiB)', 'Target Cluster', 'Guest OS', 'Template', 'Host', 'Cluster Name', 'Datacenter Name'];

/* 10 rows: 6 counted (one with a volume group), 2 powered off, 1 template,
   1 Sizing Enabled = No. Hand-check totals used by the unit tests:
   included vCPUs 4+8+2+4+16+2 = 36 -> avg 6.0
   included RAM MiB 8192+16384+4096+8192+65536+4096 = 106496 -> /1024/6 = 17.3 GB
   included Consumed MiB 512000+1024000+256000+512000+4096000+128000 = 6528000
     plus volume group 2048000 = 8576000 MiB -> x 1.048576e-6 = 9.0 TB */
export function collectorFixture() {
  const rows = [
    COLLECTOR_VMLIST_HEADER,
    ['app-web-01', 'Yes', 'poweredOn', 4, 9600, 8192, 'Yes', 1024000, 512000, 'ds01', 'ctr01', 'connected', 'No', 0, 0, 'clusterA', 'Rocky Linux 9', 'No', 'host1', 'ClusterA', 'DC1'],
    ['app-db-01', 'Yes', 'poweredOn', 8, 19200, 16384, 'No', 2048000, 1024000, 'ds01', 'ctr01', 'connected', 'Yes', 4096000, 2048000, 'clusterA', 'Windows Server 2022', 'No', 'host1', 'ClusterA', 'DC1'],
    ['app-util-01', 'Yes', 'on', 2, 4800, 4096, 'Yes', 512000, 256000, 'ds02', 'ctr01', 'connected', 'No', 0, 0, 'clusterA', 'Ubuntu 24.04', 'No', 'host2', 'ClusterA', 'DC1'],
    ['app-web-02', 'Yes', 'poweredOn', 4, 9600, 8192, 'Yes', 1024000, 512000, 'ds01', 'ctr01', 'connected', 'No', 0, 0, 'clusterA', 'Rocky Linux 9', 'No', 'host2', 'ClusterA', 'DC1'],
    ['app-erp-01', 'Yes', 'Running', 16, 38400, 65536, 'No', 8192000, 4096000, 'ds03', 'ctr02', 'connected', 'No', 0, 0, 'clusterB', 'Windows Server 2022', 'No', 'host3', 'ClusterB', 'DC1'],
    ['app-tiny-01', 'Yes', 'poweredOn', 2, 4800, 4096, 'Yes', 256000, 128000, 'ds02', 'ctr01', 'connected', 'No', 0, 0, 'clusterA', 'Debian 12', 'No', 'host2', 'ClusterA', 'DC1'],
    ['old-app-99', 'Yes', 'poweredOff', 8, 0, 32768, 'Yes', 2048000, 1536000, 'ds03', 'ctr02', 'disconnected', 'No', 0, 0, 'clusterB', 'CentOS 7', 'No', 'host3', 'ClusterB', 'DC1'],
    ['dr-standby-01', 'Yes', 'poweredOff', 4, 0, 8192, 'Yes', 1024000, 900000, 'ds01', 'ctr01', 'connected', 'No', 0, 0, 'clusterA', 'Rocky Linux 9', 'No', 'host1', 'ClusterA', 'DC1'],
    ['gold-image-w2k22', 'Yes', 'poweredOff', 4, 0, 8192, 'Yes', 512000, 480000, 'ds01', 'ctr01', 'connected', 'No', 0, 0, 'clusterA', 'Windows Server 2022', 'Yes', 'host1', 'ClusterA', 'DC1'],
    ['vdi-test-pool', 'No', 'poweredOn', 2, 4800, 4096, 'Yes', 256000, 64000, 'ds02', 'ctr01', 'connected', 'No', 0, 0, 'clusterA', 'Windows 11', 'No', 'host2', 'ClusterA', 'DC1'],
  ];
  const metadata = [
    ['Hypervisor', 'Connection Mode', 'Port', 'Platform', 'Collection Version', 'CLI Extract', 'Collection Date & Time', 'Performance Data Duration'],
    ['ESXi', 'vCenter', 443, 'Windows', '6.1', 'False', '2026-07-01 14:22:03', '7 days'],
  ];
  // One shared string on purpose: exercises the t="s" cell path.
  return makeXlsx({ vDataCenter: [['MOID', 'Name'], ['dc-1', 'DC1']], vmList: rows, Metadata: metadata }, ['Rocky Linux 9']);
}

const RVTOOLS_VINFO_HEADER = ['VM', 'Powerstate', 'Template', 'SRM Placeholder', 'CPUs', 'Memory', 'NICs', 'Disks', 'Provisioned MiB', 'In Use MiB', 'OS according to the configuration file', 'Creation date', 'Datacenter', 'Cluster', 'Host', 'VM UUID'],
  RVTOOLS_META = [
    ['RVTools major version', 'RVTools version', 'xlsx creation datetime', 'Server'],
    [4, '4.7.1', '2026-06-28 09:15:00', 'vcenter01.example.internal'],
  ];

/* 8 rows: 5 counted, 1 powered off, 1 template, 1 SRM placeholder.
   included CPUs 2+4+8+4+2 = 20 -> avg 4.0
   included Memory MiB 4096+8192+32768+16384+4096 = 65536 -> /1024/5 = 12.8 GB
   included In Use MiB 200000+400000+2400000+800000+150000 = 3950000 -> 4.1 TB */
export function rvtoolsFixture() {
  const vinfo = [
    RVTOOLS_VINFO_HEADER,
    ['web-a', 'poweredOn', false, false, 2, 4096, 1, 2, 400000, 200000, 'Rocky Linux 9', '2024/03/02', 'DC-East', 'Prod01', 'esx01', '42aa-01'],
    ['web-b', 'poweredOn', false, false, 4, 8192, 1, 2, 800000, 400000, 'Rocky Linux 9', '2024/03/02', 'DC-East', 'Prod01', 'esx02', '42aa-02'],
    ['sql-a', 'poweredOn', false, false, 8, 32768, 2, 4, 4000000, 2400000, 'Windows Server 2022', '2023/11/12', 'DC-East', 'Prod01', 'esx03', '42aa-03'],
    ['file-a', 'poweredOn', false, false, 4, 16384, 1, 3, 1600000, 800000, 'Windows Server 2022', '2023/05/20', 'DC-East', 'Prod01', 'esx01', '42aa-04'],
    ['tools-a', 'poweredOn', false, false, 2, 4096, 1, 1, 300000, 150000, 'Ubuntu 24.04', '2025/01/15', 'DC-East', 'Prod01', 'esx02', '42aa-05'],
    ['legacy-x', 'poweredOff', false, false, 4, 8192, 1, 2, 900000, 850000, 'CentOS 7', '2019/04/01', 'DC-East', 'Prod01', 'esx03', '42aa-06'],
    ['tmpl-w2k22', 'poweredOff', true, false, 4, 8192, 1, 1, 500000, 480000, 'Windows Server 2022', '2023/01/01', 'DC-East', 'Prod01', 'esx01', '42aa-07'],
    ['srm-ph-01', 'poweredOff', false, true, 2, 4096, 1, 1, 100000, 1000, 'Rocky Linux 9', '2024/06/06', 'DC-East', 'Prod01', 'esx02', '42aa-08'],
  ];
  return makeXlsx({ vInfo: vinfo, vCPU: [['VM', 'CPUs'], ['web-a', 2]], vMetaData: RVTOOLS_META });
}
