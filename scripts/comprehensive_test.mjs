/**
 * comprehensive_test.mjs
 *
 * Runs 40 test cases (20 non-ODA + 20 ODA) across all 4 vendors,
 * comparing UTSF-calculated prices against Excel-formula-derived expected values.
 *
 * Excel formulas replicated exactly:
 *   Shipshopy : effectiveWt=MAX(wt,20), price=VLOOKUP(pin,col G), fuel=0%, docket=100
 *               ODA excess: f=500, v=3, threshold=200
 *   VL Cargo  : effectiveWt=wt (no floor), price=VLOOKUP(pin,col H), fuel=0%, docket=0
 *               ODA excess: f=500, v=3, threshold=200
 *   Safexpress: effectiveWt=MAX(wt,20), price=VLOOKUP(pin,col J), fuel=MIN(5%,400), docket+ROV=450
 *               ODA fixed=500
 *   DB Schenker: effectiveWt=MAX(wt,50), zone=VLOOKUP(pin,DBS), rateByZone, fuel=5%, docket=100
 *               ODA switch: threshold=212.5, fixed=850, var=4/kg, total=MAX(...,400)
 *
 * Run: node backend/scripts/comprehensive_test.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load Excel lookup data ────────────────────────────────────────────────
const LOOKUP_PATH = path.join(__dirname, 'excel_lookup.json');
if (!fs.existsSync(LOOKUP_PATH)) {
  console.error('ERROR: excel_lookup.json not found. Run extract_excel_lookup.py first.');
  process.exit(1);
}
const { delhivery: D, dbs: DBS_MAP, dbs_rates: DBS_RATES } = JSON.parse(
  fs.readFileSync(LOOKUP_PATH, 'utf8')
);

// ── Load UTSF service ─────────────────────────────────────────────────────
const { UTSFTransporter } = await import(
  pathToFileURL(path.join(__dirname, '../services/utsfService.js')).href
);

const UTSF_DIR     = path.join(__dirname, '../data/utsf');
const PINCODES_PATH = path.join(__dirname, '../data/pincodes.json');

const pincodeArray = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
const masterPincodes = {};
for (const e of pincodeArray) {
  const pin  = e.pincode || e.Pincode;
  const zone = e.zone    || e.Zone;
  if (pin && zone) masterPincodes[parseInt(pin, 10)] = zone.toUpperCase();
}

function loadT(id) {
  const fp = path.join(UTSF_DIR, `${id}.utsf.json`);
  if (!fs.existsSync(fp)) return null;
  return new UTSFTransporter(JSON.parse(fs.readFileSync(fp, 'utf8')), masterPincodes);
}

const SS  = loadT('6968ddedc2cf85d3f4380d52');  // Shipshopy
const DBS = loadT('67b4b800db5c000000000001');  // DB Schenker
const SFX = loadT('6870d8765f9c12f692f3b7b3');  // Safexpress
const VLC = loadT('67b4b800cf900000000000c1');  // VL Cargo

const FROM_PIN = 110020;  // fixed origin (N1, Delhi)

// ── Excel formula replication ─────────────────────────────────────────────
function excelExpected(pincode, weight) {
  const dRow = D[String(pincode)];
  if (!dRow) return null;

  const oda = dRow.oda === 'Yes';

  // -- Shipshopy
  const ssEW   = Math.max(weight, 20);
  const ssMat  = dRow.ss * ssEW;
  const ssODA  = oda ? (ssEW <= 200 ? 500 : 500 + 3 * (ssEW - 200)) : 0;
  const ssTotal = ssMat + 100 + ssODA;

  // -- VL Cargo (no minWeight floor — uses raw weight)
  const vlcMat  = (dRow.vlc ?? 0) * weight;
  const vlcODA  = oda ? (weight <= 200 ? 500 : 500 + 3 * (weight - 200)) : 0;
  const vlcTotal = vlcMat + vlcODA;

  // -- Safexpress
  const sfxEW   = Math.max(weight, 20);
  const sfxMat  = (dRow.sfx ?? 0) * sfxEW;
  const sfxFuel = Math.min(0.05 * sfxMat, 400);
  const sfxODA  = oda ? 500 : 0;
  const sfxTotal = sfxMat + sfxFuel + 450 + sfxODA;   // 450 = 350 docket + 100 ROV

  // -- DB Schenker (uses DBS pincode sheet for zone/ODA)
  let dbsTotal = null;
  let dbsODA_amt = null;
  const dbsRow = DBS_MAP[String(pincode)];
  if (dbsRow) {
    const dbsEW    = Math.max(weight, 50);
    const dbsZone  = dbsRow.zone;
    const dbsRate  = DBS_RATES[dbsZone];
    const dbsMat   = dbsRate * dbsEW;
    const dbsFuel  = 0.05 * dbsMat;
    const dbsIsODA = dbsRow.oda === 'Yes';
    // Excel uses effectiveWeight (B3) for DBS ODA threshold check
    dbsODA_amt = dbsIsODA ? (dbsEW <= 212.5 ? 850 : 4 * dbsEW) : 0;
    const raw  = dbsMat + dbsFuel + 100 + dbsODA_amt;
    dbsTotal   = Math.max(raw, 400);
  }

  return {
    oda,
    ss:  { total: Math.round(ssTotal  * 100) / 100, oda: ssODA,    ew: ssEW  },
    vlc: { total: Math.round(vlcTotal * 100) / 100, oda: vlcODA              },
    sfx: { total: Math.round(sfxTotal * 100) / 100, oda: sfxODA,   ew: sfxEW },
    dbs: dbsTotal !== null
      ? { total: Math.round(dbsTotal   * 100) / 100, oda: dbsODA_amt,
          zone: DBS_MAP[String(pincode)]?.zone, ew: Math.max(weight, 50) }
      : null,
    zone: dRow.zone,
  };
}

// ── UTSF calculation ──────────────────────────────────────────────────────
function utsfCalc(transporter, fromPin, toPin, weight) {
  if (!transporter) return null;
  const r = transporter.calculatePrice(fromPin, toPin, weight, 1);
  if (!r || r.error) return { error: r?.error || 'no result' };
  return {
    total: r.totalCharges,
    oda:   r.breakdown?.odaCharges ?? 0,
    ew:    r.breakdown?.baseFreight / r.unitPrice   // effective weight back-computed
  };
}

// ── Pincode selection ─────────────────────────────────────────────────────
// Group by zone + ODA status, pick representative pincodes
const byZoneOda = {};   // key = "zone|ODA" -> [pin, ...]
for (const [pinStr, row] of Object.entries(D)) {
  const pin = parseInt(pinStr, 10);
  // Must be in master pincodes and in DBS lookup
  if (!masterPincodes[pin]) continue;
  if (!DBS_MAP[pinStr])     continue;
  const key = `${row.zone}|${row.oda}`;
  if (!byZoneOda[key]) byZoneOda[key] = [];
  byZoneOda[key].push(pin);
}

// Sort each bucket for determinism
for (const arr of Object.values(byZoneOda)) arr.sort((a, b) => a - b);

// Target: 20 non-ODA, 20 ODA — spread across zones
const ZONES = ['N1','N2','N3','N4','S1','S2','S3','S4','E1','E2','W1','W2','C1','C2','NE1','NE2'];

function pick(odaFlag, totalTarget) {
  const tag = odaFlag ? 'Yes' : 'No';
  const selected = [];
  const perZoneTarget = Math.ceil(totalTarget / ZONES.length);
  for (const zone of ZONES) {
    const key = `${zone}|${tag}`;
    const bucket = byZoneOda[key] || [];
    // Pick up to perZoneTarget, spaced evenly for variety
    const step = Math.max(1, Math.floor(bucket.length / perZoneTarget));
    for (let i = 0; i < bucket.length && selected.length < totalTarget; i += step) {
      selected.push(bucket[i]);
    }
    if (selected.length >= totalTarget) break;
  }
  // If short, fill from any remaining buckets
  if (selected.length < totalTarget) {
    for (const zone of ZONES) {
      const key = `${zone}|${tag}`;
      const bucket = byZoneOda[key] || [];
      for (const p of bucket) {
        if (!selected.includes(p)) {
          selected.push(p);
          if (selected.length >= totalTarget) break;
        }
      }
      if (selected.length >= totalTarget) break;
    }
  }
  return selected.slice(0, totalTarget);
}

const nonOdaPins = pick(false, 20);
const odaPins    = pick(true,  20);

// Weight schedule: deliberately diverse, hitting all boundary conditions
const WEIGHTS_NON_ODA = [
   5, 10, 15, 19, 20, 25, 30, 45,
  50, 75, 100, 150, 200, 210, 250, 300,
  500, 750, 1000, 2000
];
const WEIGHTS_ODA = [
   7, 12, 18, 20, 25, 40, 50, 80,
  100, 150, 200, 205, 210, 215, 250, 300,
  400, 600, 1000, 1500
];

const testCases = [
  ...nonOdaPins.map((pin, i) => ({ pin, weight: WEIGHTS_NON_ODA[i], group: 'non-ODA' })),
  ...odaPins.map((pin, i)    => ({ pin, weight: WEIGHTS_ODA[i],    group: 'ODA'    })),
];

// ── Run tests & write report ──────────────────────────────────────────────
const REPORT_PATH = path.join(__dirname, 'comprehensive_report.txt');
const lines = [];
const w = (s) => lines.push(s);

w('='.repeat(100));
w('COMPREHENSIVE UTSF vs EXCEL TEST REPORT');
w(`40 test cases: 20 non-ODA + 20 ODA  |  Origin: ${FROM_PIN} (N1, Delhi)`);
w('Excel formulas replicated exactly. PASS = diff within Rs 0.50.');
w('='.repeat(100));
w('');

const HDR = '#  | PINCODE | ZONE | ODA? | WGT  |  VENDOR       | EXCEL    | UTSF     |   DIFF   | STATUS';
const SEP = '-'.repeat(100);

let totalTests = 0, totalPass = 0, totalFail = 0, totalNA = 0;
const failLog = [];

for (let i = 0; i < testCases.length; i++) {
  const { pin, weight, group } = testCases[i];
  const idx = String(i + 1).padStart(2);
  const excel = excelExpected(pin, weight);

  if (!excel) {
    w(`${idx} | ${pin} | SKIP - not in Excel lookup`);
    continue;
  }

  const vendors = [
    { name: 'Shipshopy    ', t: SS,  ex: excel.ss,  key: 'ss'  },
    { name: 'VL Cargo     ', t: VLC, ex: excel.vlc, key: 'vlc' },
    { name: 'Safexpress   ', t: SFX, ex: excel.sfx, key: 'sfx' },
    { name: 'DB Schenker  ', t: DBS, ex: excel.dbs, key: 'dbs' },
  ];

  const pinStr  = String(pin).padStart(7);
  const zoneStr = excel.zone.padEnd(4);
  const odaStr  = (excel.oda ? 'Yes ' : 'No  ');
  const wgtStr  = String(weight).padStart(5);

  w(SEP);
  w(`${HDR}`);
  w(SEP);

  for (const { name, t, ex } of vendors) {
    const prefix = `${idx} | ${pinStr} | ${zoneStr} | ${odaStr} | ${wgtStr} | ${name}`;

    if (!ex) {
      w(`${prefix}| N/A      | N/A      |          | NOT_IN_DBS`);
      totalNA++;
      continue;
    }

    const utsf = utsfCalc(t, FROM_PIN, pin, weight);
    totalTests++;

    if (!utsf || utsf.error) {
      const msg = utsf?.error || 'null';
      w(`${prefix}| ${String(ex.total).padStart(8)} | ERROR    |          | UTSF_ERR: ${msg.substring(0,30)}`);
      totalFail++;
      failLog.push(`#${idx} ${name.trim()} pin=${pin} wt=${weight}: UTSF error - ${msg}`);
      continue;
    }

    const diff    = Math.round((utsf.total - ex.total) * 100) / 100;
    const pass    = Math.abs(diff) < 0.51;
    const status  = pass ? 'PASS' : 'FAIL';
    const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(2);

    w(`${prefix}| ${String(ex.total).padStart(8)} | ${String(utsf.total).padStart(8)} | ${diffStr.padStart(8)} | ${status}`);

    if (pass) {
      totalPass++;
    } else {
      totalFail++;
      failLog.push(
        `#${idx} ${name.trim()} pin=${pin} zone=${excel.zone} wt=${weight} | Excel=${ex.total} UTSF=${utsf.total} diff=${diffStr}`
      );
    }
  }
  w('');
}

// ── Summary ───────────────────────────────────────────────────────────────
w('='.repeat(100));
w('SUMMARY');
w('='.repeat(100));
w(`Total vendor checks : ${totalTests}`);
w(`PASS                : ${totalPass}`);
w(`FAIL                : ${totalFail}`);
w(`N/A (not in DBS)    : ${totalNA}`);
w(`Pass rate           : ${totalTests > 0 ? ((totalPass / totalTests) * 100).toFixed(1) : 0}%`);
w('');

if (failLog.length > 0) {
  w('FAILURES:');
  failLog.forEach(f => w('  ' + f));
} else {
  w('No failures - all vendor checks passed!');
}

w('');
w('='.repeat(100));

// ── Write report ──────────────────────────────────────────────────────────
fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
console.log(`Report written to: ${REPORT_PATH}`);
console.log(`Tests: ${totalTests} | PASS: ${totalPass} | FAIL: ${totalFail} | NA: ${totalNA}`);
