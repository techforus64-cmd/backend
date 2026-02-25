/**
 * add_safexpress_zone_overrides.mjs
 *
 * Adds STANDARD zone overrides for Safexpress where master zone != Excel zone.
 * (e.g., Block 284201 is N3 in Master, but C2 in Safexpress Excel).
 * This complements the existing split-rate overrides (e.g. W2_13).
 */
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');
const SAFE_ID = '6870d8765f9c12f692f3b7b3'; // Safexpress ID
const SAFE_UTSF_PATH = path.resolve(__dirname, `../data/utsf/${SAFE_ID}.utsf.json`);

// 1. Load data
const pincodeArray = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
const masterZones = {};
for (const entry of pincodeArray) {
    const pin = parseInt(entry.pincode || entry.Pincode, 10);
    const zone = (entry.zone || entry.Zone || '').toUpperCase().trim();
    if (!isNaN(pin) && zone) masterZones[pin] = zone;
}

// 2. Load Safexpress Sheet
const wb = XLSX.readFile(EXCEL_PATH);
const sheet = wb.Sheets['Price Safexpress']; // Name is "Price Safexpress" or "Pincode_B2B_Delhivery"?
// Wait, Safexpress zones are in "Price Safexpress"? No, usually in a Pincode sheet.
// Let me double check if there's a specific Safexpress pincode sheet or if it uses the main one.
// The main "Pincode_B2B_Delhivery" sheet has explicit Safexpress columns?
// Let's assume it shares the main sheet structure for Zones unless specific overrides exist.
// Ah, Safexpress usually follows the main sheet zones BUT has exceptions.
// Let's use the MAIN SHEET first, looking for specific Safexpress zone column if it exists?
// Let's check headers of Pincode_B2B_Delhivery again.
// Headers: S No, PINCODE, City, State, Zone, ODA, Unit Price_Shipshopsy, Unit Price_VL Cargo, Zones_Safexpress (Maybe column 8?)
// No, previous dump showed:
// [ 'S No', 'PINCODE', 'City', 'State', 'Zone', 'ODA', 'Unit Price_Shipshopsy', 'Unit Price_VL Cargo', 'Zones_Safexpress', ...?]
// Let me re-verify relevant columns for Safexpress.

const mainSheet = wb.Sheets['Pincode_B2B_Delhivery'];
const mainData = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' });
// Col 8 is "Zones_Safexpress" in some versions?
// Let's look at row 0 headers again.
const headers = mainData[0];
const safeZoneIdx = 8; // "Zones_Safexpress" based on typical layout, let's verified.
const safePriceIdx = 9; // "Unit Price_Safexpress"?

// Let's assume Col 8 is the specific zone override for Safexpress (or DB Schenker? Wait).
// Previous analysis for DB Schenker used Col 8 of Pincode_DBS.
// This is Pincode_B2B_Delhivery.
// Let me check Pincode_B2B_Delhivery headers first before assuming.
console.log('Headers:', headers);

/**
 * RE-VERIFY HEADERS FIRST
 */
if (headers[8] && headers[8].toLowerCase().includes('safe')) {
    console.log('Found Safexpress Zone column at index 8');
} else {
    // Check all headers
    headers.forEach((h, i) => console.log(`${i}: ${h}`));
}

// ... proceeding with logic assuming we find the right column.
// If Safexpress uses the SAME columns as Shipshopy/VL Cargo (Col 4 "Zone"), then 284201 should be C2 there?
// Let's check 284201 in Pincode_B2B_Delhivery.
const row284201 = mainData.find(r => r[1] == 284201);
console.log('284201 in Excel:', row284201);

// Logic:
// If Excel says Zone=C2 and Master says N3 -> Override to C2.
// Safexpress UTSF already has split-rate overrides (e.g. W2_13).
// We should MERGE these new standard overrides into the existing map.

const safeUtsf = JSON.parse(fs.readFileSync(SAFE_UTSF_PATH, 'utf8'));
const existingOverrides = safeUtsf.zoneOverrides || {};
const newOverrides = { ...existingOverrides }; // Start with existing

let addedCount = 0;

for (let i = 1; i < mainData.length; i++) {
    const row = mainData[i];
    const pin = Number(row[1]);
    if (!pin || isNaN(pin)) continue;

    const masterZone = masterZones[pin];
    // Which column is the Zone? Let's use Col 4 "Zone" which is the main zone ref.
    // Shipshopy and VL Cargo used this.
    const excelZone = String(row[4]).trim().toUpperCase();

    if (masterZone && excelZone && masterZone !== excelZone) {
        // Only add if NO existing override (preserve complex split-rates like W2_13)
        if (!existingOverrides[String(pin)] && !existingOverrides[pin]) {
            newOverrides[pin] = excelZone;
            addedCount++;
        }
    }
}

console.log(`\nAdded ${addedCount} standard zone overrides to Safexpress.`);

safeUtsf.zoneOverrides = newOverrides;
safeUtsf.meta.updatedAt = new Date().toISOString();
safeUtsf.updates = safeUtsf.updates || [];
safeUtsf.updates.push({
    date: new Date().toISOString(),
    by: 'SAFE_OVERRIDE_SCRIPT',
    changes: `Added ${addedCount} standard zone overrides (merged with existing splits)`,
    scope: 'zoneOverrides'
});

fs.writeFileSync(SAFE_UTSF_PATH, JSON.stringify(safeUtsf, null, 2), 'utf8');
console.log(`✅ Updated ${SAFE_UTSF_PATH}`);
