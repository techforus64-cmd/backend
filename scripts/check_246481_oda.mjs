
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

// Master
const masterSheet = wb.Sheets['Pincode_B2B_Delhivery'];
const masterData = XLSX.utils.sheet_to_json(masterSheet, { header: 1, defval: '' });
let masterOda = 'Not Found';
for (let i = 1; i < masterData.length; i++) {
    if (Number(masterData[i][1]) === 246481) {
        masterOda = masterData[i][5]; // Col F
        break;
    }
}

// DBS
const dbsSheet = wb.Sheets['Pincode_DBS'];
const dbsData = XLSX.utils.sheet_to_json(dbsSheet, { header: 1, defval: '' });
let dbsOda = 'Not Found';
for (let i = 1; i < dbsData.length; i++) {
    if (Number(dbsData[i][1]) === 246481) {
        dbsOda = dbsData[i][4]; // Col E
        break;
    }
}

console.log(`246481 in Master: ${masterOda}`);
console.log(`246481 in DBS: ${dbsOda}`);

// UTSF
const utsf = JSON.parse(fs.readFileSync(UTSF_PATH, 'utf8'));
const inList = utsf.odaPincodes ? utsf.odaPincodes.includes(246481) : false;
console.log(`246481 in UTSF odaPincodes: ${inList}`);
