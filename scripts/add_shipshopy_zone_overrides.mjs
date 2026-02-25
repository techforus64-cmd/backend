/**
 * add_shipshopy_zone_overrides.mjs
 *
 * Applies the Safexpress-style zone override approach to Shipshopy.
 * For each pincode where pincodes.json zone ≠ Excel zone,
 * add a zoneOverride mapping the pincode to the Excel zone.
 *
 * Key insight: Shipshopy zoneRates already has entries for all Excel zones,
 * so we can override DIRECTLY to the Excel zone name — no virtual zones needed.
 */
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');
const SHIP_UTSF_PATH = path.resolve(__dirname, '../data/utsf/6968ddedc2cf85d3f4380d52.utsf.json');

// 1. Load master pincodes
const pincodeArray = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
const masterZones = {};
for (const entry of pincodeArray) {
    const pin = parseInt(entry.pincode || entry.Pincode, 10);
    const zone = (entry.zone || entry.Zone || '').toUpperCase().trim();
    if (!isNaN(pin) && zone) masterZones[pin] = zone;
}
console.log(`Master pincodes loaded: ${Object.keys(masterZones).length}`);

// 2. Load Excel Pincode_B2B_Delhivery sheet
const wb = XLSX.readFile(EXCEL_PATH);
const mainSheet = wb.Sheets['Pincode_B2B_Delhivery'];
const mainData = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' });
// Headers: S No(0), PINCODE(1), City(2), State(3), Zone(4), ODA(5), Unit Price_Shipshopsy(6)

// 3. Load Shipshopy UTSF
const shipUtsf = JSON.parse(fs.readFileSync(SHIP_UTSF_PATH, 'utf8'));
const shipZoneRates = shipUtsf.pricing?.zoneRates || {};

// 4. Find all mismatched pincodes
const overrides = {};     // pincode -> excelZone
const overrideStats = {}; // pattern -> count

for (let i = 1; i < mainData.length; i++) {
    const row = mainData[i];
    const pin = Number(row[1]);
    if (!pin || isNaN(pin)) continue;

    const excelZone = String(row[4]).trim().toUpperCase();
    const excelRate = Number(row[6]) || null;
    const masterZone = masterZones[pin];

    if (!masterZone || !excelZone || !excelRate) continue;
    if (masterZone === excelZone) continue; // No mismatch

    // Verify that the Excel rate matches the Excel zone's rate (from N1 origin)
    const n1ExcelZoneRate = shipZoneRates['N1']?.[excelZone];
    const n1MasterZoneRate = shipZoneRates['N1']?.[masterZone];

    if (n1ExcelZoneRate !== undefined && Math.abs(n1ExcelZoneRate - excelRate) < 0.01) {
        // Excel rate matches the Excel zone's rate — we can override directly to excelZone
        overrides[pin] = excelZone;
        const pattern = `${masterZone}→${excelZone}`;
        overrideStats[pattern] = (overrideStats[pattern] || 0) + 1;
    } else {
        // Rate doesn't match any existing zone — need a virtual zone
        // Check if the rate matches ANY zone
        let matchedZone = null;
        for (const [zone, rate] of Object.entries(shipZoneRates['N1'] || {})) {
            if (Math.abs(rate - excelRate) < 0.01) {
                matchedZone = zone;
                break;
            }
        }

        if (matchedZone) {
            overrides[pin] = matchedZone;
            const pattern = `${masterZone}→${matchedZone}(rate=${excelRate})`;
            overrideStats[pattern] = (overrideStats[pattern] || 0) + 1;
        } else {
            // No matching zone found — truly need a virtual zone
            console.log(`  ⚠ No matching zone for pin ${pin}: master=${masterZone}, excel=${excelZone}, rate=${excelRate}, N1→${excelZone}=${n1ExcelZoneRate}`);
        }
    }
}

// 5. Report
console.log(`\nZone overrides to apply: ${Object.keys(overrides).length}`);
console.log('\nOverride patterns:');
const sortedPatterns = Object.entries(overrideStats).sort((a, b) => b[1] - a[1]);
for (const [pattern, count] of sortedPatterns) {
    console.log(`  ${pattern}: ${count} pincodes`);
}

// 6. Apply to UTSF
shipUtsf.zoneOverrides = overrides;

// Update metadata
shipUtsf.meta = shipUtsf.meta || {};
shipUtsf.meta.updatedAt = new Date().toISOString();

// Track in updates log
shipUtsf.updates = shipUtsf.updates || [];
shipUtsf.updates.push({
    date: new Date().toISOString(),
    by: 'ZONE_OVERRIDE_SCRIPT',
    changes: `Added ${Object.keys(overrides).length} zone overrides for ${sortedPatterns.length} mismatch patterns`,
    scope: 'zoneOverrides'
});

// 7. Write back
fs.writeFileSync(SHIP_UTSF_PATH, JSON.stringify(shipUtsf, null, 2), 'utf8');
console.log(`\n✅ Updated ${SHIP_UTSF_PATH}`);
console.log(`   Added ${Object.keys(overrides).length} zone overrides`);

// 8. Verify a few samples
console.log('\nSample overrides:');
const samplePins = Object.keys(overrides).slice(0, 10);
for (const pin of samplePins) {
    const override = overrides[pin];
    const master = masterZones[Number(pin)];
    const n1Rate = shipZoneRates['N1']?.[override];
    console.log(`  ${pin}: master=${master} → override=${override} (N1→${override}=₹${n1Rate})`);
}
