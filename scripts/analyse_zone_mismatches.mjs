/**
 * analyse_zone_mismatches.mjs
 *
 * Compare pincodes.json zones vs Excel zones for Shipshopy and DB Schenker.
 * Identify rate mismatches caused by zone assignment differences.
 *
 * For each vendor:
 *   - Which pincodes have a different zone in pincodes.json vs Excel?
 *   - What rate does UTSF give (using master zone) vs what Excel expects?
 *   - Group by mismatch pattern (e.g., "master=N3, excel=C2")
 */
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCEL_PATH = path.resolve(__dirname, '../../Transport Cost Calculator (5).xlsx');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');

// 1. Load master pincodes
const pincodeArray = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
const masterZones = {};
for (const entry of pincodeArray) {
    const pin = parseInt(entry.pincode || entry.Pincode, 10);
    const zone = (entry.zone || entry.Zone || '').toUpperCase().trim();
    if (!isNaN(pin) && zone) masterZones[pin] = zone;
}
console.log(`Master pincodes loaded: ${Object.keys(masterZones).length}`);

// 2. Load Excel
const wb = XLSX.readFile(EXCEL_PATH);

// ────────────────────────────────────────────
//  SHIPSHOPY: Pincode_B2B_Delhivery sheet
// ────────────────────────────────────────────
const mainSheet = wb.Sheets['Pincode_B2B_Delhivery'];
const mainData = XLSX.utils.sheet_to_json(mainSheet, { header: 1, defval: '' });
// Headers: S No(0), PINCODE(1), City(2), State(3), Zone(4), ODA(5),
//          Unit Price_Shipshopsy(6), Unit Price_VL Cargo(7),
//          Unit Price_D B Schenker(8), Unit Price_Safeexpress(9)

const shipMismatches = [];
const shipRateMap = {}; // excelZone -> Set of rates

for (let i = 1; i < mainData.length; i++) {
    const row = mainData[i];
    const pin = Number(row[1]);
    if (!pin || isNaN(pin)) continue;

    const excelZone = String(row[4]).trim().toUpperCase();
    const shipRate = Number(row[6]) || null;
    const masterZone = masterZones[pin];

    if (!masterZone || !excelZone || !shipRate) continue;

    // Track rate distribution per zone
    if (!shipRateMap[excelZone]) shipRateMap[excelZone] = new Set();
    shipRateMap[excelZone].add(shipRate);

    if (masterZone !== excelZone) {
        shipMismatches.push({
            pin, excelZone, masterZone,
            rate: shipRate,
            city: String(row[2]).trim(),
            state: String(row[3]).trim(),
            oda: String(row[5]).trim(),
        });
    }
}

// ────────────────────────────────────────────
//  DB SCHENKER: Pincode_DBS sheet
// ────────────────────────────────────────────
const dbsSheet = wb.Sheets['Pincode_DBS'];
const dbsData = XLSX.utils.sheet_to_json(dbsSheet, { header: 1, defval: '' });
// Headers: S No(0), Pincode(1), City(2), State(3), ODA(4), Zone(5)
// Zone rates are in a separate section: I2:J15 → zone -> rate

// Read DBS zone rates from the sheet
const dbsZoneRates = {};
for (let i = 1; i < dbsData.length; i++) {
    const row = dbsData[i];
    const zoneKey = String(row[8]).trim().toUpperCase();
    const rate = Number(row[9]);
    if (zoneKey && !isNaN(rate) && rate > 0) {
        dbsZoneRates[zoneKey] = rate;
    }
}
console.log('DBS zone rates:', JSON.stringify(dbsZoneRates));

const dbsMismatches = [];
const dbsRateByZone = {}; // zone -> rate (from excel lookup table)

for (let i = 1; i < dbsData.length; i++) {
    const row = dbsData[i];
    const pin = Number(row[1]);
    if (!pin || isNaN(pin)) continue;

    const excelZone = String(row[5]).trim().toUpperCase();
    const masterZone = masterZones[pin];
    const oda = String(row[4]).trim();

    if (!masterZone || !excelZone) continue;

    if (masterZone !== excelZone) {
        dbsMismatches.push({
            pin, excelZone, masterZone,
            excelRate: dbsZoneRates[excelZone] || null,
            masterRate: dbsZoneRates[masterZone] || null,
            city: String(row[2]).trim(),
            state: String(row[3]).trim(),
            oda,
        });
    }
}

// ────────────────────────────────────────────
//  SHIPSHOPY: Also check rate mismatches
//  even when zone matches (per-pincode override)
// ────────────────────────────────────────────

// Load Shipshopy UTSF to get zone rates
const SHIP_UTSF_PATH = path.resolve(__dirname, '../data/utsf/6968ddedc2cf85d3f4380d52.utsf.json');
const shipUtsf = JSON.parse(fs.readFileSync(SHIP_UTSF_PATH, 'utf8'));
const shipZoneRates = shipUtsf.pricing?.zoneRates || {};

// For each Shipshopy pincode, compare UTSF zone rate vs Excel per-pincode rate
const shipRateMismatches = [];
for (let i = 1; i < mainData.length; i++) {
    const row = mainData[i];
    const pin = Number(row[1]);
    if (!pin || isNaN(pin)) continue;

    const excelRate = Number(row[6]) || null;
    const masterZone = masterZones[pin];
    if (!masterZone || !excelRate) continue;

    // UTSF rate: origin N1 -> dest masterZone
    const utsfRate = shipZoneRates['N1']?.[masterZone];
    if (utsfRate !== undefined && Math.abs(utsfRate - excelRate) > 0.01) {
        shipRateMismatches.push({
            pin, masterZone,
            excelZone: String(row[4]).trim().toUpperCase(),
            utsfRate,
            excelRate,
            diff: excelRate - utsfRate,
            city: String(row[2]).trim(),
        });
    }
}

