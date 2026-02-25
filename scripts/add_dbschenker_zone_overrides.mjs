/**
 * add_dbschenker_zone_overrides.mjs
 *
 * Imports DB Schenker zones and ODA status from Pincode_DBS sheet.
 * 1. Read Excel: Zone (Col 8 > Col 5), ODA (Col 4)
 * 2. Generate zoneOverrides for mismatches
 * 3. Update ODA Pincode List (match Excel exactly)
 * 4. Unblock exceptions that get overridden
 */
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');
const DBS_ID = '67b4b800db5c000000000001';
const DBS_UTSF_PATH = path.resolve(__dirname, `../data/utsf/${DBS_ID}.utsf.json`);

// 1. Load data
const pincodeArray = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
const masterZones = {};
for (const entry of pincodeArray) {
    const pin = parseInt(entry.pincode || entry.Pincode, 10);
    const zone = (entry.zone || entry.Zone || '').toUpperCase().trim();
    if (!isNaN(pin) && zone) masterZones[pin] = zone;
}

const wb = XLSX.readFile(EXCEL_PATH);
const sheet = wb.Sheets['Pincode_DBS'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

const dbsUtsf = JSON.parse(fs.readFileSync(DBS_UTSF_PATH, 'utf8'));

// 2. Process Excel
const overrides = {};
const odaPincodes = new Set();
const stats = { zoneMismatches: 0, odaMismatches: 0 };

// Skip header
for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const pin = Number(row[1]);
    if (!pin || isNaN(pin)) continue;

    // READ ZONES
    const masterZone = masterZones[pin];
    const z1 = String(row[5]).trim().toUpperCase(); // Col 5
    const z2 = String(row[8]).trim().toUpperCase(); // Col 8 (Priority)
    const excelZone = z2 || z1; // Use z2 if available, else z1

    if (masterZone && excelZone && masterZone !== excelZone) {
        overrides[pin] = excelZone;
        stats.zoneMismatches++;
    }

    // READ ODA
    const odaStatus = String(row[4]).trim().toLowerCase(); // Col 4: "Yes" or "No"
    if (odaStatus === 'yes') {
        odaPincodes.add(pin);
    }
}

console.log(`\nFound ${stats.zoneMismatches} zone mismatches.`);
console.log(`Found ${odaPincodes.size} ODA pincodes in Excel.`);

// 3. Apply Zone Overrides
dbsUtsf.zoneOverrides = overrides;

// 4. Update ODA in UTSF
//    We need to replace the ENTIRE ODA definition to match Excel exactly.
//    Safest way: clear existing ODA sets and add these as 'odaSingles'.
dbsUtsf.oda = dbsUtsf.oda || {};
// Reset ODA structure to a single clean list
dbsUtsf.oda = {
    "manual_sync": {
        "ioda": 0, // Not used?
        "odaSingles": Array.from(odaPincodes).sort((a, b) => a - b),
        "odaRanges": []
    }
};
console.log(`Updated ODA list with ${odaPincodes.size} pincodes.`);

// 5. Unblock Exceptions
const serviceability = dbsUtsf.serviceability || {};
let totalUnblocked = 0;

for (const [zone, coverage] of Object.entries(serviceability)) {
    // Singles
    if (coverage.exceptSingles && coverage.exceptSingles.length > 0) {
        const before = coverage.exceptSingles.length;
        coverage.exceptSingles = coverage.exceptSingles.filter(pin => !overrides[pin]);
        const removed = before - coverage.exceptSingles.length;
        if (removed > 0) totalUnblocked += removed;
    }
    // Soft
    if (coverage.softExclusions && coverage.softExclusions.length > 0) {
        const before = coverage.softExclusions.length;
        coverage.softExclusions = coverage.softExclusions.filter(pin => !overrides[pin]);
        const removed = before - coverage.softExclusions.length;
        if (removed > 0) totalUnblocked += removed;
    }
}
console.log(`Unblocked ${totalUnblocked} exceptions because of overrides.`);

// Metadata
dbsUtsf.meta = dbsUtsf.meta || {};
dbsUtsf.meta.updatedAt = new Date().toISOString();
dbsUtsf.updates = dbsUtsf.updates || [];
dbsUtsf.updates.push({
    date: new Date().toISOString(),
    by: 'DBS_OVERRIDE_SCRIPT',
    changes: `Added ${Object.keys(overrides).length} zone overrides, synced ${odaPincodes.size} ODA pins, unblocked ${totalUnblocked} exceptions`,
    scope: 'zoneOverrides+oda+serviceability'
});

fs.writeFileSync(DBS_UTSF_PATH, JSON.stringify(dbsUtsf, null, 2), 'utf8');
console.log(`✅ Updated ${DBS_UTSF_PATH}`);
