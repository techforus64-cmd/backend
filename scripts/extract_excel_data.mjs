/**
 * Deep-dive into DB Schenker zone system & Safexpress multi-rate zones
 */
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const excelPath = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');
const wb = XLSX.readFile(excelPath);

function getSheetData(name) {
    const ws = wb.Sheets[name];
    if (!ws) return null;
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

// ===== DBS ZONE SYSTEM =====
const dbsData = getSheetData('Pincode_DBS');
console.log('=== Pincode_DBS ===');
console.log('Headers:', JSON.stringify(dbsData[0]));
console.log('Row 1:', JSON.stringify(dbsData[1]));
console.log('Row 2:', JSON.stringify(dbsData[2]));

// The DBS sheet has columns: S No, Pincode, City, State, ODA, Zone(main), "", "", Zone(DBS), Price
// The Zone at idx 5 is the Main zone, Zone at idx 8 is the DBS internal zone, Price at idx 9
const dbsZoneRates = {};
const mainZoneToDBS = {};
for (let i = 1; i < dbsData.length; i++) {
    const row = dbsData[i];
    const mainZone = String(row[5]).trim();
    const dbsZone = String(row[8]).trim();
    const price = row[9];

    if (mainZone && dbsZone && price !== '' && !isNaN(Number(price))) {
        if (!dbsZoneRates[dbsZone]) dbsZoneRates[dbsZone] = new Set();
        dbsZoneRates[dbsZone].add(Number(price));

        if (!mainZoneToDBS[mainZone]) mainZoneToDBS[mainZone] = new Set();
        mainZoneToDBS[mainZone].add(dbsZone);
    }
}

console.log('\nDBS zone rates (DBS internal zone → rate):');
for (const [zone, rates] of Object.entries(dbsZoneRates).sort()) {
    console.log(`  ${zone}: ${Array.from(rates).join(', ')}`);
}

console.log('\nMain zone → DBS zone mapping:');
for (const [main, dbsSet] of Object.entries(mainZoneToDBS).sort()) {
    console.log(`  ${main} → ${Array.from(dbsSet).sort().join(', ')}`);
}

// ===== SAFEXPRESS MULTIPLE RATES =====
// Check which pincodes have different rates within same zone
const mainData = getSheetData('Pincode_B2B_Delhivery');
console.log('\n=== Safexpress Multi-Rate Zones ===');
const safeRateByZone = {};
for (let i = 1; i < mainData.length; i++) {
    const row = mainData[i];
    const zone = String(row[4]).trim();
    const safePrice = row[9];
    if (zone && safePrice !== '' && !isNaN(Number(safePrice))) {
        if (!safeRateByZone[zone]) safeRateByZone[zone] = {};
        const priceVal = Number(safePrice);
        if (!safeRateByZone[zone][priceVal]) safeRateByZone[zone][priceVal] = 0;
        safeRateByZone[zone][priceVal]++;
    }
}

for (const [zone, rates] of Object.entries(safeRateByZone).sort()) {
    const entries = Object.entries(rates).sort((a, b) => Number(b[1]) - Number(a[1]));
    if (entries.length > 1) {
        console.log(`  ${zone}: ${entries.map(([r, c]) => `${r}(${c}x)`).join(', ')}`);
    } else {
        console.log(`  ${zone}: ${entries[0][0]} (uniform)`);
    }
}

// ===== Check ODA charge formulas from each price sheet =====
console.log('\n=== Vendor Charge Config ===');

// Read the price sheets for charge info (formulas embedded in Excel)
const shipData = getSheetData('Price_Shipshopy');
console.log('\nShipshopy charge rows:');
shipData.forEach((row, i) => {
    const nonEmpty = row.filter(c => c !== '');
    if (nonEmpty.length > 0) console.log(`  Row${i}: ${JSON.stringify(row)}`);
});

const vlData = getSheetData('Price_VL Cargo');
console.log('\nVL Cargo charge rows:');
vlData.forEach((row, i) => {
    const nonEmpty = row.filter(c => c !== '');
    if (nonEmpty.length > 0) console.log(`  Row${i}: ${JSON.stringify(row)}`);
});

const safeData = getSheetData('Price Safexpress');
console.log('\nSafexpress charge rows:');
safeData.forEach((row, i) => {
    const nonEmpty = row.filter(c => c !== '');
    if (nonEmpty.length > 0) console.log(`  Row${i}: ${JSON.stringify(row)}`);
});

const dbsSheetData = getSheetData('Price_DB Schenker');
console.log('\nDB Schenker charge rows:');
dbsSheetData.forEach((row, i) => {
    const nonEmpty = row.filter(c => c !== '');
    if (nonEmpty.length > 0) console.log(`  Row${i}: ${JSON.stringify(row)}`);
});
