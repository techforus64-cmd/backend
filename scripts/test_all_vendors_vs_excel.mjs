/**
 * test_all_vendors_vs_excel.mjs
 *
 * Tests all 4 vendors (Shipshopy, Safexpress, DB Schenker, VL Cargo) against
 * expected values derived from the Excel file "Transport Cost Calculator (5).xlsx".
 *
 * Vendor IDs:
 *   Shipshopy  : 6968ddedc2cf85d3f4380d52
 *   Safexpress : 6870d8765f9c12f692f3b7b3
 *   DB Schenker: 67b4b800db5c000000000001
 *   VL Cargo   : 67b4b800cf900000000000c1
 *
 * Run:  node backend/scripts/test_all_vendors_vs_excel.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');

// Dynamically import the UTSF service (Windows file:// URL compatibility)
const utsfModulePath = pathToFileURL(path.resolve(__dirname, '../services/utsfService.js')).href;
const { UTSFTransporter } = await import(utsfModulePath);

// Load master pincodes -> { pincode: zone }
const pincodeArray = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
const masterPincodes = {};
for (const entry of pincodeArray) {
    const pin = entry.pincode || entry.Pincode;
    const zone = entry.zone || entry.Zone;
    if (pin && zone) {
        masterPincodes[parseInt(pin, 10)] = zone;
    }
}
console.log(`Loaded ${Object.keys(masterPincodes).length} master pincodes`);
console.log(`Zone check: 110020=${masterPincodes[110020]}, 226010=${masterPincodes[226010]}, 689703=${masterPincodes[689703]}, 400001=${masterPincodes[400001]}`);

// Load a UTSF transporter by file ID
function loadTransporter(id) {
    const filePath = path.join(UTSF_DIR, `${id}.utsf.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new UTSFTransporter(data, masterPincodes);
}

const SHIPSHOPY_ID = '6968ddedc2cf85d3f4380d52';
const SAFEXPRESS_ID = '6870d8765f9c12f692f3b7b3';
const DBS_ID = '67b4b800db5c000000000001';
const VLC_ID = '67b4b800cf900000000000c1';

const shipshopy = loadTransporter(SHIPSHOPY_ID);
const safexpress = loadTransporter(SAFEXPRESS_ID);
const dbs = loadTransporter(DBS_ID);
const vlc = loadTransporter(VLC_ID);

console.log('\n');
console.log('='.repeat(60));
console.log('  All-Vendor vs Excel Verification Report');
console.log('  4 vendors x 10 test cases');
console.log('='.repeat(60));
console.log('');

let passed = 0;
let failed = 0;

/**
 * Run one test case.
 * @param {string} name          - Descriptive name
 * @param {object} transporter   - UTSFTransporter instance
 * @param {number} from          - Origin pincode
 * @param {number} to            - Destination pincode
 * @param {number} weight        - Chargeable weight (kg)
 * @param {number} invoice       - Invoice value
 * @param {{ total?: number, oda?: number }} expected
 */
function test(name, transporter, from, to, weight, invoice, expected) {
    console.log(`--- ${name} ---`);
    console.log(`  Route: ${from} -> ${to}, Weight: ${weight} kg`);

    try {
        const result = transporter.calculatePrice(from, to, weight, invoice);

        if (!result || result.error) {
            const errMsg = result?.error || 'No result returned';
            console.log(`  FAIL: ${errMsg}`);
            const svc = transporter.checkServiceability(to);
            console.log(`  Serviceability(to): isServiceable=${svc.isServiceable}, zone=${svc.zone}, isOda=${svc.isOda}, reason=${svc.reason}`);
            const svcFrom = transporter.checkServiceability(from);
            console.log(`  Serviceability(from): isServiceable=${svcFrom.isServiceable}, zone=${svcFrom.zone}`);
            failed++;
            console.log('');
            return;
        }

        const total = result.totalCharges ?? result.total ?? 0;
        const oda = result.breakdown?.odaCharges ?? result.odaCharges ?? 0;

        console.log(`  Result: Rs ${total}`);
        console.log(`    Base=Rs ${result.baseFreight}, Fuel=Rs ${result.breakdown?.fuelCharges ?? 0}, ` +
            `Docket=Rs ${result.breakdown?.docketCharge ?? 0}, ` +
            `ODA=Rs ${oda}`);
        console.log(`  Origin zone: ${result.originZone}, Dest zone: ${result.destZone}, isOda: ${result.isOda}`);

        let testPassed = true;

        if (expected.total !== undefined) {
            if (Math.abs(total - expected.total) < 0.5) {
                console.log(`  PASS: Total Rs ${total} matches Excel Rs ${expected.total}`);
            } else {
                console.log(`  FAIL: Total Rs ${total} != Excel Rs ${expected.total} (diff: ${(total - expected.total).toFixed(2)})`);
                testPassed = false;
            }
        }

        if (expected.oda !== undefined) {
            if (Math.abs(oda - expected.oda) < 0.5) {
                console.log(`  PASS ODA: Rs ${oda} matches expected Rs ${expected.oda}`);
            } else {
                console.log(`  FAIL ODA: Rs ${oda} != expected Rs ${expected.oda}`);
                testPassed = false;
            }
        }

        if (testPassed) { passed++; } else { failed++; }

    } catch (err) {
        console.log(`  ERROR: ${err.message}`);
        failed++;
    }
    console.log('');
}

// ==============================================================
//  TEST GROUP 1: Non-ODA route — 110020 -> 226010 (masterN3)
//  Weight: 2500 kg, Invoice: 1
//  Excel "Input and Output" sheet + "Price_*" sheets
// ==============================================================
console.log('[GROUP 1] Non-ODA: 110020 -> 226010 (masterN3, no ODA), 2500 kg');
console.log('');

