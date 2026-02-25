/**
 * verify_utsf_vs_excel.mjs
 * 
 * Loads the UTSF service and runs calculations to verify they match Excel.
 * No server needed — runs standalone.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');

// Dynamically import the UTSF service using file:// URL for Windows compatibility
import { pathToFileURL } from 'url';
const utsfModulePath = pathToFileURL(path.resolve(__dirname, '../services/utsfService.js')).href;
const { UTSFTransporter } = await import(utsfModulePath);

// Load master pincodes and convert to { pincode: zone } map
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
console.log(`Sample: 110020 → ${masterPincodes[110020]}, 689703 → ${masterPincodes[689703]}, 226010 → ${masterPincodes[226010]}`);

// Load specific UTSF files
function loadTransporter(id) {
    const filePath = path.join(UTSF_DIR, `${id}.utsf.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new UTSFTransporter(data, masterPincodes);
}

const shipshopy = loadTransporter('6968ddedc2cf85d3f4380d52');
const safexpress = loadTransporter('6870d8765f9c12f692f3b7b3');
const delhiveryLite = loadTransporter('68663285ae45acbf7506f352');

console.log('═══════════════════════════════════════════');
console.log('  UTSF vs Excel Verification Report');
console.log('═══════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

function test(name, vendorName, transporter, from, to, weight, invoice, expected) {
    console.log(`--- ${name} ---`);
    console.log(`  Route: ${from} → ${to}, Weight: ${weight} kg, Invoice: ₹${invoice}`);

    try {
        const result = transporter.calculatePrice(from, to, weight, invoice);

        if (!result) {
            console.log(`  ❌ FAILED: No result returned (not serviceable?)`);
            const check = transporter.checkServiceability(to);
            console.log(`    Serviceability check: ${JSON.stringify(check)}`);
            failed++;
            return;
        }

        const total = result.totalCharges ?? result.total ?? 0;
        console.log(`  Result: ₹${total}`);
        console.log(`    Breakdown: Base=₹${result.baseFreight}, Fuel=₹${result.fuelCharges}, Docket=₹${result.docketCharges}, ODA=₹${result.odaCharges}, ROV=₹${result.rovCharges}`);

        if (expected.total !== undefined) {
            if (Math.abs(total - expected.total) < 1) {
                console.log(`  ✅ PASS: Total ₹${total} matches Excel ₹${expected.total}`);
                passed++;
            } else {
                console.log(`  ❌ FAIL: Total ₹${total} ≠ Excel ₹${expected.total} (diff: ${total - expected.total})`);
                failed++;
            }
        }

        if (expected.oda !== undefined) {
            if (Math.abs((result.odaCharges || 0) - expected.oda) < 1) {
                console.log(`  ✅ ODA: ₹${result.odaCharges} matches expected ₹${expected.oda}`);
            } else {
                console.log(`  ❌ ODA: ₹${result.odaCharges} ≠ expected ₹${expected.oda}`);
            }
        }
    } catch (err) {
        console.log(`  ❌ ERROR: ${err.message}`);
        failed++;
    }
    console.log('');
}

// Test Case 1: Pincode 689703 (S4, ODA=Yes), 800 kg — from Excel screenshot
test('Shipshopy → 689703 (S4, ODA)', 'Shipshopy', shipshopy, 110020, 689703, 800, 1,
    { total: 14160, oda: 2300 });

test('Safexpress → 689703 (S4, ODA)', 'Safexpress', safexpress, 110020, 689703, 800, 1,
    { total: 13350, oda: 500 });

// Test Case 2: Pincode 226010 (N3, ODA=No), 2500 kg — from Excel price sheets
test('Shipshopy → 226010 (N3, no ODA)', 'Shipshopy', shipshopy, 110020, 226010, 2500, 1,
    { total: 23100, oda: 0 });

test('Safexpress → 226010 (N3, no ODA)', 'Safexpress', safexpress, 110020, 226010, 2500, 1,
    { total: 30850, oda: 0 });

// Test Case 3: Delhivery Lite should match Shipshopy rates
test('Delhivery Lite → 226010 (N3, no ODA)', 'Delhivery Lite', delhiveryLite, 110020, 226010, 2500, 1,
    { total: undefined }); // Just check it runs

// Test Case 4: Check ODA detection
console.log('--- ODA Detection Checks ---');
const shipOda = shipshopy.checkServiceability(689703);
console.log(`  Shipshopy 689703: isOda=${shipOda.isOda}, zone=${shipOda.zone}`);
const safeOda = safexpress.checkServiceability(689703);
console.log(`  Safexpress 689703: isOda=${safeOda.isOda}, zone=${safeOda.zone}`);

const shipNoOda = shipshopy.checkServiceability(226010);
console.log(`  Shipshopy 226010: isOda=${shipNoOda.isOda}, zone=${shipNoOda.zone}`);

// Test Case 5: Verify zone override works for Safexpress split-rate zone
console.log('\n--- Safexpress Zone Override Checks ---');
// Pick a pincode from W2 with rate 13 (minority)
const safeW2Check = safexpress.checkServiceability(400001); // Mumbai - should be W1 or W2
console.log(`  400001: zone=${safeW2Check.zone}, transporterZone=${safeW2Check.transporterZone}`);

console.log('\n═══════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════');

process.exit(failed > 0 ? 1 : 0);
