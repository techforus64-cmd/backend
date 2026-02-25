/**
 * analyze_dbschenker_structure.mjs
 *
 * Analyzes the Pincode_DBS sheet to understand Zone and Price columns.
 * Specifically checks if "Zone" implies a unique "Price" or if split rates exist.
 */
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');

const wb = XLSX.readFile(EXCEL_PATH);
const sheet = wb.Sheets['Pincode_DBS'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

// Headers (Row 0)
const headers = data[0];
console.log('Headers:', headers);

// Stats
let totalRows = 0;
let hasIndex5 = 0; // Zone 1
let hasIndex8 = 0; // Zone 2
let hasIndex9 = 0; // Price

// Mappings
const zonePrices = {}; // Zone -> Set(Prices)
const index5Prices = {}; // Index5 Zone -> Set(Prices)

for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const pin = row[1];
    if (!pin) continue;

    totalRows++;
    const z1 = String(row[5]).trim().toUpperCase();
    const z2 = String(row[8]).trim().toUpperCase();
    const price = row[9];

    if (z1) hasIndex5++;
    if (z2) hasIndex8++;
    if (price !== '' && price !== undefined) hasIndex9++;

    // Logic: Which zone is authoritative?
    // Use Z2 if present, else Z1?
    const effectiveZone = z2 || z1;

    if (effectiveZone && (price !== '' && price !== undefined)) {
        if (!zonePrices[effectiveZone]) zonePrices[effectiveZone] = new Set();
        zonePrices[effectiveZone].add(Number(price));
    }

    if (z1 && (price !== '' && price !== undefined)) {
        if (!index5Prices[z1]) index5Prices[z1] = new Set();
        index5Prices[z1].add(Number(price));
    }
}

console.log(`\nTotal Pincodes: ${totalRows}`);
console.log(`Has Zone (Idx 5): ${hasIndex5}`);
console.log(`Has Zone (Idx 8): ${hasIndex8}`);
console.log(`Has Price (Idx 9): ${hasIndex9}`);

console.log('\n--- Effective Zone (Idx 8 priority) Price Distribution ---');
for (const [zone, prices] of Object.entries(zonePrices)) {
    const priceArray = Array.from(prices).sort((a, b) => a - b);
    console.log(`Zone ${zone}: ${prices.size} distinct prices -> [${priceArray.join(', ')}]`);
}

console.log('\n--- Index 5 Zone Price Distribution ---');
for (const [zone, prices] of Object.entries(index5Prices)) {
    const priceArray = Array.from(prices).sort((a, b) => a - b);
    if (prices.size > 1) {
        console.log(`Zone ${zone}: ${prices.size} distinct prices -> [${priceArray.join(', ')}]`);
    }
}