// Test 1: Shipshopy — from Excel "Input and Output" = Rs 23,100
test(
    'Test 1: Shipshopy -> 226010 (N3, no ODA), 2500 kg',
    shipshopy, 110020, 226010, 2500, 1,
    { total: 23100, oda: 0 }
);

// Test 2: Safexpress — from Excel "Input and Output" = Rs 30,850
test(
    'Test 2: Safexpress -> 226010 (N3, no ODA), 2500 kg',
    safexpress, 110020, 226010, 2500, 1,
    { total: 30850, oda: 0 }
);

// Test 3: DB Schenker — from Excel "Price_DB Schenker" = Rs 17,162.5
//  masterN3 rate=6.5 (96% overlap with DBS N2 zone)
//  base=16250, fuel=812.5, docket=100, total=17162.5
test(
    'Test 3: DB Schenker -> 226010 (masterN3->6.5/kg, no ODA), 2500 kg',
    dbs, 110020, 226010, 2500, 1,
    { total: 17162.5, oda: 0 }
);

// Test 4: VL Cargo — from Excel "Price_VL Cargo" = Rs 45,000 (flat 18/kg)
test(
    'Test 4: VL Cargo -> 226010 (masterN3, flat 18/kg, no ODA), 2500 kg',
    vlc, 110020, 226010, 2500, 1,
    { total: 45000, oda: 0 }
);

// ==============================================================
//  TEST GROUP 2: ODA route — 110020 -> 689703 (masterS4, ODA)
//  Weight: 800 kg, Invoice: 1
//  Excel "Input and Output" sheet + ODA surcharge verification
// ==============================================================
console.log('[GROUP 2] ODA: 110020 -> 689703 (masterS4, ODA=yes), 800 kg');
console.log('');

// Test 5: Shipshopy ODA — from Excel "Input and Output" = Rs 14,160, ODA=2300
//  excess mode: 500 + max(0, 800-200)*3 = 500 + 1800 = 2300
test(
    'Test 5: Shipshopy -> 689703 (S4, ODA), 800 kg',
    shipshopy, 110020, 689703, 800, 1,
    { total: 14160, oda: 2300 }
);

// Test 6: Safexpress ODA — from Excel "Input and Output" = Rs 13,350, ODA=500
//  legacy: f=500, v=0 => ODA=500
test(
    'Test 6: Safexpress -> 689703 (S4, ODA), 800 kg',
    safexpress, 110020, 689703, 800, 1,
    { total: 13350, oda: 500 }
);

// Test 7: DB Schenker ODA — switch mode: weight(800) > threshold(212) => ODA = 4/kg * weight
//  masterS4 rate = 14.0/kg (99% overlap with DBS S3 zone)
//  base=11200, fuel=560, docket=100, ODA=4*800=3200
//  total=11200+560+100+3200=15060
test(
    'Test 7: DB Schenker -> 689703 (masterS4=14.0/kg, ODA switch 4/kg*800=3200), 800 kg',
    dbs, 110020, 689703, 800, 1,
    { total: 15060, oda: 3200 }
);

// Test 8: VL Cargo ODA — flat 18/kg, excess ODA: 500+3*(800-200)=2300
//  base=14400, ODA=2300, total=16700
test(
    'Test 8: VL Cargo -> 689703 (S4, ODA pincode, excess ODA), 800 kg',
    vlc, 110020, 689703, 800, 1,
    { total: 16700, oda: 2300 }
);

// ==============================================================
//  TEST GROUP 3: Edge Cases
// ==============================================================
console.log('[GROUP 3] Edge Cases');
console.log('');

// Test 9: DB Schenker — weight below minCharges threshold
//  110020 -> 110001 (N1->N1, rate=6.0), weight=30kg
//  base=30*6=180, effectiveBase=max(180,400)=400
//  fuel=5%*180=9 (fuel applies to baseFreight, not effectiveBase)
//  docket=100
//  total=400+9+100=509
test(
    'Test 9: DB Schenker edge — 110020 -> 110001 (N1->N1), 30 kg (below minCharges Rs 400)',
    dbs, 110020, 110001, 30, 1,
    { total: 509, oda: 0 }
);

// Test 10: VL Cargo — high weight (10,000 kg), flat rate
//  base=10000*18=180000, no fuel/docket, total=180000
test(
    'Test 10: VL Cargo edge — 110020 -> 226010, 10000 kg (high weight flat rate)',
    vlc, 110020, 226010, 10000, 1,
    { total: 180000, oda: 0 }
);

// ==============================================================
//  SUMMARY
// ==============================================================
console.log('='.repeat(60));
console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED (out of ${passed + failed} tests)`);
console.log('='.repeat(60));

// ODA detection check
console.log('\n--- ODA Detection Spot Checks ---');
const checks = [
    [shipshopy, 689703, 'Shipshopy', true],
    [safexpress, 689703, 'Safexpress', true],
    [dbs, 689703, 'DB Schenker', true],
    [vlc, 689703, 'VL Cargo', true],
    [shipshopy, 226010, 'Shipshopy', false],
    [dbs, 226010, 'DB Schenker', false],
];
for (const [t, pin, name, expectOda] of checks) {
    const s = t.checkServiceability(pin);
    const odaMatch = s.isOda === expectOda ? 'OK' : 'MISMATCH';
    console.log(`  ${name} ${pin}: isServiceable=${s.isServiceable}, zone=${s.zone}, isOda=${s.isOda} [${odaMatch}]`);
}

process.exit(failed > 0 ? 1 : 0);
