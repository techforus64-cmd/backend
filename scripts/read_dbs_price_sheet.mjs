import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');

console.log(`Reading ${EXCEL_PATH}`);
const wb = XLSX.readFile(EXCEL_PATH);
const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('price') && s.toLowerCase().includes('schenker'));

if (sheetName) {
    console.log(`Found Sheet: ${sheetName}`);
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });

    // Print full first 10 rows to locate data
    for (let i = 0; i < 15; i++) {
        const row = data[i] || [];
        console.log(`Row ${i}:`, JSON.stringify(row));
    }
} else {
    console.log('Sheet not found');
}
