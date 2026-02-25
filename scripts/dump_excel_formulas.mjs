/**
 * Compute EXACT expected values from Excel for route 110020 → 387610, 100 kg
 * by reading the Price sheets' formulas
 */
import XLSX from 'xlsx';
import fs from 'fs';
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

// Dump ALL rows from each price sheet to understand formulas
const sheets = ['Price_Shipshopy', 'Price_VL Cargo', 'Price Safexpress', 'Price_DB Schenker'];

for (const sheetName of sheets) {
    const data = getSheetData(sheetName);
    if (!data) { console.log(`Sheet ${sheetName}: NOT FOUND`); continue; }
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  ${sheetName} (ALL NON-EMPTY ROWS)`);
    console.log(`${'='.repeat(50)}`);
    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const nonEmpty = row.filter(c => c !== '');
        if (nonEmpty.length > 0) {
            console.log(`  Row ${i}: ${JSON.stringify(row)}`);
        }
    }
}

// Now read formula cells from Price sheets
console.log('\n');
console.log('='.repeat(50));
console.log('  RAW CELL FORMULAS');
console.log('='.repeat(50));

for (const sheetName of sheets) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    console.log(`\n--- ${sheetName} ---`);
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= Math.min(range.e.r, 20); r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const cell = ws[addr];
            if (cell && cell.f) {
                console.log(`  ${addr}: formula="${cell.f}", value=${cell.v}`);
            }
        }
    }
}

// Read Input and Output sheet to see formula references
console.log('\n');
console.log('='.repeat(50));
console.log('  INPUT AND OUTPUT - FORMULAS');
console.log('='.repeat(50));
const ioWs = wb.Sheets['Input and Output'];
if (ioWs) {
    const range = XLSX.utils.decode_range(ioWs['!ref']);
    for (let r = range.s.r; r <= Math.min(range.e.r, 20); r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const cell = ioWs[addr];
            if (cell) {
                const info = cell.f ? `formula="${cell.f}", value=${cell.v}` : `value=${JSON.stringify(cell.v)}`;
                console.log(`  ${addr}: ${info}`);
            }
        }
    }
}
