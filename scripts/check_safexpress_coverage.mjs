
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');

console.log('Loading Excel...');
const wb = XLSX.readFile(EXCEL_PATH);
const sheet = wb.Sheets['Pincode_B2B_Delhivery'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

// Check 781068
const target = 781068;
let found = null;

for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const pin = Number(row[1]);
    if (pin === target) {
        found = {
            pin,
            masterZone: row[4],
            safexpressRate: row[7], // Safexpress is Col H (index 7) usually? Or I? 
            // Lets print row
            row
        };
        break;
    }
}

if (found) {
    console.log(`Found ${target} in Excel:`);
    console.log(`Zone: ${found.masterZone}`);
    // Check Safexpress Price
    // Headers: Pin(B), Zone(E), Shipshopy(F), VLCargo(G), Safexpress(H), DBS(I)
    console.log(`Safexpress Rate: ${found.row[7]}`); // Index 7 is Col H
} else {
    console.log(`${target} NOT found in Excel.`);
}
