
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DBS_ID = '67b4b800db5c000000000001';
const UTSF_PATH = path.resolve(__dirname, `../data/utsf/${DBS_ID}.utsf.json`);
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');

console.log('Loading Excel...');
const wb = XLSX.readFile(EXCEL_PATH);
const masterSheet = wb.Sheets['Pincode_B2B_Delhivery'];
const masterData = XLSX.utils.sheet_to_json(masterSheet, { header: 1, defval: '' });

const dbsSheet = wb.Sheets['Pincode_DBS'];
const dbsData = XLSX.utils.sheet_to_json(dbsSheet, { header: 1, defval: '' });

// 1. Identify ODA Pincodes
// Priority: Pincode_DBS ODA > Pincode_B2B_Delhivery ODA
const odaPincodes = new Set();
// Load from Master (Col F/5)
for (let i = 1; i < masterData.length; i++) {
    const row = masterData[i];
    const pin = Number(row[1]);
    const oda = String(row[5]).trim().toLowerCase();
    if (pin && oda === 'yes') odaPincodes.add(pin);
}
// Load from DBS (Col E/4)
for (let i = 1; i < dbsData.length; i++) {
    const row = dbsData[i];
    const pin = Number(row[1]);
    const oda = String(row[4]).trim().toLowerCase();
    if (pin && oda === 'yes') odaPincodes.add(pin);
    else if (pin && oda === 'no') odaPincodes.delete(pin);
}
console.log(`Identified ${odaPincodes.size} ODA Pincodes for DB Schenker.`);

// 2. Load UTSF
const utsfData = JSON.parse(fs.readFileSync(UTSF_PATH, 'utf8'));

// 3. Update ODA Pincodes in UTSF
// Assuming 'odaPincodes' top-level array
utsfData.odaPincodes = Array.from(odaPincodes).sort((a, b) => a - b);
console.log('Updated odaPincodes list.');

// 4. Fix Zone Rates
// NE2 -> 23.5 (Verified from Excel analysis to be the correct rate for ~835 pins)
// UTSF currently has 20.
if (utsfData.pricing && utsfData.pricing.zoneRates) {
    let updateCount = 0;
    Object.keys(utsfData.pricing.zoneRates).forEach(origin => {
        const destRates = utsfData.pricing.zoneRates[origin];
        if (destRates && destRates.NE2 !== undefined) {
            // Force update
            destRates.NE2 = 23.5;
            updateCount++;
        }
    });
    console.log(`Updated NE2 rate to 23.5 in ${updateCount} origins.`);
}

// 5. Save
fs.writeFileSync(UTSF_PATH, JSON.stringify(utsfData, null, 2), 'utf8');
console.log('Saved updated UTSF file.');
