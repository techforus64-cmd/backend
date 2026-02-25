/**
 * identify_missing_zones.mjs
 *
 * Identifies zones that have valid rates in the Excel file but are missing
 * from the UTSF serviceability configuration.
 */
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');

const VENDORS = [
    { name: 'Shipshopy', col: 6, id: '6968ddedc2cf85d3f4380d52' },
    { name: 'VL Cargo', col: 7, id: '67b4b800cf900000000000c1' },
    { name: 'DB Schenker', col: 8, id: '67b4b800db5c000000000001' },
    { name: 'Safexpress', col: 9, id: '6870d8765f9c12f692f3b7b3' }
];

console.log('Loading Excel...');
const wb = XLSX.readFile(EXCEL_PATH);
const sheet = wb.Sheets['Pincode_B2B_Delhivery'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

// 1. Collect Excel Zones per Vendor from Main Sheet
const excelZones = {}; // { VendorName: Set(Zones) }
VENDORS.forEach(v => excelZones[v.name] = new Set());

for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const zone = String(row[4]).trim(); // Column E: Zone
    if (!zone) continue;

    VENDORS.forEach(v => {
        const rate = Number(row[v.col]);
        if (rate && rate > 0) {
            excelZones[v.name].add(zone);
        }
    });
}

// 1b. Collect DB Schenker Zones from Pincode_DBS (Primary source for DBS)
const dbsSheet = wb.Sheets['Pincode_DBS'];
if (dbsSheet) {
    const dbsData = XLSX.utils.sheet_to_json(dbsSheet, { header: 1, defval: '' });
    // Headers: S No, Pincode, City, State, ODA, Zone, "", "", Zone(DBS), Price

    for (let i = 1; i < dbsData.length; i++) {
        const row = dbsData[i];
        const price = Number(row[9]); // Column J: Price
        if (price && price > 0) {
            // Use Zone(DBS) Col I (8) if present, else Zone Col F (5)
            const z = String(row[8]).trim() || String(row[5]).trim();
            if (z) excelZones['DB Schenker'].add(z);
        }
    }
}

// 2. Check UTSF Serviceability
console.log('\nChecking UTSF configurations...');
VENDORS.forEach(v => {
    const filePath = path.join(UTSF_DIR, `${v.id}.utsf.json`);
    let utsfZones = [];
    try {
        const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (json.serviceability) {
            utsfZones = Object.keys(json.serviceability);
        }
    } catch (e) {
        console.error(`Error loading ${v.name}: ${e.message}`);
        return;
    }

    const missing = [];
    const empty = [];
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Check if zone exists AND has coverage
    excelZones[v.name].forEach(z => {
        if (!json.serviceability || !json.serviceability[z]) {
            missing.push(z);
        } else {
            const stats = json.serviceability[z];
            const count = (stats.servedSingles ? stats.servedSingles.length : 0) +
                (stats.servedRanges ? stats.servedRanges.length : 0);
            if (count === 0 && stats.mode === 'ONLY_SERVED') {
                empty.push(z);
            }
        }
    });

    console.log(`\n--- ${v.name} ---`);
    console.log(`  Excel Zones with Rates: ${excelZones[v.name].size}`);

    if (missing.length > 0) {
        console.log(`  MISSING ZONES (${missing.length}): ${missing.join(', ')}`);
    }
    if (empty.length > 0) {
        console.log(`  EMPTY ZONES (Configured but 0 served): ${empty.join(', ')}`);
    }
    if (missing.length === 0 && empty.length === 0) {
        console.log(`  All required zones configured and populated.`);
    }
});
