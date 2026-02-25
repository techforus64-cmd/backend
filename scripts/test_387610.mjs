/**
 * Test calculation for 110020 → 387610, 100 kg
 * This is the exact route from the user's screenshots
 */
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');

const utsfModulePath = pathToFileURL(path.resolve(__dirname, '../services/utsfService.js')).href;
const { UTSFTransporter } = await import(utsfModulePath);

// Load master pincodes
const pincodeArray = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
const masterPincodes = {};
for (const entry of pincodeArray) {
    const pin = entry.pincode || entry.Pincode;
    const zone = entry.zone || entry.Zone;
    if (pin && zone) masterPincodes[parseInt(pin, 10)] = zone;
}

console.log(`Master pincodes loaded: ${Object.keys(masterPincodes).length}`);
console.log(`Zone of 110020: ${masterPincodes[110020]}`);
console.log(`Zone of 387610: ${masterPincodes[387610] || 'NOT FOUND'}`);

// Check the Excel pincode sheet for 387610
const excelPath = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');
if (fs.existsSync(excelPath)) {
    const wb = XLSX.readFile(excelPath);

    // Check main pincode sheet
    const mainSheet = wb.Sheets['Pincode_B2B_Delhivery'];
    if (mainSheet) {
        const mainData = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' });
        console.log('\n=== Searching 387610 in Pincode_B2B_Delhivery ===');
        console.log('Headers:', JSON.stringify(mainData[0]));

        for (let i = 1; i < mainData.length; i++) {
            const row = mainData[i];
            if (String(row[1]) === '387610' || row[1] === 387610) {
                console.log(`Found at row ${i}: ${JSON.stringify(row)}`);
            }
        }

        // Also search nearby pincodes (3876xx)
        console.log('\n=== All 3876xx pincodes in Excel ===');
        for (let i = 1; i < mainData.length; i++) {
            const row = mainData[i];
            const pin = String(row[1]);
            if (pin.startsWith('3876')) {
                console.log(`  Row ${i}: pincode=${pin}, zone=${row[4]}, ODA=${row[3]}, shipshopy_rate=${row[7]}, safe_rate=${row[9]}, vlcargo=${row[11]}`);
            }
        }
    }

    // Check DBS pincode sheet  
    const dbsSheet = wb.Sheets['Pincode_DBS'];
    if (dbsSheet) {
        const dbsData = XLSX.utils.sheet_to_json(dbsSheet, { header: 1, defval: '' });
        console.log('\n=== Searching 387610 in Pincode_DBS ===');
        for (let i = 1; i < dbsData.length; i++) {
            const row = dbsData[i];
            if (String(row[1]) === '387610' || row[1] === 387610) {
                console.log(`Found at row ${i}: ${JSON.stringify(row)}`);
            }
        }
    }

    // List all sheet names
    console.log('\n=== Excel sheet names ===');
    console.log(wb.SheetNames);

    // Check if there's a specific "Input and Output" sheet and what it says
    const ioSheet = wb.Sheets['Input and Output'];
    if (ioSheet) {
        const ioData = XLSX.utils.sheet_to_json(ioSheet, { header: 1, defval: '' });
        console.log('\n=== Input and Output sheet (first 30 rows) ===');
        for (let i = 0; i < Math.min(30, ioData.length); i++) {
            const row = ioData[i];
            const nonEmpty = row.filter(c => c !== '');
            if (nonEmpty.length > 0) console.log(`  Row ${i}: ${JSON.stringify(row)}`);
        }
    }
} else {
    console.log('Excel file not found at:', excelPath);
}

// Load transporters
function loadTransporter(id) {
    const filePath = path.join(UTSF_DIR, `${id}.utsf.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new UTSFTransporter(data, masterPincodes);
}

const safexpress = loadTransporter('6870d8765f9c12f692f3b7b3');
const vlc = loadTransporter('67b4b800cf900000000000c1');
const shipshopy = loadTransporter('6968ddedc2cf85d3f4380d52');

const FROM = 110020;
const TO = 387610;
const WEIGHT = 100;

console.log(`\n${'='.repeat(60)}`);
console.log(`  Route: ${FROM} → ${TO}, Weight: ${WEIGHT} kg`);
console.log(`${'='.repeat(60)}`);

// Check serviceability for each
for (const [name, t] of [['Safexpress', safexpress], ['VL Cargo', vlc], ['Shipshopy', shipshopy]]) {
    console.log(`\n--- ${name} ---`);
    const fromSvc = t.checkServiceability(FROM);
    const toSvc = t.checkServiceability(TO);
    console.log(`  From (${FROM}): isServiceable=${fromSvc.isServiceable}, zone=${fromSvc.zone}`);
    console.log(`  To (${TO}): isServiceable=${toSvc.isServiceable}, zone=${toSvc.zone}, isOda=${toSvc.isOda}, reason=${toSvc.reason}`);

    if (fromSvc.isServiceable && toSvc.isServiceable) {
        const result = t.calculatePrice(FROM, TO, WEIGHT, 1);
        if (result && !result.error) {
            console.log(`  Total: ₹${result.totalCharges}`);
            console.log(`  Breakdown: base=₹${result.baseFreight}, fuel=₹${result.breakdown?.fuelCharges}, docket=₹${result.breakdown?.docketCharge}, ODA=₹${result.breakdown?.odaCharges}, ROV=₹${result.breakdown?.rovCharges}`);
            console.log(`  Zones: ${result.originZone} → ${result.destZone}, isOda=${result.isOda}`);
        } else {
            console.log(`  Error: ${result?.error || 'null result'}`);
        }
    } else {
        console.log(`  NOT SERVICEABLE`);
    }
}
