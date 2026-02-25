/**
 * update_utsf_from_excel.mjs
 * 
 * Reads the Excel source of truth and updates:
 *   - Shipshopy UTSF: zone rates (N1→X) + ODA pincodes
 *   - Safexpress UTSF: zone rates (N1→X) + ODA pincodes + zoneOverrides for split-rate zones
 *   - Delhivery Lite UTSF: synced with Shipshopy zone rates + ODA pincodes
 *
 * Usage: node backend/scripts/update_utsf_from_excel.mjs
 */
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const UTSF_DIR = path.resolve(ROOT, 'backend/data/utsf');
const EXCEL_PATH = path.resolve(ROOT, 'Transport Cost Calculator (5).xlsx');

// UTSF file IDs
const SHIPSHOPY_ID = '6968ddedc2cf85d3f4380d52';
const SAFEXPRESS_ID = '6870d8765f9c12f692f3b7b3';
const DELHIVERY_LITE_ID = '68663285ae45acbf7506f352';

// ======================================================================
// 1. READ EXCEL
// ======================================================================
console.log('📖 Reading Excel file...');
const wb = XLSX.readFile(EXCEL_PATH);

function getSheetData(name) {
    const ws = wb.Sheets[name];
    if (!ws) throw new Error(`Sheet "${name}" not found`);
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

// ======================================================================
// 2. EXTRACT DATA FROM Pincode_B2B_Delhivery SHEET
// ======================================================================
const mainData = getSheetData('Pincode_B2B_Delhivery');
// Headers: S No(0), PINCODE(1), City(2), State(3), Zone(4), ODA(5), 
//          UnitPrice_Shipshopy(6), UnitPrice_VLCargo(7), UnitPrice_DBS(8), UnitPrice_Safexpress(9)

const ZONE_IDX = 4;
const ODA_IDX = 5;
const SHIP_PRICE_IDX = 6;
const SAFE_PRICE_IDX = 9;

// --- Build zone rate maps and collect ODA pincodes ---
const excelShipshopyRates = {};   // zone -> rate
const excelSafexpressRates = {};  // zone -> { rate -> [pincodes] }
const odaPincodesByZone = {};     // zone -> [pincodes]
const allOdaPincodes = new Set();

for (let i = 1; i < mainData.length; i++) {
    const row = mainData[i];
    const pincode = Number(row[1]);
    const zone = String(row[ZONE_IDX]).trim();
    const oda = String(row[ODA_IDX]).trim().toLowerCase();
    const shipPrice = row[SHIP_PRICE_IDX];
    const safePrice = row[SAFE_PRICE_IDX];

    if (!zone || isNaN(pincode)) continue;

    // ODA pincodes
    if (oda === 'yes') {
        allOdaPincodes.add(pincode);
        if (!odaPincodesByZone[zone]) odaPincodesByZone[zone] = [];
        odaPincodesByZone[zone].push(pincode);
    }

    // Shipshopy: single rate per zone (verify uniformity)
    if (shipPrice !== '' && !isNaN(Number(shipPrice))) {
        const rate = Number(shipPrice);
        if (!excelShipshopyRates[zone]) {
            excelShipshopyRates[zone] = rate;
        } else if (excelShipshopyRates[zone] !== rate) {
            console.warn(`⚠️ Shipshopy zone ${zone} has multiple rates: ${excelShipshopyRates[zone]} and ${rate}`);
        }
    }

    // Safexpress: per-pincode rates (may have splits)
    if (safePrice !== '' && !isNaN(Number(safePrice))) {
        const rate = Number(safePrice);
        if (!excelSafexpressRates[zone]) excelSafexpressRates[zone] = {};
        if (!excelSafexpressRates[zone][rate]) excelSafexpressRates[zone][rate] = [];
        excelSafexpressRates[zone][rate].push(pincode);
    }
}

// Sort ODA pincodes
for (const zone of Object.keys(odaPincodesByZone)) {
    odaPincodesByZone[zone].sort((a, b) => a - b);
}

console.log(`✅ Extracted ${Object.keys(excelShipshopyRates).length} zones for Shipshopy`);
console.log(`✅ Extracted ${Object.keys(excelSafexpressRates).length} zones for Safexpress`);
console.log(`✅ Extracted ${allOdaPincodes.size} ODA pincodes across ${Object.keys(odaPincodesByZone).length} zones`);

// ======================================================================
// 3. BUILD SAFEXPRESS ZONE OVERRIDES & VIRTUAL ZONES
// ======================================================================
// For each zone with multiple rates:
//   - The majority rate becomes the "default" zone rate
//   - Minority-rate pincodes get zoneOverrides to virtual zones
//   - Virtual zones are added to the zoneRates matrix

const safexpressN1Rates = {};       // zone -> default rate
const safexpressOverrides = {};     // pincode -> virtual_zone_name
const safexpressVirtualZones = {};  // virtual_zone_name -> rate (for N1 origin)

console.log('\n--- Safexpress Zone Analysis ---');
for (const [zone, rateMap] of Object.entries(excelSafexpressRates)) {
    const entries = Object.entries(rateMap)
        .map(([r, pins]) => ({ rate: Number(r), count: pins.length, pincodes: pins }))
        .sort((a, b) => b.count - a.count);

    // Majority rate is the default
    const majorityRate = entries[0].rate;
    safexpressN1Rates[zone] = majorityRate;

    if (entries.length > 1) {
        console.log(`  ${zone}: majority=${majorityRate} (${entries[0].count}x)`);
        // Create virtual zones for minority rates
        for (let k = 1; k < entries.length; k++) {
            const { rate, count, pincodes } = entries[k];
            const virtualZoneName = `${zone}_${rate}`;
            safexpressVirtualZones[virtualZoneName] = rate;
            console.log(`    → Virtual zone "${virtualZoneName}" = ${rate}/kg (${count} pincodes)`);
            for (const pin of pincodes) {
                safexpressOverrides[pin] = virtualZoneName;
            }
        }
    } else {
        console.log(`  ${zone}: uniform ${majorityRate}`);
    }
}

console.log(`\n✅ Safexpress: ${Object.keys(safexpressVirtualZones).length} virtual zones, ${Object.keys(safexpressOverrides).length} pincode overrides`);

// ======================================================================
// 4. HELPER: Update a UTSF file
// ======================================================================
function loadUTSF(id) {
    const filePath = path.join(UTSF_DIR, `${id}.utsf.json`);
    const raw = fs.readFileSync(filePath, 'utf8');
    return { data: JSON.parse(raw), filePath };
}

function saveUTSF(id, data) {
    const filePath = path.join(UTSF_DIR, `${id}.utsf.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
    console.log(`💾 Saved: ${filePath}`);
}

function buildOdaSection(zones) {
    // Build ODA section grouped by zone
    const oda = {};
    for (const zone of zones) {
        const pincodes = odaPincodesByZone[zone] || [];
        oda[zone] = {
            odaRanges: [],
            odaSingles: pincodes,
            odaCount: pincodes.length
        };
    }
    return oda;
}

function addAuditEntry(data, changeSummary) {
    if (!data.updates) data.updates = [];
    data.updates.push({
        timestamp: new Date().toISOString(),
        editorId: 'EXCEL_SYNC_SCRIPT',
        reason: 'Sync UTSF with Excel source of truth',
        changeSummary,
        snapshot: null
    });
    if (data.meta) {
        data.meta.updateCount = (data.meta.updateCount || 0) + 1;
        data.meta.updatedAt = new Date().toISOString();
    }
}

// ======================================================================
// 5. UPDATE SHIPSHOPY
// ======================================================================
console.log('\n═══════════════════════════════════════');
console.log('📦 Updating SHIPSHOPY (Delhivery)...');
console.log('═══════════════════════════════════════');
{
    const { data } = loadUTSF(SHIPSHOPY_ID);
    const oldN1 = { ...data.pricing.zoneRates.N1 };
    const changes = [];

    // Update N1→X zone rates
    for (const [zone, rate] of Object.entries(excelShipshopyRates)) {
        const oldRate = data.pricing.zoneRates.N1[zone];
        if (oldRate !== rate) {
            changes.push(`N1→${zone}: ${oldRate} → ${rate}`);
        }
        data.pricing.zoneRates.N1[zone] = rate;
    }

    if (changes.length > 0) {
        console.log('  Zone rate changes:');
        changes.forEach(c => console.log(`    ${c}`));
    } else {
        console.log('  Zone rates: no changes needed');
    }

    // Update ODA pincodes
    const allZones = Object.keys(data.serviceability || data.pricing.zoneRates.N1);
    data.oda = buildOdaSection(allZones);
    const totalOda = Object.values(data.oda).reduce((sum, z) => sum + z.odaCount, 0);
    console.log(`  ODA pincodes: populated ${totalOda} across ${allZones.length} zones`);

    // Update stats
    if (data.stats) {
        data.stats.odaCount = totalOda;
    }

    addAuditEntry(data, `Updated ${changes.length} N1 zone rates from Excel; Populated ${totalOda} ODA pincodes`);
    saveUTSF(SHIPSHOPY_ID, data);
}

// ======================================================================
// 6. UPDATE SAFEXPRESS
// ======================================================================
console.log('\n═══════════════════════════════════════');
console.log('📦 Updating SAFEXPRESS...');
console.log('═══════════════════════════════════════');
{
    const { data } = loadUTSF(SAFEXPRESS_ID);
    const changes = [];

    // --- Update N1→X zone rates (default rates) ---
    for (const [zone, rate] of Object.entries(safexpressN1Rates)) {
        const oldRate = data.pricing.zoneRates.N1?.[zone];
        if (oldRate !== rate) {
            changes.push(`N1→${zone}: ${oldRate ?? 'N/A'} → ${rate}`);
        }
        if (!data.pricing.zoneRates.N1) data.pricing.zoneRates.N1 = {};
        data.pricing.zoneRates.N1[zone] = rate;
    }

    // --- Add virtual zones to N1 rate matrix ---
    for (const [vZone, rate] of Object.entries(safexpressVirtualZones)) {
        data.pricing.zoneRates.N1[vZone] = rate;
        changes.push(`N1→${vZone} (virtual): ${rate}`);
    }

    // --- Add virtual zones to ALL other origin zone rows ---
    // For non-N1 origins, set virtual zone rate = the base zone's rate for that origin
    for (const [originZone, destRates] of Object.entries(data.pricing.zoneRates)) {
        if (originZone === 'N1') continue;
        for (const [vZone, _rate] of Object.entries(safexpressVirtualZones)) {
            // Extract base zone name (e.g., "C1_15" → "C1")
            const baseZone = vZone.split('_')[0];
            const baseRate = destRates[baseZone];
            if (baseRate !== undefined) {
                destRates[vZone] = baseRate;
            }
        }
    }

    if (changes.length > 0) {
        console.log('  Zone rate changes:');
        changes.forEach(c => console.log(`    ${c}`));
    }

    // --- Add zoneOverrides ---
    data.zoneOverrides = {};
    for (const [pinStr, virtualZone] of Object.entries(safexpressOverrides)) {
        data.zoneOverrides[pinStr] = virtualZone;
    }
    console.log(`  Zone overrides: ${Object.keys(data.zoneOverrides).length} pincodes mapped to virtual zones`);

    // --- Ensure ALL zones are in serviceability ---
    const allZones = ['N1', 'N2', 'N3', 'N4', 'C1', 'C2', 'W1', 'W2', 'S1', 'S2', 'S3', 'S4', 'E1', 'E2', 'NE1', 'NE2'];
    for (const zone of allZones) {
        if (!data.serviceability[zone] || data.serviceability[zone].mode === 'NOT_SERVED') {
            data.serviceability[zone] = {
                mode: 'FULL_ZONE',
                totalInZone: 0,
                servedCount: 0,
                coveragePercent: 100,
                exceptSingles: [],
                exceptRanges: [],
                softExclusions: []
            };
            console.log(`  Serviceability: added zone ${zone} (was missing or NOT_SERVED)`);
        }
    }

    // --- Update ODA pincodes ---
    data.oda = buildOdaSection(allZones);
    const totalOda = Object.values(data.oda).reduce((sum, z) => sum + z.odaCount, 0);
    console.log(`  ODA pincodes: populated ${totalOda} across ${allZones.length} zones`);

    // Update stats
    if (data.stats) {
        data.stats.odaCount = totalOda;
    }

    addAuditEntry(data, `Updated ${changes.length} zone rates from Excel; Added ${Object.keys(safexpressOverrides).length} pincode overrides; Populated ${totalOda} ODA pincodes; Opened all 16 zones for serviceability`);
    saveUTSF(SAFEXPRESS_ID, data);
}

// ======================================================================
// 7. UPDATE DELHIVERY LITE (sync with Shipshopy rates)
// ======================================================================
console.log('\n═══════════════════════════════════════');
console.log('📦 Updating DELHIVERY LITE...');
console.log('═══════════════════════════════════════');
{
    const { data } = loadUTSF(DELHIVERY_LITE_ID);
    const changes = [];

    // Sync N1→X zone rates with Shipshopy (same Excel rates)
    for (const [zone, rate] of Object.entries(excelShipshopyRates)) {
        const oldRate = data.pricing.zoneRates.N1?.[zone];
        if (oldRate !== rate) {
            changes.push(`N1→${zone}: ${oldRate} → ${rate}`);
        }
        if (!data.pricing.zoneRates.N1) data.pricing.zoneRates.N1 = {};
        data.pricing.zoneRates.N1[zone] = rate;
    }

    if (changes.length > 0) {
        console.log('  Zone rate changes:');
        changes.forEach(c => console.log(`    ${c}`));
    } else {
        console.log('  Zone rates: no changes needed');
    }

    // Update ODA pincodes
    const allZones = Object.keys(data.serviceability || data.pricing.zoneRates.N1);
    data.oda = buildOdaSection(allZones);
    const totalOda = Object.values(data.oda).reduce((sum, z) => sum + z.odaCount, 0);
    console.log(`  ODA pincodes: populated ${totalOda} across ${allZones.length} zones`);

    if (data.stats) {
        data.stats.odaCount = totalOda;
    }

    addAuditEntry(data, `Synced ${changes.length} N1 zone rates with Shipshopy from Excel; Populated ${totalOda} ODA pincodes`);
    saveUTSF(DELHIVERY_LITE_ID, data);
}

// ======================================================================
// 8. VERIFICATION SUMMARY
// ======================================================================
console.log('\n═══════════════════════════════════════');
console.log('✅ ALL UPDATES COMPLETE');
console.log('═══════════════════════════════════════');
console.log('\nExpected results for pincode 689703 (S4, ODA=Yes), 800 kg:');
{
    const shipRate = excelShipshopyRates['S4'];
    const shipBase = shipRate * 800;
    const shipODA = 500 + Math.max(0, 800 - 200) * 3; // excess mode
    const shipDocket = 100;
    console.log(`  Shipshopy: Base=${shipBase} + Docket=${shipDocket} + ODA=${shipODA} = ${shipBase + shipDocket + shipODA}`);

    const safeRate = safexpressN1Rates['S4'];
    const safeBase = safeRate * 800;
    const safeFuel = Math.min((5 / 100) * safeBase, 400);
    const safeDocket = 350;
    const safeROV = 100;
    const safeODA = 500;
    console.log(`  Safexpress: Base=${safeBase} + Fuel=${safeFuel} + Docket=${safeDocket} + ROV=${safeROV} + ODA=${safeODA} = ${safeBase + safeFuel + safeDocket + safeROV + safeODA}`);
}

console.log('\nExpected results for pincode 226010 (N3, ODA=No), 2500 kg:');
{
    const shipRate = excelShipshopyRates['N3'];
    const shipBase = shipRate * 2500;
    console.log(`  Shipshopy: Base=${shipBase} + Docket=100 = ${shipBase + 100}`);

    const safeRate = safexpressN1Rates['N3'];
    const safeBase = safeRate * 2500;
    const safeFuel = Math.min((5 / 100) * safeBase, 400);
    console.log(`  Safexpress: Base=${safeBase} + Fuel=${safeFuel} + Docket=350 + ROV=100 = ${safeBase + safeFuel + 450}`);
}
