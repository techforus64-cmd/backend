/**
 * fix_dbs_clean.mjs
 *
 * 1. Loads DB Schenker UTSF file.
 * 2. Parses it (which automatically picks the LAST value for duplicate keys).
 * 3. EXPLICITLY sets correct overrides for 171007 (Shimla) and 174002 (Bilaspur) to N4.
 * 4. Ensures numeric types for ODA thresholds.
 * 5. Saves file (removing text-level duplicates).
 * 6. Verifies calculation for 174002 (Bilaspur) specifically.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DBS_ID = '67b4b800db5c000000000001';
const UTSF_PATH = path.resolve(__dirname, `../data/utsf/${DBS_ID}.utsf.json`);

console.log(`[FIX] Loading ${UTSF_PATH}...`);
const content = fs.readFileSync(UTSF_PATH, 'utf8');
const data = JSON.parse(content);

console.log(`[FIX] Loaded. Checking overrides...`);

// Ensure overrides object exists
if (!data.zoneOverrides) data.zoneOverrides = {};

// 1. Force N4 for Shimla (171007) - fixing Test 3 failure
// 2. Force N4 for Bilaspur (174002) - fixing reported ODA/Rate mismatch
console.log(`[FIX] Old 171007: ${data.zoneOverrides['171007']}`);
console.log(`[FIX] Old 174002: ${data.zoneOverrides['174002']}`);

data.zoneOverrides['171007'] = 'N4';
data.zoneOverrides['174002'] = 'N4';
// Keep Palwal 121103 as N3 (from earlier fix)
data.zoneOverrides['121103'] = 'N3';

console.log(`[FIX] New 171007: ${data.zoneOverrides['171007']}`);
console.log(`[FIX] New 174002: ${data.zoneOverrides['174002']}`);

// Verify ODA Config
if (data.pricing && data.pricing.priceRate && data.pricing.priceRate.odaCharges) {
    const oda = data.pricing.priceRate.odaCharges;
    console.log(`[FIX] ODA Config:`, oda);
    if (typeof oda.thresholdWeight !== 'number') {
        console.warn(`[WARN] ODA thresholdWeight is not a number! Fixing...`);
        oda.thresholdWeight = Number(oda.thresholdWeight);
        // Also fix legacy if needed
        if (oda.threshholdweight) delete oda.threshholdweight;
    }
}

// Add strict check for minTotalCharges logic I added
if (data.pricing && data.pricing.priceRate) {
    data.pricing.priceRate.minChargesApplyToTotal = true; // Ensure flag is set
}

// Save clean version
fs.writeFileSync(UTSF_PATH, JSON.stringify(data, null, 2), 'utf8');
console.log(`[FIX] Saved clean UTSF file (duplicates removed).`);

// --- Verification Logic ---
// We can re-use utsfService logic here or just rely on next test run.
// Let's do a quick calculation check for 174002 (Bilaspur).
// Need to load service.
const { UTSFTransporter } = await import('../services/utsfService.js');

// Mock master pincodes (just what we need)
const masterPincodes = {};
// We don't have full master list here easily without loading pincodes.json.
// Let's assume we can check purely based on UTSF data which contains master mappings?
// No, UTSF service needs masterPincodes map.
// Let's load full pincodes.json to be safe.
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');
const pinData = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
for (const p of pinData) {
    masterPincodes[p.pincode || p.Pincode] = p.zone || p.Zone;
}

const transporter = new UTSFTransporter(data, masterPincodes);

// Test 174002
// Weight 840kg. From 110020 (Del).
const result = transporter.calculatePrice(110020, 174002, 840, 1);
console.log('\n[VERIFY] 174002 (Bilaspur) 840kg:');
if (result.error) {
    console.error(`  ERROR: ${result.error}`);
} else {
    console.log(`  Total: ₹${result.totalCharges}`);
    console.log(`  Base: ₹${result.breakdown.baseFreight} (Effective: ${result.breakdown.effectiveBaseFreight})`);
    console.log(`  ODA: ₹${result.breakdown.odaCharges}`);
    console.log(`  Zone: ${result.originZone} -> ${result.destZone}`);
    console.log(`  isOda: ${result.isOda}`);

    // Expected:
    // Rate 8.1 (N4). Base = 840 * 8.1 = 6804.
    // Fuel 5% = 340.2.
    // Docket = 100.
    // ODA = 4 * 840 = 3360.
    // Total = 6804 + 340.2 + 100 + 3360 = 10604.2

    const expected = 10604.2;
    const diff = Math.abs(result.totalCharges - expected);
    if (diff < 1) console.log(`  ✅ MATCHES EXPECTED (10604.2)`);
    else console.log(`  ❌ MISMATCH (Expected 10604.2, Diff: ${diff})`);
}