// ────────────────────────────────────────────
//  OUTPUT REPORTS
// ────────────────────────────────────────────

console.log('\n');
console.log('╔' + '═'.repeat(68) + '╗');
console.log('║  SHIPSHOPY Zone Mismatches (pincodes.json ≠ Excel)' + ' '.repeat(17) + '║');
console.log('╚' + '═'.repeat(68) + '╝');
console.log(`Total mismatched pincodes: ${shipMismatches.length}`);

// Group by mismatch pattern
const shipGroups = {};
for (const m of shipMismatches) {
    const key = `master=${m.masterZone} → excel=${m.excelZone}`;
    if (!shipGroups[key]) shipGroups[key] = { items: [], rates: new Set() };
    shipGroups[key].items.push(m);
    shipGroups[key].rates.add(m.rate);
}

// Sort by count descending
const shipGroupsSorted = Object.entries(shipGroups).sort((a, b) => b[1].items.length - a[1].items.length);

for (const [pattern, group] of shipGroupsSorted) {
    console.log(`\n  ${pattern} — ${group.items.length} pincodes`);
    console.log(`    Excel rates: ${[...group.rates].join(', ')}`);
    // Show UTSF rate for master zone
    const masterZone = group.items[0].masterZone;
    const utsfRate = shipZoneRates['N1']?.[masterZone];
    console.log(`    UTSF N1→${masterZone} rate: ${utsfRate}`);
    // Show first 5 examples
    const examples = group.items.slice(0, 5);
    for (const ex of examples) {
        console.log(`      ${ex.pin} (${ex.city}, ${ex.state}) rate=${ex.rate} ODA=${ex.oda}`);
    }
    if (group.items.length > 5) console.log(`      ... and ${group.items.length - 5} more`);
}

// Rate mismatches (same zone but different rate)
console.log('\n');
console.log('╔' + '═'.repeat(68) + '╗');
console.log('║  SHIPSHOPY Rate Mismatches (same zone, different rate from N1)' + ' '.repeat(5) + '║');
console.log('╚' + '═'.repeat(68) + '╝');

const shipRateGroups = {};
for (const m of shipRateMismatches) {
    const key = `zone=${m.masterZone} utsf=${m.utsfRate} excel=${m.excelRate}`;
    if (!shipRateGroups[key]) shipRateGroups[key] = [];
    shipRateGroups[key].push(m);
}

console.log(`Total pincodes with rate mismatch: ${shipRateMismatches.length}`);
const shipRateGroupsSorted = Object.entries(shipRateGroups).sort((a, b) => b[1].length - a[1].length);
for (const [pattern, items] of shipRateGroupsSorted) {
    console.log(`\n  ${pattern} — ${items.length} pincodes`);
    const examples = items.slice(0, 3);
    for (const ex of examples) {
        console.log(`      ${ex.pin} (${ex.city}) excelZone=${ex.excelZone}`);
    }
    if (items.length > 3) console.log(`      ... and ${items.length - 3} more`);
}

console.log('\n');
console.log('╔' + '═'.repeat(68) + '╗');
console.log('║  DB SCHENKER Zone Mismatches (pincodes.json ≠ Excel)' + ' '.repeat(15) + '║');
console.log('╚' + '═'.repeat(68) + '╝');
console.log(`Total mismatched pincodes: ${dbsMismatches.length}`);

const dbsGroups = {};
for (const m of dbsMismatches) {
    const key = `master=${m.masterZone} → excel=${m.excelZone}`;
    if (!dbsGroups[key]) dbsGroups[key] = { items: [], excelRates: new Set(), masterRates: new Set() };
    dbsGroups[key].items.push(m);
    if (m.excelRate) dbsGroups[key].excelRates.add(m.excelRate);
    if (m.masterRate) dbsGroups[key].masterRates.add(m.masterRate);
}

const dbsGroupsSorted = Object.entries(dbsGroups).sort((a, b) => b[1].items.length - a[1].items.length);
for (const [pattern, group] of dbsGroupsSorted) {
    const masterZone = group.items[0].masterZone;
    const excelZone = group.items[0].excelZone;
    console.log(`\n  ${pattern} — ${group.items.length} pincodes`);
    console.log(`    DBS rate for excel zone ${excelZone}: ${[...group.excelRates].join(', ') || 'N/A'}`);
    console.log(`    DBS rate for master zone ${masterZone}: ${[...group.masterRates].join(', ') || 'N/A'}`);
    const examples = group.items.slice(0, 5);
    for (const ex of examples) {
        console.log(`      ${ex.pin} (${ex.city}, ${ex.state}) ODA=${ex.oda}`);
    }
    if (group.items.length > 5) console.log(`      ... and ${group.items.length - 5} more`);
}

// Summary
console.log('\n');
console.log('╔' + '═'.repeat(68) + '╗');
console.log('║  SUMMARY' + ' '.repeat(59) + '║');
console.log('╚' + '═'.repeat(68) + '╝');
console.log(`  Shipshopy: ${shipMismatches.length} zone mismatches across ${shipGroupsSorted.length} patterns`);
console.log(`  Shipshopy: ${shipRateMismatches.length} rate mismatches (including zone mismatch effect)`);
console.log(`  DB Schenker: ${dbsMismatches.length} zone mismatches across ${dbsGroupsSorted.length} patterns`);
