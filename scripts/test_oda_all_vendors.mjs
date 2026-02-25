/**
 * test_oda_all_vendors.mjs
 *
 * Tests 10 ODA pincodes (across different zones) for all 4 vendors.
 * Each pincode is ODA=Yes for Shipshopy, Safexpress, DB Schenker, VL Cargo.
 *
 * Expected values derived from Excel formulas:
 *
 *   Shipshopy  : total = base + 100(docket) + 500 + max(0, wt-200)*3   [excess ODA]
 *   Safexpress : total = base + min(5%*base,400) + 100(ROV) + 350(docket) + 500  [legacy ODA]
 *   DB Schenker: total = max(base,400) + 5%*base + 100(docket) + (wt<=212?850:4*wt) [switch ODA]
 *   VL Cargo   : total = base(18/kg) + 500 + max(0, wt-200)*3          [excess ODA]
 *
 * Run:  node backend/scripts/test_oda_all_vendors.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTSF_DIR      = path.resolve(__dirname, '../data/utsf');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');

const utsfModulePath = pathToFileURL(path.resolve(__dirname, '../services/utsfService.js')).href;
const { UTSFTransporter } = await import(utsfModulePath);

const masterPincodes = {};
JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8')).forEach(e => {
    const pin  = e.pincode || e.Pincode;
    const zone = e.zone    || e.Zone;
    if (pin && zone) masterPincodes[parseInt(pin, 10)] = zone;
});
console.log(`Loaded ${Object.keys(masterPincodes).length} master pincodes\n`);

function loadTransporter(id) {
    const data = JSON.parse(fs.readFileSync(path.join(UTSF_DIR, `${id}.utsf.json`), 'utf8'));
    return new UTSFTransporter(data, masterPincodes);
}

const shipshopy  = loadTransporter('6968ddedc2cf85d3f4380d52');
const safexpress = loadTransporter('6870d8765f9c12f692f3b7b3');
const dbs        = loadTransporter('67b4b800db5c000000000001');
const vlc        = loadTransporter('67b4b800cf900000000000c1');

const FROM = 110020;  // Delhi N1 hub
const WT   = 800;     // 800 kg for all tests

// ===================================================================
// ODA expected-value helpers (reproduce Excel formulas)
// ===================================================================
// ODA charge for each vendor at 800 kg
const ODA_SHIP = 500 + Math.max(0, WT - 200) * 3;  // 2300
const ODA_SAFE = 500;                                 // legacy flat
const ODA_DBS  = WT <= 212 ? 850 : 4 * WT;           // 3200 (switch)
const ODA_VLC  = 500 + Math.max(0, WT - 200) * 3;   // 2300

function expShipshopy(rate) {
    const base = WT * rate;
    const eff  = Math.max(base, 400);
    return { oda: ODA_SHIP, total: eff + 100 + ODA_SHIP };
}
function expSafexpress(rate) {
    const base = WT * rate;
    const fuel = Math.min(0.05 * base, 400);
    const rov  = 100;
    return { oda: ODA_SAFE, total: base + fuel + rov + 350 + ODA_SAFE };
}
function expDBS(rate) {
    const base = WT * rate;
    const eff  = Math.max(base, 400);
    const fuel = parseFloat((0.05 * base).toFixed(2));
    return { oda: ODA_DBS, total: parseFloat((eff + fuel + 100 + ODA_DBS).toFixed(2)) };
}
function expVLC() {
    const base = WT * 18.0;
    return { oda: ODA_VLC, total: base + ODA_VLC };
}

// ===================================================================
// 10 ODA test pincodes (common to all 4 vendors), one per zone
// Rates from Pincode_B2B_Delhivery (Shipshopy col G, Safexpress col J)
// DBS masterzone rates from analyze_dbs_zones.py
// ===================================================================
const ODA_TESTS = [
    // { pin, zone, shipRate, safeRate, dbsRate }
    { pin: 670111, zone: 'S4',  shipRate: 14.7, safeRate: 15.0, dbsRate: 14.0 },
    { pin: 360011, zone: 'W2',  shipRate: 12.5, safeRate: 13.0, dbsRate:  9.5 },
    { pin: 701101, zone: 'E2',  shipRate: 15.5, safeRate: 15.0, dbsRate: 11.5 },
    { pin: 111112, zone: 'N1',  shipRate:  7.5, safeRate: 12.0, dbsRate:  6.0 },
    { pin: 500133, zone: 'S1',  shipRate: 13.0, safeRate: 14.0, dbsRate: 10.5 },
    { pin: 380017, zone: 'W1',  shipRate: 11.3, safeRate: 13.0, dbsRate:  8.1 },
    { pin: 450003, zone: 'C1',  shipRate: 11.1, safeRate: 13.0, dbsRate:  8.6 },
    { pin: 700158, zone: 'E1',  shipRate: 14.7, safeRate: 15.0, dbsRate: 10.5 },
    { pin: 123021, zone: 'N3',  shipRate:  9.2, safeRate: 12.0, dbsRate:  6.5 },
    { pin: 327801, zone: 'C2',  shipRate: 12.0, safeRate: 13.0, dbsRate:  9.0 },
];

console.log('='.repeat(70));
console.log('  ODA Tests — All 4 Vendors x 10 Pincodes');
console.log(`  From: ${FROM} (N1/Delhi)  |  Weight: ${WT} kg  |  All pincodes: ODA=Yes`);
console.log('='.repeat(70));
console.log(`  ODA charges at ${WT}kg:`);
console.log(`    Shipshopy/VLC (excess): Rs ${ODA_SHIP}  (500 + max(0,${WT}-200)*3)`);
console.log(`    Safexpress  (legacy  ): Rs ${ODA_SAFE}  (flat Rs 500)`);
console.log(`    DB Schenker (switch  ): Rs ${ODA_DBS}  (4/kg * ${WT}, since ${WT}>212)`);
console.log('');

let passed = 0;
let failed = 0;

function runOne(label, vendor, transporter, pin, expected) {
    try {
        const result = transporter.calculatePrice(FROM, pin, WT, 1);
        if (!result || result.error) {
            const svc = transporter.checkServiceability(pin);
            console.log(`    [${label}] FAIL: ${result?.error || 'null'} | svc=${JSON.stringify(svc)}`);
            failed++;
            return;
        }
        const total = result.totalCharges ?? 0;
        const oda   = result.breakdown?.odaCharges ?? 0;
        const totalOk = Math.abs(total - expected.total) < 0.5;
        const odaOk   = Math.abs(oda   - expected.oda)   < 0.5;
        const ok = totalOk && odaOk;
        const mark = ok ? 'PASS' : 'FAIL';
        if (ok) passed++; else failed++;
        console.log(`    [${label}] ${mark}: total=Rs ${total} (exp ${expected.total}) | ODA=Rs ${oda} (exp ${expected.oda})`);
        if (!ok) {
            console.log(`          Base=Rs ${result.baseFreight}, Zone=${result.originZone}->${result.destZone}, isOda=${result.isOda}`);
        }
    } catch (err) {
        console.log(`    [${label}] ERROR: ${err.message}`);
        failed++;
    }
}

for (let i = 0; i < ODA_TESTS.length; i++) {
    const t = ODA_TESTS[i];
    const es = expShipshopy(t.shipRate);
    const ef = expSafexpress(t.safeRate);
    const ed = expDBS(t.dbsRate);
    const ev = expVLC();

    console.log(`--- ODA Test ${i + 1}: pin=${t.pin} (${t.zone}, ODA) ${WT}kg ---`);
    console.log(`  Rates: Ship=${t.shipRate} Safe=${t.safeRate} DBS=${t.dbsRate} VLC=18.0`);

    runOne('Shipshopy ',  'Shipshopy',  shipshopy,  t.pin, es);
    runOne('Safexpress',  'Safexpress', safexpress, t.pin, ef);
    runOne('DB Schenker', 'DB Schenker',dbs,        t.pin, ed);
    runOne('VL Cargo  ',  'VL Cargo',   vlc,        t.pin, ev);
    console.log('');
}

console.log('='.repeat(70));
console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED (out of ${passed + failed})`);
console.log('='.repeat(70));

process.exit(failed > 0 ? 1 : 0);
