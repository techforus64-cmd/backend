/**
 * test_nonoda_random.mjs
 *
 * 10 random NON-ODA test cases across all 4 vendors (Shipshopy, Safexpress, DB Schenker, VL Cargo)
 * Each test picks a destination from a different zone to ensure geographic diversity.
 * Expected values are computed using the exact Excel formulas.
 *
 * Excel formulas (from Price sheets):
 *   Shipshopy:   base = rate*weight, fuel = 0%, docket+ROV = 100, ODA = 0 (non-ODA)
 *   VL Cargo:    base = 18*weight,   fuel = 0%, docket+ROV = 0,   ODA = 0 (non-ODA)
 *   Safexpress:  base = rate*weight,  fuel = min(5%*base, 400), docket+ROV = 450, ODA = 0 (non-ODA)
 *   DB Schenker: base = rate*weight,  fuel = 5%*base, docket = 100, ODA = 0 (non-ODA)
 *                total = max(base+fuel+docket, 400)
 *
 * Run:  node backend/scripts/test_nonoda_random.mjs
 */
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');

// Load UTSF service
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

// Load Excel pincode data
const wb = XLSX.readFile(EXCEL_PATH);
const mainSheet = wb.Sheets['Pincode_B2B_Delhivery'];
const mainData = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' });
// Headers: S No, PINCODE, Facility City, Facility State, Zone, ODA,
//          Unit Price_Shipshopsy, Unit Price_VL Cargo, Unit Price_D B Schenker, Unit Price_Safeexpress

// Build Excel lookup: pincode -> { zone, oda, shipRate, vlRate, dbsRate, safeRate, city, state }
const excelData = new Map();
for (let i = 1; i < mainData.length; i++) {
    const row = mainData[i];
    const pin = Number(row[1]);
    if (!pin || isNaN(pin)) continue;
    excelData.set(pin, {
        zone: String(row[4]).trim(),
        oda: String(row[5]).trim(),
        city: String(row[2]).trim(),
        state: String(row[3]).trim(),
        shipRate: Number(row[6]) || null,
        vlRate: Number(row[7]) || null,
        dbsRate: Number(row[8]) || null,
        safeRate: Number(row[9]) || null,
    });
}

// DBS has its own zone system — load from Pincode_DBS
const dbsSheet = wb.Sheets['Pincode_DBS'];
const dbsData = XLSX.utils.sheet_to_json(dbsSheet, { header: 1, defval: '' });
// Headers: S No, Pincode, City, State, ODA, Zone, "", "", Zone(DBS), Price
const dbsPincodeData = new Map();
for (let i = 1; i < dbsData.length; i++) {
    const row = dbsData[i];
    const pin = Number(row[1]);
    if (!pin || isNaN(pin)) continue;
    dbsPincodeData.set(pin, {
        oda: String(row[4]).trim(),
        mainZone: String(row[5]).trim(),
        dbsZone: String(row[8]).trim(),
        price: Number(row[9]) || null,
    });
}

