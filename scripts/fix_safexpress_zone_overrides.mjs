/**
 * fix_safexpress_zone_overrides.mjs
 *
 * ROOT CAUSE OF WRONG BASE FREIGHT:
 * ─────────────────────────────────
 * The Safexpress UTSF rate table has "override" zone keys like:
 *   "C2_15": 15   ← means "C2 pincodes that should be ₹15/kg instead of ₹13/kg"
 *   "N4_17": 17   ← means "N4 pincodes that should be ₹17/kg instead of ₹12/kg"
 *   ... etc.
 *
 * These override rate keys ONLY take effect when the pincode appears in the
 * top-level `zoneOverrides` field:  { "497335": "C2_15", ... }
 *
 * Without a `zoneOverrides` entry, `checkServiceability()` returns the base
 * zone ("C2") → rate lookup gets ₹13/kg instead of ₹15/kg → WRONG base freight.
 *
 * ⚠️  WARNING FOR FUTURE AI / DEVELOPERS:
 * ──────────────────────────────────────
 * Adding a new rate key to `pricing.zoneRates` (e.g., "C2_20": 20) will have
 * ZERO EFFECT unless you ALSO add the pincode → "C2_20" mapping to `zoneOverrides`.
 * CONFIRM WITH USER before changing zone rates or zoneOverrides mappings.
 * The source of truth for which pincodes belong to which override zone is
 * excel_lookup.json (sfx field = rate per kg for Safexpress).
 *
 * HOW THE OVERRIDE ZONE KEYS ARE NAMED:
 *   "{baseZone}_{sfxRate}"  e.g., "C2_15" = base zone C2, sfx rate = 15
 *
 * This script:
 *   1. Reads excel_lookup.json to find all pincodes for each override zone
 *   2. Reads the Safexpress UTSF file
 *   3. Discovers override keys from the rate table (keys with underscore pattern)
 *   4. Merges new pincode→overrideZone entries into zoneOverrides
 *   5. Adds a _rateOverrideWarning field to the meta section
 *   6. Writes the updated UTSF file
 *
 * Usage: node backend/scripts/fix_safexpress_zone_overrides.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const UTSF_PATH  = path.resolve(__dirname, '../data/utsf/6870d8765f9c12f692f3b7b3.utsf.json');
const EXCEL_PATH = path.resolve(__dirname, 'excel_lookup.json');

// ─── load files ──────────────────────────────────────────────────────────────
const utsf  = JSON.parse(fs.readFileSync(UTSF_PATH,  'utf8'));
const excel = JSON.parse(fs.readFileSync(EXCEL_PATH, 'utf8'));

console.log('Safexpress UTSF loaded. Top-level keys:', Object.keys(utsf).join(', '));
console.log('Excel delhivery pincodes:', Object.keys(excel.delhivery).length);

// ─── discover override zone keys from rate table ──────────────────────────────
// Override key pattern: "{ZONE}_{NUMBER}" e.g. "C2_15", "N4_17", "NE2_150"
// For all origin zones, collect the override keys.
const OVERRIDE_ZONE_KEYS = new Set();
const zoneRates = utsf.pricing?.zoneRates || {};

for (const [origin, destRates] of Object.entries(zoneRates)) {
  for (const key of Object.keys(destRates)) {
    // Key is an override if it contains underscore and part after underscore is a number
    const underscoreIdx = key.lastIndexOf('_');
    if (underscoreIdx > 0) {
      const suffix = key.slice(underscoreIdx + 1);
      if (/^\d+$/.test(suffix)) {
        OVERRIDE_ZONE_KEYS.add(key);
      }
    }
  }
}

console.log('\nDiscovered override zone keys in rate table:');
for (const key of [...OVERRIDE_ZONE_KEYS].sort()) {
  console.log(`  ${key}`);
}

// ─── parse override key into { baseZone, sfxRate } ───────────────────────────
function parseOverrideKey(key) {
  const underscoreIdx = key.lastIndexOf('_');
  return {
    baseZone: key.slice(0, underscoreIdx),         // e.g., "C2", "NE2"
    sfxRate:  parseInt(key.slice(underscoreIdx + 1), 10),  // e.g., 15, 150
  };
}

// ─── build: overrideKey → list of pincodes from excel ────────────────────────
const overrideKeyToPins = {};
for (const key of OVERRIDE_ZONE_KEYS) {
  overrideKeyToPins[key] = [];
}

for (const [pinStr, info] of Object.entries(excel.delhivery)) {
  const zone = (info.zone || '').trim().toUpperCase();
  const sfx  = info.sfx;  // Safexpress rate per kg
  if (sfx == null) continue;

  for (const key of OVERRIDE_ZONE_KEYS) {
    const { baseZone, sfxRate } = parseOverrideKey(key);
    if (zone === baseZone && sfx === sfxRate) {
      overrideKeyToPins[key].push(pinStr);
    }
  }
}

console.log('\nPincodes per override zone (from excel_lookup):');
let totalNew = 0;
for (const [key, pins] of Object.entries(overrideKeyToPins)) {
  console.log(`  ${key}: ${pins.length} pincodes`);
  totalNew += pins.length;
}
console.log(`  TOTAL: ${totalNew} pincodes to potentially add`);

// ─── existing zoneOverrides ───────────────────────────────────────────────────
if (!utsf.zoneOverrides) {
  utsf.zoneOverrides = {};
  console.log('\nzoneOverrides field was MISSING — creating new empty object');
} else {
  console.log(`\nExisting zoneOverrides entries: ${Object.keys(utsf.zoneOverrides).length}`);
}

// ─── merge: add missing entries, never overwrite existing ones ────────────────
let added = 0;
let skipped = 0;
let conflicts = 0;

for (const [key, pins] of Object.entries(overrideKeyToPins)) {
  for (const pinStr of pins) {
    if (pinStr in utsf.zoneOverrides) {
      if (utsf.zoneOverrides[pinStr] === key) {
        skipped++;  // already correct
      } else {
        // Conflict: pincode already mapped to a different override zone
        console.warn(`  CONFLICT: pin ${pinStr} already mapped to "${utsf.zoneOverrides[pinStr]}", ` +
                     `not overwriting with "${key}"`);
        conflicts++;
      }
    } else {
      utsf.zoneOverrides[pinStr] = key;
      added++;
    }
  }
}

console.log(`\nMerge result: +${added} added, ${skipped} already correct, ${conflicts} conflicts`);
console.log(`Total zoneOverrides entries now: ${Object.keys(utsf.zoneOverrides).length}`);

// ─── add warning to meta section ─────────────────────────────────────────────
if (!utsf.meta) utsf.meta = {};
utsf.meta._rateOverrideWarning = [
  "⚠️  RATE OVERRIDE ZONES — READ BEFORE MODIFYING ⚠️",
  "The `pricing.zoneRates` table contains override keys like 'C2_15', 'N4_17', etc.",
  "Pattern: '{baseZone}_{sfxRatePerKg}' — e.g., 'C2_15' = C2 pincodes charged at ₹15/kg.",
  "These ONLY take effect when the pincode is listed in `zoneOverrides`: { '497335': 'C2_15' }.",
  "Adding a new rate key WITHOUT updating `zoneOverrides` has ZERO EFFECT.",
  "Source of truth: excel_lookup.json (delhivery[pincode].sfx = rate/kg for Safexpress).",
  "CONFIRM WITH USER before changing zone rates or zoneOverrides mappings.",
  "Script to regenerate: backend/scripts/fix_safexpress_zone_overrides.mjs"
];

// ─── verify 497335 is now correct ────────────────────────────────────────────
const check = utsf.zoneOverrides['497335'];
console.log(`\n[VERIFY] zoneOverrides['497335'] = ${check ?? 'NOT FOUND'}`);
if (check === 'C2_15') {
  console.log('[VERIFY] ✅ 497335 → C2_15 — will now use ₹15/kg instead of ₹13/kg');
} else {
  console.log('[VERIFY] ❌ 497335 still not mapped correctly!');
  process.exit(1);
}

// ─── write updated UTSF file ─────────────────────────────────────────────────
const outJson = JSON.stringify(utsf, null, 2);
fs.writeFileSync(UTSF_PATH, outJson, 'utf8');
console.log(`\nUpdated UTSF file written: ${UTSF_PATH}`);
console.log(`File size: ${(outJson.length / 1024).toFixed(1)} KB`);

// ─── sanity: spot-check a few pincodes ───────────────────────────────────────
console.log('\nSpot-check sample pincodes:');
const samples = ['497335', '110001', '400001'];
for (const p of samples) {
  const zone = excel.delhivery[p];
  const override = utsf.zoneOverrides[p];
  console.log(`  ${p}: excel zone=${zone?.zone} sfx=${zone?.sfx} → zoneOverrides="${override ?? 'none'}"`);
}

console.log('\nDone! ✅');
console.log('Run node backend/scripts/_check_497335.mjs to verify 497335 is correctly mapped.');
