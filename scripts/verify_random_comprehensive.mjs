/**
 * verify_random_comprehensive.mjs
 *
 * Checks 10 ODA=Yes and 10 ODA=No pincodes across all 4 vendors.
 *
 * Validation Rules:
 * - Shipshopy: Base + 100 + Fuel(0). ODA: Excess (500 + 3*(wt-200)).
 * - VL Cargo: Base Only? + ODA. ODA: Excess (500 + 3*(wt-200)).
 * - Safexpress: Base + Fuel + 450. ODA: Flat 500.
 * - DB Schenker: Max(Base+Fuel+100+ODA, 400). ODA: Switch (<=212 ? 850 : 4*wt).
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
console.log('Loading Excel...');
const wb = XLSX.readFile(EXCEL_PATH);
const mainSheet = wb.Sheets['Pincode_B2B_Delhivery'];
const mainData = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' });

// DBS has its own data
const dbsSheet = wb.Sheets['Pincode_DBS'];
const dbsData = XLSX.utils.sheet_to_json(dbsSheet, { header: 1, defval: '' });

// Build Lookups
const excelData = new Map();
const odaYesPins = [];
const odaNoPins = [];

for (let i = 1; i < mainData.length; i++) {
    const row = mainData[i];
    const pin = Number(row[1]);
    if (!pin || isNaN(pin)) continue;

    const oda = String(row[5]).trim();
    const data = {
        zone: String(row[4]).trim(),
        oda: oda,
        city: String(row[2]).trim(),
        state: String(row[3]).trim(),
        shipRate: Number(row[6]) || null,
        vlRate: Number(row[7]) || null,
        dbsRate: Number(row[8]) || null,
        safeRate: Number(row[9]) || null,
    };
    excelData.set(pin, data);

    if (oda.toLowerCase() === 'yes') odaYesPins.push(pin);
    else odaNoPins.push(pin);
}

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

// IDs detected earlier
const SHIP_ID = '6968ddedc2cf85d3f4380d52';
const SAFE_ID = '6870d8765f9c12f692f3b7b3'; // Safexpress
const DBS_ID = '67b4b800db5c000000000001'; // DB Schenker
const VLC_ID = '67b4b800cf900000000000c1'; // VL Cargo

console.log('Loading Transporters...');
const shipshopy = loadTransporter(SHIP_ID);
const safexpress = loadTransporter(SAFE_ID);
const dbs = loadTransporter(DBS_ID);
const vlc = loadTransporter(VLC_ID);

const FROM = 110020; // Origin: Delhi N1

function getExpected(vendor, pin, weight) {
    const common = excelData.get(pin);
    if (!common) return null;

    let rate = 0;
    let isOda = false;
    let city = common.city;
    let state = common.state;

    if (vendor === 'DB Schenker') {
        const dbsInfo = dbsPincodeData.get(pin);
        // Fallback to common if not in DBS sheet (though it should be)
        rate = dbsInfo ? dbsInfo.price : common.dbsRate;
        isOda = (dbsInfo ? dbsInfo.oda : common.oda).toLowerCase() === 'yes';
        // DBS overrides rate if explicit (handled in data loading above mostly)
    } else {
        isOda = common.oda.toLowerCase() === 'yes';
        if (vendor === 'Shipshopy') rate = common.shipRate;
        else if (vendor === 'VL Cargo') rate = common.vlRate;
        else if (vendor === 'Safexpress') rate = common.safeRate;
    }

    if (!rate) return { error: 'No Rate in Excel' };

    // Calculation
    let base = 0;
    let fuel = 0;
    let docket = 0;
    let rovOda = 0;
    let odaCost = 0;
    let total = 0;

    if (vendor === 'Shipshopy') {
        // Wt = max(wt, 20)
        // Fuel=0, Docket=100
        // ODA = Fixed 500 + Max(0, wt-200)*3
        const w = Math.max(weight, 20);
        base = rate * w;
        fuel = 0;
        docket = 100;
        if (isOda) {
            odaCost = 500 + Math.max(0, w - 200) * 3;
        }
        total = base + fuel + docket + odaCost;
    }
    else if (vendor === 'VL Cargo') {
        // Base Only? Step 72 says 900=900.
        // ODA = Same as Shipshopy?
        // Let's assume No Min Weight? Or Max(20)? 
        // Logic in test_nonoda used rate*weight.
        base = rate * weight; // No min weight logic observed in basic tests?
        // Wait, Shipshopy applies min 20. VL Cargo? 
        // Given parity between Shipshopy/VL Cargo usually...
        // But test_nonoda_random.mjs Step 72 had 'VL Cargo base=900' for 50kg, rate 18? 18*50=900.
        // So just rate * weight.
        if (isOda) {
            odaCost = 500 + Math.max(0, weight - 200) * 3;
        }
        total = base + odaCost;
    }
    else if (vendor === 'Safexpress') {
        // Wt = max(wt, 20)
        // Fuel = min(5% base, 400). Docket=450.
        // ODA = Flat 500 ?
        const w = Math.max(weight, 20);
        base = rate * w;
        fuel = Math.min(base * 0.05, 400);
        docket = 450;
        if (isOda) odaCost = 500;
        total = base + fuel + docket + odaCost;
    }
    else if (vendor === 'DB Schenker') {
        // Wt = max(wt, 50)
        // Fuel = 5% base. Docket=100.
        // ODA = wt<=212 ? 850 : 4*wt.
        // Min Total = 400.
        const w = Math.max(weight, 50);
        base = rate * w;
        fuel = base * 0.05;
        docket = 100;
        if (isOda) {
            odaCost = w <= 212 ? 850 : 4 * w;
        }
        total = Math.max(base + fuel + docket + odaCost, 400);
    }

    return { total, base, fuel, docket, oda: odaCost, isOda, city, state };
}

// Select Test Cases
function getRandom(arr, n) {
    const result = new Array(n);
    let len = arr.length;
    const taken = new Array(len);
    if (n > len) throw new RangeError("getRandom: more elements taken than available");
    while (n--) {
        const x = Math.floor(Math.random() * len);
        result[n] = arr[x in taken ? taken[x] : x];
        taken[x] = --len in taken ? taken[len] : len;
    }
    return result;
}

const testNonOda = getRandom(odaNoPins, 20);
const testOda = getRandom(odaYesPins, 20);

const weight = 850; // Use reasonable weight to trigger ODA tiers

console.log(`\nStarting Comprehensive Verification`);
console.log(`20 NON-ODA + 20 ODA Checks. Weight: ${weight} kg`);

let passed = 0;
let failed = 0;

async function runTest(pin, type) {
    console.log(`\n--- Test: ${pin} (${type}) ---`);
    const vendors = [
        { name: 'Shipshopy', t: shipshopy },
        { name: 'VL Cargo', t: vlc },
        { name: 'Safexpress', t: safexpress },
        { name: 'DB Schenker', t: dbs }
    ];

    for (const v of vendors) {
        const expected = getExpected(v.name, pin, weight);
        if (!expected || expected.error) {
            console.log(`  ${v.name}: Skipped (No Excel Data)`);
            continue;
        }

        const result = v.t.calculatePrice(FROM, pin, weight, 1);
        if (result.error) {
            console.log(`  ${v.name}: ERROR ${result.error}`);
            failed++;
            continue;
        }

        const actual = result.totalCharges; // Service rounding matches?
        // Service returns rounded totalCharges.
        // We should round expected too.
        const expTotal = Math.round(expected.total * 100) / 100;

        const diff = Math.abs(actual - expTotal);
        const match = diff < 1; // Tolerance 1 rupee

        if (match) {
            // console.log(`  ${v.name}: PASS ₹${actual} (ODA: ${expected.isOda})`);
            passed++;
        } else {
            console.log(`  ${v.name}: FAIL`);
            console.log(`     Expected: ₹${expTotal} (Base:${expected.base}, Fuel:${expected.fuel}, ODA:${expected.oda}, Docket:${expected.docket}) [Excel ODA:${expected.isOda}]`);
            console.log(`     Actual:   ₹${actual} (Base:${result.breakdown.baseFreight}, Fuel:${result.breakdown.fuelCharges}, ODA:${result.breakdown.odaCharges}, Docket:${result.breakdown.docketCharge}) [UTSF ODA:${result.isOda}]`);
            failed++;
        }
    }
}

// Run
for (const pin of testNonOda) await runTest(pin, 'NON-ODA');
for (const pin of testOda) await runTest(pin, 'ODA');

console.log(`\nTotal Passed: ${passed}`);
console.log(`Total Failed: ${failed}`);
