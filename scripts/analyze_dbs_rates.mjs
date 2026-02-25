/**
 * analyze_dbs_rates.mjs
 *
 * Scans DB Schenker rates in the Master Sheet to infer Zone Rates.
 */
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');

console.log('Loading Excel...');
const wb = XLSX.readFile(EXCEL_PATH);
const sheet = wb.Sheets['Pincode_B2B_Delhivery'];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

const rateCounts = {}; // { Zone: { Rate: Count } }
const pinZoneMap = {}; // { Pincode: { Zone: Rate } }

for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const pin = Number(row[1]);
    const zone = String(row[4]).trim();
    const rate = Number(row[8]); // Col I for DBS

    if (pin && zone && rate > 0) {
        if (!rateCounts[zone]) rateCounts[zone] = {};
        rateCounts[zone][rate] = (rateCounts[zone][rate] || 0) + 1;
    }
}

console.log('DBS Rates per Zone (Master Sheet):');
Object.keys(rateCounts).sort().forEach(zone => {
    console.log(`\nZone: ${zone}`);
    Object.keys(rateCounts[zone]).forEach(rate => {
        console.log(`  Rate ${rate}: ${rateCounts[zone][rate]} pincodes`);
    });
});
