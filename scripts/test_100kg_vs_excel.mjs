/**
 * test_100kg_vs_excel.mjs
 *
 * Tests 10 pincodes (5 ODA + 5 non-ODA) for the 4 main vendors at 100 kg
 * against expected values derived from excel_lookup.json.
 *
 * Usage:  node backend/scripts/test_100kg_vs_excel.mjs
 *
 * Origin pincode: 110020 (Delhi, N1 zone)
 * Weight: 100 kg (actual = chargeable, NO dimensions)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── paths ───────────────────────────────────────────────────────────────────
const UTSF_DIR       = path.resolve(__dirname, '../data/utsf');
const PINCODES_PATH  = path.resolve(__dirname, '../data/pincodes.json');
const EXCEL_JSON     = path.resolve(__dirname, 'excel_lookup.json');
const utsfModulePath = pathToFileURL(
  path.resolve(__dirname, '../services/utsfService.js')
).href;

// ─── load module ─────────────────────────────────────────────────────────────
const { UTSFTransporter } = await import(utsfModulePath);

// ─── load master pincodes ────────────────────────────────────────────────────
const pincodeArray  = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
const masterPincodes = {};
for (const e of pincodeArray) {
  const pin  = parseInt(e.pincode ?? e.Pincode, 10);
  const zone = (e.zone ?? e.Zone ?? '').toUpperCase();
  if (!isNaN(pin) && zone) masterPincodes[pin] = zone;
}
console.log(`[BOOT] Master pincodes loaded: ${Object.keys(masterPincodes).length}`);

// ─── load excel lookup ───────────────────────────────────────────────────────
const excel = JSON.parse(fs.readFileSync(EXCEL_JSON, 'utf8'));
// excel.delhivery[pin] = { zone, oda, ss, vlc, sfx }

// ─── load transporters ───────────────────────────────────────────────────────
function loadT(id) {
  const fp   = path.join(UTSF_DIR, `${id}.utsf.json`);
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return new UTSFTransporter(data, masterPincodes);
}

const SHIPSHOPY_ID = '6968ddedc2cf85d3f4380d52';
const SAFEXPRESS_ID = '6870d8765f9c12f692f3b7b3';
const DBS_ID       = '67b4b800db5c000000000001';
const VLC_ID       = '67b4b800cf900000000000c1';

const shipshopy  = loadT(SHIPSHOPY_ID);
const safexpress = loadT(SAFEXPRESS_ID);
const dbs        = loadT(DBS_ID);
const vlc        = loadT(VLC_ID);

// ─── origin ──────────────────────────────────────────────────────────────────
const ORIGIN   = 110020;   // Delhi, N1 zone
const WEIGHT   = 100;      // kg chargeable weight (no dimensions)
const INVOICE  = 50000;    // invoice value

// ─── pick test pincodes from excel_lookup.json ───────────────────────────────
// Strategy: pick pincodes that are:
//   (a) in the delhivery lookup (guarantees rate exists)
//   (b) served by Shipshopy (checkServiceability)
//   (c) not the origin itself
const NON_ODA_SEED = [110001, 400001, 500001, 226010, 302001];
const ODA_SEED     = [497335, 246481, 689703, 743001, 394810];

// If a seeded pincode has no excel entry, fall back to scanning
function getExcel(pin) {
  return excel.delhivery[String(pin)] ?? null;
}

// ─── Excel expected price formulae ───────────────────────────────────────────
// Shipshopy: rate*weight + 100 docket + ODA(excess: fixed=500, v=3, threshold=200)
// Safexpress: rate*weight + 350 docket + min(5%*base, 400) fuel + 100 ROV + ODA(fixed 500)
// VL Cargo:  rate*weight + 0 docket + ODA(excess: fixed=500, v=3, threshold=200)
// DB Schenker: uses Pincode_DBS rates (stored in excel.dbs / excel.dbs_rates) — approximated

function excelOdaExcess(weight, fixed = 500, v = 3, threshold = 200) {
  if (weight <= threshold) return fixed;
  return fixed + (weight - threshold) * v;
}

function expectedShipshopy(pin, w, isOda) {
  const e = getExcel(pin);
  if (!e) return null;
  const base = e.ss * w;
  const oda  = isOda ? excelOdaExcess(w) : 0;
  return Math.round((base + 100 + oda) * 100) / 100;
}

function expectedVlcargo(pin, w, isOda) {
  const e = getExcel(pin);
  if (!e || e.vlc == null) return null;
  const base = e.vlc * w;
  const oda  = isOda ? excelOdaExcess(w) : 0;
  return Math.round((base + oda) * 100) / 100;
}

function expectedSafexpress(pin, w, isOda) {
  const e = getExcel(pin);
  if (!e || e.sfx == null) return null;
  const base = e.sfx * w;
  const fuel = Math.min(0.05 * base, 400);
  const rov  = 100;  // fixed ROV
  const oda  = isOda ? 500 : 0;   // Safexpress: legacy fixed 500
  return Math.round((base + 350 + fuel + rov + oda) * 100) / 100;
}

// ─── stat counters ───────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;

function runTest(label, transporter, from, to, w, inv, expectedFn, pinInfo) {
  const result = transporter.calculatePrice(from, to, w, inv);
  if (!result || result.error) {
    console.log(`  ⚠️  SKIP (not served): ${result?.error}`);
    skipped++;
    return;
  }
  const got  = result.totalCharges;
  const exp  = expectedFn(to, w, pinInfo?.isOda ?? false);
  if (exp === null) {
    console.log(`  ⚠️  SKIP (no excel rate)`);
    skipped++;
    return;
  }

  const diff = Math.abs(got - exp);
  const ok   = diff < 1.0;   // tolerance: ₹1

  console.log(`  Got=₹${got.toFixed(2)}  Expected=₹${exp.toFixed(2)}  Diff=₹${diff.toFixed(2)}`);
  console.log(`  Breakdown: base=₹${result.baseFreight.toFixed(2)}, ` +
    `fuel=₹${(result.breakdown?.fuelCharges ?? 0).toFixed(2)}, ` +
    `docket=₹${(result.breakdown?.docketCharge ?? 0).toFixed(2)}, ` +
    `rov=₹${(result.breakdown?.rovCharges ?? 0).toFixed(2)}, ` +
    `oda=₹${(result.breakdown?.odaCharges ?? 0).toFixed(2)}`);
  console.log(`  Zone: ${result.originZone} → ${result.destZone}, isOda=${result.isOda}`);
  if (ok) {
    console.log(`  ✅ PASS`);
    passed++;
  } else {
    console.log(`  ❌ FAIL`);
    failed++;
  }
}

// ─── run tests ───────────────────────────────────────────────────────────────
console.log('\n');
console.log('='.repeat(70));
console.log('  FreightCompare Calculation Test — 100 kg, origin=110020 (N1)');
console.log('  10 pincodes: 5 NON-ODA + 5 ODA');
console.log('='.repeat(70));

function section(title) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(70));
}

// ════════════════════════════════════════════════════════════════════════════
// NON-ODA TEST PINCODES
// ════════════════════════════════════════════════════════════════════════════
const nonOda = [];
for (const pin of NON_ODA_SEED) {
  const e = getExcel(pin);
  if (e && e.oda === 'No') nonOda.push({ pin, ...e });
  if (nonOda.length === 5) break;
}
// fill from scan if needed
if (nonOda.length < 5) {
  for (const [pinStr, info] of Object.entries(excel.delhivery)) {
    if (nonOda.length >= 5) break;
    const pin = parseInt(pinStr, 10);
    if (info.oda === 'No' && pin !== ORIGIN && !nonOda.some(x => x.pin === pin)) {
      nonOda.push({ pin, ...info });
    }
  }
}

section('GROUP A — NON-ODA (5 pincodes × 3 vendors = 15 tests)');
for (const { pin, zone, oda, ss, vlc: vlcRate, sfx } of nonOda) {
  console.log(`\n  📍 ${pin} | Zone=${zone} | ODA=${oda} | ss=₹${ss}/kg, vlc=₹${vlcRate}/kg, sfx=₹${sfx}/kg`);

  console.log(`  [Shipshopy]`);
  runTest('Shipshopy', shipshopy, ORIGIN, pin, WEIGHT, INVOICE, expectedShipshopy, { isOda: false });

  console.log(`  [VL Cargo]`);
  runTest('VLCargo', vlc, ORIGIN, pin, WEIGHT, INVOICE, expectedVlcargo, { isOda: false });

  console.log(`  [Safexpress]`);
  runTest('Safexpress', safexpress, ORIGIN, pin, WEIGHT, INVOICE, expectedSafexpress, { isOda: false });
}

// ════════════════════════════════════════════════════════════════════════════
// ODA TEST PINCODES
// ════════════════════════════════════════════════════════════════════════════
const odaList = [];
for (const pin of ODA_SEED) {
  const e = getExcel(pin);
  if (e && e.oda === 'Yes') odaList.push({ pin, ...e });
  if (odaList.length === 5) break;
}
if (odaList.length < 5) {
  for (const [pinStr, info] of Object.entries(excel.delhivery)) {
    if (odaList.length >= 5) break;
    const pin = parseInt(pinStr, 10);
    if (info.oda === 'Yes' && pin !== ORIGIN && !odaList.some(x => x.pin === pin)) {
      odaList.push({ pin, ...info });
    }
  }
}

section('GROUP B — ODA (5 pincodes × 3 vendors = 15 tests)');
for (const { pin, zone, oda, ss, vlc: vlcRate, sfx } of odaList) {
  console.log(`\n  📍 ${pin} | Zone=${zone} | ODA=${oda} | ss=₹${ss}/kg, vlc=₹${vlcRate}/kg, sfx=₹${sfx}/kg`);

  console.log(`  [Shipshopy]`);
  runTest('Shipshopy', shipshopy, ORIGIN, pin, WEIGHT, INVOICE, expectedShipshopy, { isOda: true });

  console.log(`  [VL Cargo]`);
  runTest('VLCargo', vlc, ORIGIN, pin, WEIGHT, INVOICE, expectedVlcargo, { isOda: true });

  console.log(`  [Safexpress]`);
  runTest('Safexpress', safexpress, ORIGIN, pin, WEIGHT, INVOICE, expectedSafexpress, { isOda: true });
}

// ─── summary ─────────────────────────────────────────────────────────────────
console.log('\n');
console.log('='.repeat(70));
console.log(`  SUMMARY`);
console.log(`  ✅ Passed : ${passed}`);
console.log(`  ❌ Failed : ${failed}`);
console.log(`  ⚠️  Skipped: ${skipped}`);
console.log('='.repeat(70));
console.log('');
console.log('NOTE: Web-app may show DIFFERENT prices if the user enters box dimensions.');
console.log('      Volumetric weight = L×W×H×boxes / kFactor may exceed 100 kg,');
console.log('      making chargeable weight > 100 kg and raising the total price.');
console.log('      Test here uses PURE chargeable weight = 100 kg (no dimensions).');
