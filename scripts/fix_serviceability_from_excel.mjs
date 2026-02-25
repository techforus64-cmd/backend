/**
 * fix_serviceability_from_excel.mjs
 *
 * Fixes serviceability discrepancies in UTSF files for all Excel-based vendors:
 *   - DB Schenker  : Rebuilds from Pincode_DBS sheet (authoritative list of 20,236 served pincodes)
 *   - VL Cargo     : Updates servedCount metadata to match actual servedSingles (coverage is intentionally ~universal)
 *   - Safexpress   : Updates servedCount metadata to match actual servedSingles
 *
 * Root Cause:
 *   fix_dbs_coverage.mjs incorrectly read from Pincode_B2B_Delhivery (the master sheet where
 *   ALL vendors have a rate for ALL pincodes) and inflated DB Schenker's serviceability with
 *   ~1,600 extra pincodes. NE2 zone was worst affected (+833 pincodes).
 *
 * Run: node backend/scripts/fix_serviceability_from_excel.mjs
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');
const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');

const DBS_ID = '67b4b800db5c000000000001';
const VLC_ID = '67b4b800cf900000000000c1';
const SFX_ID = '6870d8765f9c12f692f3b7b3';

// ─── helpers ──────────────────────────────────────────────────────────────────

function expandRanges(ranges) {
  const pins = new Set();
  for (const r of (ranges || [])) {
    const s = parseInt(r.s ?? r[0]), e = parseInt(r.e ?? r[1]);
    if (!isNaN(s) && !isNaN(e)) for (let p = s; p <= e; p++) pins.add(p);
  }
  return pins;
}

function actualCount(info) {
  return (info.servedSingles?.length ?? 0) + expandRanges(info.servedRanges).size;
}

function loadUtsf(id) {
  return JSON.parse(fs.readFileSync(path.join(UTSF_DIR, `${id}.utsf.json`), 'utf8'));
}

// ─── INTEGRITY CHECK ─────────────────────────────────────────────────────────
// Runs automatically after every save.
// Detects if any zone's servedSingles count drifted from servedCount by more
// than INTEGRITY_TOLERANCE pincodes — which is the signature of the
// fix_dbs_coverage / fix_safexpress_coverage inflation bug.
// If a violation is found the save is ABORTED and the file is NOT written.
//
// IMPORTANT: If you are intentionally changing serviceability, update
// servedCount to match the new servedSingles length before calling saveUtsf().
// This script always keeps them in sync for metadata fields only — real
// coverage changes must go through fix_serviceability_from_excel.mjs.
const INTEGRITY_TOLERANCE = 0; // servedCount must equal actualCount exactly after this script

function integrityCheck(id, data) {
  const name = data.meta?.companyName || id;
  const violations = [];
  for (const [zone, info] of Object.entries(data.serviceability || {})) {
    const rangeCount = expandRanges(info.servedRanges).size;
    const actual = (info.servedSingles?.length ?? 0) + rangeCount;
    const claimed = info.servedCount ?? 0;
    const diff = actual - claimed;
    if (Math.abs(diff) > INTEGRITY_TOLERANCE) {
      violations.push(`  Zone ${zone}: servedCount=${claimed} but actual=${actual} (diff=${diff > 0 ? '+' : ''}${diff})`);
    }
  }
  if (violations.length > 0) {
    console.error('');
    console.error(`⛔  INTEGRITY CHECK FAILED for ${name} — SAVE ABORTED`);
    console.error('    servedCount does not match actual servedSingles+servedRanges:');
    violations.forEach(v => console.error(v));
    console.error('');
    console.error('    This is the signature of the fix_dbs_coverage / fix_safexpress_coverage bug.');
    console.error('    DO NOT run fix_dbs_coverage.mjs or fix_safexpress_coverage.mjs — they are deprecated.');
    console.error('    Re-run this script to restore correct state from the Excel source.');
    console.error('');
    process.exit(1);
  }
}

function saveUtsf(id, data) {
  // Run integrity check before writing — aborts if servedCount is out of sync
  integrityCheck(id, data);

  const filePath = path.join(UTSF_DIR, `${id}.utsf.json`);
  // Backup before overwriting (only if no backup exists yet)
  const bakPath = path.join(UTSF_DIR, `${id}.utsf.bak.json`);
  if (!fs.existsSync(bakPath)) {
    fs.copyFileSync(filePath, bakPath);
    console.log(`  Backed up to ${path.basename(bakPath)}`);
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ─── load master data ─────────────────────────────────────────────────────────

console.log('Loading pincodes.json...');
const pinsJson = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
const masterZoneMap = new Map(); // pincode (number) -> masterZone (string)
for (const entry of pinsJson) {
  const pin = parseInt(entry.pincode ?? entry.Pincode);
  const zone = String(entry.zone ?? entry.Zone ?? '').trim().toUpperCase();
  if (!isNaN(pin) && zone) masterZoneMap.set(pin, zone);
}
console.log(`  Loaded ${masterZoneMap.size} master pincodes`);

console.log('Loading Excel...');
const wb = XLSX.readFile(EXCEL_PATH);

// ─── DB SCHENKER FIX ──────────────────────────────────────────────────────────
// Source of truth: Pincode_DBS sheet (col B=pin, col E=ODA, col F=DBS zone)
// Only pincodes listed in Pincode_DBS are actually served by DB Schenker.

console.log('\n=== DB SCHENKER ===');
const dbsSheet = XLSX.utils.sheet_to_json(wb.Sheets['Pincode_DBS'], { header: 1, defval: '' });
console.log(`  Pincode_DBS sheet has ${dbsSheet.length - 1} data rows`);

// Build: pincode -> { masterZone, isOda }
const dbsServed = new Map(); // pin -> { masterZone, isOda }
let dbsNoMaster = 0;
for (let i = 1; i < dbsSheet.length; i++) {
  const row = dbsSheet[i];
  const pin = parseInt(row[1]);
  if (isNaN(pin) || pin <= 0) continue;

  const masterZone = masterZoneMap.get(pin);
  if (!masterZone) { dbsNoMaster++; continue; }

  const oda = String(row[4]).trim().toLowerCase() === 'yes';
  dbsServed.set(pin, { masterZone, isOda: oda });
}
console.log(`  Valid DBS pincodes (with master zone): ${dbsServed.size}`);
if (dbsNoMaster > 0) console.log(`  Pincodes without master zone (skipped): ${dbsNoMaster}`);

// Group by masterZone
const dbsByZone = new Map(); // masterZone -> [pincodes]
for (const [pin, { masterZone }] of dbsServed) {
  if (!dbsByZone.has(masterZone)) dbsByZone.set(masterZone, []);
  dbsByZone.get(masterZone).push(pin);
}

// Load and update DBS UTSF
const dbsUtsf = loadUtsf(DBS_ID);
const dbsSvc = dbsUtsf.serviceability;
const dbsTotalInZone = {}; // pre-gather for coveragePercent
for (const [zone, info] of Object.entries(dbsSvc)) dbsTotalInZone[zone] = info.totalInZone ?? 0;

let dbsReport = [];
for (const [zone, info] of Object.entries(dbsSvc)) {
  const before = actualCount(info);
  const correctPins = (dbsByZone.get(zone) ?? []).sort((a, b) => a - b);
  const after = correctPins.length;
  const diff = after - before;

  info.servedSingles = correctPins;
  info.servedRanges = [];
  info.servedCount = after;
  info.coveragePercent = dbsTotalInZone[zone] > 0
    ? Math.round((after / dbsTotalInZone[zone]) * 10000) / 100
    : 0;

  if (diff !== 0) {
    dbsReport.push({ zone, before, after, diff });
  }
}

// Also handle any zones that exist in dbsByZone but NOT in dbsSvc (edge case)
for (const [zone, pins] of dbsByZone) {
  if (!dbsSvc[zone]) {
    console.log(`  ⚠  New zone ${zone} found in Pincode_DBS — adding to serviceability`);
    dbsSvc[zone] = {
      mode: 'ONLY_SERVED',
      totalInZone: 0,
      servedCount: pins.length,
      coveragePercent: 0,
      servedSingles: pins.sort((a, b) => a - b),
      servedRanges: []
    };
    dbsReport.push({ zone, before: 0, after: pins.length, diff: pins.length });
  }
}

if (dbsReport.length > 0) {
  console.log('  Changes made:');
  for (const r of dbsReport) {
    const tag = r.diff > 0 ? `+${r.diff}` : String(r.diff);
    console.log(`    Zone ${r.zone}: ${r.before} → ${r.after} (${tag})`);
  }
} else {
  console.log('  No changes needed — already correct.');
}
saveUtsf(DBS_ID, dbsUtsf);
console.log(`  Saved ${DBS_ID}.utsf.json`);

// ─── VL CARGO: metadata sync ──────────────────────────────────────────────────
// VLC coverage is intentionally near-universal (Delhivery master sheet).
// Only fix: sync servedCount metadata to match actual servedSingles count.

console.log('\n=== VL CARGO (metadata sync) ===');
const vlcUtsf = loadUtsf(VLC_ID);
let vlcChanged = 0;
for (const [zone, info] of Object.entries(vlcUtsf.serviceability)) {
  const rangeExpanded = expandRanges(info.servedRanges);
  const actual = (info.servedSingles?.length ?? 0) + rangeExpanded.size;
  if (info.servedCount !== actual) {
    console.log(`  Zone ${zone}: servedCount ${info.servedCount} → ${actual}`);
    info.servedCount = actual;
    if (info.totalInZone > 0) {
      info.coveragePercent = Math.round((actual / info.totalInZone) * 10000) / 100;
    }
    vlcChanged++;
  }
}
if (vlcChanged === 0) {
  console.log('  No changes needed — metadata already correct.');
} else {
  saveUtsf(VLC_ID, vlcUtsf);
  console.log(`  Updated ${vlcChanged} zones. Saved ${VLC_ID}.utsf.json`);
}

// ─── SAFEXPRESS: metadata sync ────────────────────────────────────────────────
// Same as VLC — near-universal coverage, just sync servedCount metadata.

console.log('\n=== SAFEXPRESS (metadata sync) ===');
const sfxUtsf = loadUtsf(SFX_ID);
let sfxChanged = 0;
for (const [zone, info] of Object.entries(sfxUtsf.serviceability)) {
  const rangeExpanded = expandRanges(info.servedRanges);
  const actual = (info.servedSingles?.length ?? 0) + rangeExpanded.size;
  if (info.servedCount !== actual) {
    console.log(`  Zone ${zone}: servedCount ${info.servedCount} → ${actual}`);
    info.servedCount = actual;
    if (info.totalInZone > 0) {
      info.coveragePercent = Math.round((actual / info.totalInZone) * 10000) / 100;
    }
    sfxChanged++;
  }
}
if (sfxChanged === 0) {
  console.log('  No changes needed — metadata already correct.');
} else {
  saveUtsf(SFX_ID, sfxUtsf);
  console.log(`  Updated ${sfxChanged} zones. Saved ${SFX_ID}.utsf.json`);
}

// ─── DELHIVERY (SHIPSHOPY): metadata sync ─────────────────────────────────────
// Shipshopy uses Pincode_B2B_Delhivery (same as VLC/SFX) — near-universal coverage.
// Only fix: sync servedCount metadata to match actual servedSingles count.

const SHP_ID = '6968ddedc2cf85d3f4380d52';
console.log('\n=== DELHIVERY SHIPSHOPY (metadata sync) ===');
const shpUtsf = loadUtsf(SHP_ID);
let shpChanged = 0;
for (const [zone, info] of Object.entries(shpUtsf.serviceability)) {
  const rangeExpanded = expandRanges(info.servedRanges);
  const actual = (info.servedSingles?.length ?? 0) + rangeExpanded.size;
  if (info.servedCount !== actual) {
    console.log(`  Zone ${zone}: servedCount ${info.servedCount} → ${actual}`);
    info.servedCount = actual;
    if (info.totalInZone > 0) {
      info.coveragePercent = Math.round((actual / info.totalInZone) * 10000) / 100;
    }
    shpChanged++;
  }
}
if (shpChanged === 0) {
  console.log('  No changes needed — metadata already correct.');
} else {
  saveUtsf(SHP_ID, shpUtsf);
  console.log(`  Updated ${shpChanged} zones. Saved ${SHP_ID}.utsf.json`);
}

// ─── FINAL SUMMARY ────────────────────────────────────────────────────────────

console.log('\n=== DONE ===');
console.log('All saves passed integrity checks (servedCount === actual pincode count).');
console.log('');
console.log('IF THIS PROBLEM RECURS IN FUTURE:');
console.log('  1. Do NOT run fix_dbs_coverage.mjs or fix_safexpress_coverage.mjs (they are');
console.log('     deprecated — running either will immediately abort with an error message).');
console.log('  2. Run THIS script:  node backend/scripts/fix_serviceability_from_excel.mjs');
console.log('  3. Source of truth for each vendor:');
console.log('     - DB Schenker  → Pincode_DBS sheet in the Excel');
console.log('     - VL Cargo     → Pincode_B2B_Delhivery col H (VL Cargo rate)');
console.log('     - Safexpress   → Pincode_B2B_Delhivery col J (Safexpress rate)');
console.log('     - Shipshopy    → Pincode_B2B_Delhivery col G (Shipshopy rate)');