// Load transporters
function loadTransporter(id) {
    const filePath = path.join(UTSF_DIR, `${id}.utsf.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new UTSFTransporter(data, masterPincodes);
}

const SHIP_ID = '6968ddedc2cf85d3f4380d52';
const SAFE_ID = '6870d8765f9c12f692f3b7b3';
const DBS_ID = '67b4b800db5c000000000001';
const VLC_ID = '67b4b800cf900000000000c1';

const shipshopy = loadTransporter(SHIP_ID);
const safexpress = loadTransporter(SAFE_ID);
const dbs = loadTransporter(DBS_ID);
const vlc = loadTransporter(VLC_ID);

const FROM = 110020; // Origin: Delhi N1

// Pick 10 non-ODA pincodes from diverse zones
// Criteria: ODA="No", pincode in master, from 10 different zones
const targetZones = ['N2', 'N3', 'N4', 'C1', 'C2', 'W1', 'W2', 'S1', 'S2', 'E1'];
const testPincodes = [];

for (const zone of targetZones) {
    // Find a non-ODA pincode in this zone from Excel data
    for (const [pin, data] of excelData) {
        if (data.zone === zone && data.oda === 'No' && masterPincodes[pin]) {
            // Also verify it's serviceable by at least some vendors
            testPincodes.push({ pin, ...data });
            break;
        }
    }
}

// Random weights for variety
const weights = [50, 100, 200, 500, 800, 1500, 2500, 3000, 5000, 10000];

console.log('\n');
console.log('='.repeat(70));
console.log('  NON-ODA Verification: 10 Routes × 4 Vendors = 40 Tests');
console.log('  Origin: 110020 (Delhi, N1)');
console.log('='.repeat(70));

let totalPassed = 0;
let totalFailed = 0;

/**
 * Compute expected price using Excel formula
 */
function excelExpected(vendor, rate, weight, dest) {
    if (!rate || rate <= 0) return null; // No rate for this vendor

    const base = rate * weight;

    if (vendor === 'Shipshopy') {
        // Shipshopy: weight = max(weight, 20), fuel=0%, docket+ROV=100, ODA = 0 (non-ODA)
        const w = Math.max(weight, 20);
        const b = rate * w;
        return { total: b + 100, base: b, fuel: 0, docket: 100, oda: 0 };
    }
    if (vendor === 'VL Cargo') {
        // VL Cargo: fuel=0%, everything=0
        return { total: base, base, fuel: 0, docket: 0, oda: 0 };
    }
    if (vendor === 'Safexpress') {
        // Safexpress: weight = max(weight, 20), fuel=min(5%*base, 400), docket+ROV=450
        const w = Math.max(weight, 20);
        const b = rate * w;
        const fuel = Math.min(0.05 * b, 400);
        return { total: b + fuel + 450, base: b, fuel, docket: 450, oda: 0 };
    }
    if (vendor === 'DB Schenker') {
        const isOda = dbsPincodeData.get(dest.pin)?.oda?.toLowerCase() === 'yes';
        // DB Schenker: weight = max(weight, 50), fuel=5%*base, docket=100
        const w = Math.max(weight, 50);
        const b = rate * w;
        const fuel = 0.05 * b;

        // ODA Calculation (Switch Mode): if weight <= 212 then 850, else 4*weight
        let dbsOda = 0;
        if (isOda) {
            dbsOda = weight <= 212 ? 850 : 4 * weight;
        }

        const total = Math.max(b + fuel + 100 + dbsOda, 400);
        return { total, base: b, fuel, docket: 100, oda: dbsOda };
    }
    return null;
}

for (let i = 0; i < testPincodes.length; i++) {
    const dest = testPincodes[i];
    const weight = weights[i];

    console.log(`\n╔${'═'.repeat(68)}╗`);
    console.log(`║ Test ${i + 1}: ${FROM} → ${dest.pin} (${dest.city}, ${dest.state}) | Zone: ${dest.zone} | ${weight} kg`);
    console.log(`╚${'═'.repeat(68)}╝`);

    // Get DBS rate from its own pincode sheet
    const dbsInfo = dbsPincodeData.get(dest.pin);
    const dbsRate = dbsInfo?.price || dest.dbsRate;

    const vendors = [
        { name: 'Shipshopy', t: shipshopy, rate: dest.shipRate },
        { name: 'Safexpress', t: safexpress, rate: dest.safeRate },
        { name: 'DB Schenker', t: dbs, rate: dbsRate },
        { name: 'VL Cargo', t: vlc, rate: dest.vlRate },
    ];

    for (const v of vendors) {
        const expected = excelExpected(v.name, v.rate, weight, dest);

        // UTSF calculation
        const result = v.t.calculatePrice(FROM, dest.pin, weight, 1);

        if (!result || result.error) {
            if (!expected) {
                console.log(`  ${v.name.padEnd(14)} — SKIP (no Excel rate & UTSF not serviceable)`);
            } else {
                console.log(`  ${v.name.padEnd(14)} — FAIL (UTSF error: ${result?.error || 'null'}, Excel expects ₹${expected.total})`);
                totalFailed++;
            }
            continue;
        }

        const utsfTotal = Math.round((result.totalCharges ?? 0) * 100) / 100;
        const utsfOda = result.breakdown?.odaCharges ?? 0;

        if (!expected) {
            console.log(`  ${v.name.padEnd(14)} — WARN (no Excel rate but UTSF returned ₹${utsfTotal})`);
            continue;
        }

        const excelTotal = Math.round(expected.total * 100) / 100;
        const diff = Math.abs(utsfTotal - excelTotal);

        if (diff < 1) {
            console.log(`  ${v.name.padEnd(14)} ✅ ₹${utsfTotal} = Excel ₹${excelTotal}`);
            totalPassed++;
        } else {
            console.log(`  ${v.name.padEnd(14)} ❌ ₹${utsfTotal} ≠ Excel ₹${excelTotal} (diff: ${diff.toFixed(2)})`);
            console.log(`    UTSF: base=₹${result.baseFreight}, fuel=₹${result.breakdown?.fuelCharges}, docket=₹${result.breakdown?.docketCharge}, ODA=₹${utsfOda}, ROV=₹${result.breakdown?.rovCharges}`);
            console.log(`    Excel: base=₹${expected.base}, fuel=₹${expected.fuel}, docket=₹${expected.docket}`);
            console.log(`    Zones: ${result.originZone} → ${result.destZone}, isOda=${result.isOda}`);
            totalFailed++;
        }
    }
}

console.log('\n');
console.log('='.repeat(70));
console.log(`  RESULTS: ${totalPassed} PASSED, ${totalFailed} FAILED`);
console.log('='.repeat(70));

process.exit(totalFailed > 0 ? 1 : 0);
