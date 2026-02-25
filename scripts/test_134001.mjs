/**
 * Quick verification for pincode 134001, 900 kg
 */
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

function loadTransporter(id) {
    const filePath = path.join(UTSF_DIR, `${id}.utsf.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new UTSFTransporter(data, masterPincodes);
}

const shipshopy = loadTransporter('6968ddedc2cf85d3f4380d52');
const safexpress = loadTransporter('6870d8765f9c12f692f3b7b3');

const FROM = 110020;
const TO = 134001;
const WEIGHT = 900;

console.log(`\n=== Test: ${FROM} → ${TO}, ${WEIGHT} kg ===`);
console.log(`Zone of ${TO}: ${masterPincodes[TO]}`);

// Shipshopy
const shipSvc = shipshopy.checkServiceability(TO);
console.log(`\nShipshopy serviceability: ${JSON.stringify(shipSvc)}`);
const shipResult = shipshopy.calculatePrice(FROM, TO, WEIGHT, 1);
console.log(`Shipshopy result: ${JSON.stringify(shipResult, null, 2)}`);
console.log(`Excel expects: ₹8,380`);

// Expected calculation:
const shipZone = shipSvc.zone;
const shipRate = shipshopy.getZoneRate('N1', shipZone);
console.log(`  Rate N1→${shipZone}: ${shipRate}`);
console.log(`  Base: ${shipRate} × ${WEIGHT} = ${shipRate * WEIGHT}`);
console.log(`  Docket: 100`);
console.log(`  Expected total: ${shipRate * WEIGHT + 100}`);

// Safexpress
const safeSvc = safexpress.checkServiceability(TO);
console.log(`\nSafexpress serviceability: ${JSON.stringify(safeSvc)}`);
const safeResult = safexpress.calculatePrice(FROM, TO, WEIGHT, 1);
console.log(`Safexpress result: ${JSON.stringify(safeResult, null, 2)}`);
console.log(`Excel expects: ₹11,650`);

// Expected calculation:
const safeZone = safeSvc.transporterZone || safeSvc.zone;
const safeRate = safexpress.getZoneRate('N1', safeZone);
console.log(`  Rate N1→${safeZone}: ${safeRate}`);
console.log(`  Base: ${safeRate} × ${WEIGHT} = ${safeRate * WEIGHT}`);
const safeFuel = Math.min((5 / 100) * safeRate * WEIGHT, 400);
console.log(`  Fuel: min(5% × ${safeRate * WEIGHT}, 400) = ${safeFuel}`);
console.log(`  Docket + ROV: 450`);
console.log(`  Expected total: ${safeRate * WEIGHT + safeFuel + 450}`);

// Reverse-engineer Excel values
console.log('\n=== Reverse-engineer Excel ===');
// Shipshopy: 8380 = rate * 900 + 100 → rate = (8380 - 100) / 900 = 9.2
console.log(`Shipshopy: (8380 - 100) / 900 = ${(8380 - 100) / 900}`);
// Safexpress: 11650 = rate * 900 + fuel + 450 
// If fuel = min(5% * base, 400):
// 11650 = base + min(0.05 * base, 400) + 450
// 11650 - 450 = base + fuel = 11200
// If base = rate * 900, fuel = min(0.05 * base, 400)
// Try with fuel = 400: base = 11200 - 400 = 10800, rate = 10800/900 = 12  → fuel = 0.05*10800 = 540 > 400 → capped at 400. Total = 10800+400+450 = 11650 ✅
console.log(`Safexpress: base=(11650-450-400)=10800, rate=10800/900=${10800 / 900}, fuel=min(540,400)=400 → total=${10800 + 400 + 450}`);
