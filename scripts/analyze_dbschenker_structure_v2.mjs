/**
 * analyze_dbschenker_structure_v2.mjs
 *
 * Concise analysis of DB Schenker pricing structure.
 */
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');

const wb = XLSX.readFile(EXCEL_PATH);
const sheet = wb.Sheets['Pincode_DBS'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

// Mappings
const zonePrices = {}; // Zone (Idx 8 or 5) -> Set(Prices)

for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const pin = row[1];
    if (!pin) continue;

    const z1 = String(row[5]).trim().toUpperCase();
    const z2 = String(row[8]).trim().toUpperCase();
    const price = row[9];

    // Use Z2 (Index 8) if present, else Z1 (Index 5)
    const effectiveZone = z2 || z1;

    if (effectiveZone && (price !== '' && price !== undefined)) {
        if (!zonePrices[effectiveZone]) zonePrices[effectiveZone] = new Set();
        zonePrices[effectiveZone].add(Number(price));
    }
}

console.log('--- Price Distribution per Zone ---');
let hasSplitRates = false;
for (const [zone, prices] of Object.entries(zonePrices)) {
    const priceArray = Array.from(prices).sort((a, b) => a - b);
    if (prices.size > 1) {
        hasSplitRates = true;
        console.log(`[SPLIT] Zone ${zone} has ${prices.size} prices: ${priceArray.join(', ')}`);
    } else {
        // console.log(`[SINGLE] Zone ${zone}: ${priceArray[0]}`);
    }
}

if (!hasSplitRates) {
    console.log('No split rates found! Simple overrides are sufficient.');
} else {
    console.log('Split rates found! Virtual zones needed (Safexpress style).');
}
