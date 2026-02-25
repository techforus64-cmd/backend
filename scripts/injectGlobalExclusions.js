/**
 * Inject Global Exclusion Pincodes into ALL UTSF files.
 * 
 * These pincodes are not covered by any transporter and must be
 * blocked across all UTSF files until a transporter is onboarded for them.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');

// ============================================================================
// GLOBAL EXCLUSION LIST (User-provided, 2026-02-12)
// ============================================================================
const EXCLUSION_PINCODES = [
    123304, 124515, 132035, 151511, 172109, 172112, 172118, 173033, 173237, 174037,
    175020, 176307, 176316, 176330, 182205, 182206, 182207, 185102, 190099, 193225,
    193306, 194102, 194106, 194107, 194109, 194201, 194202, 194301, 194302, 194303,
    201022, 203413, 204217, 212110, 222004, 222205, 224239, 244720, 249129, 249206,
    249412, 261304, 273312, 302048, 305631, 306604, 307032, 312624, 312625, 312626,
    312627, 312628, 313806, 333010, 333055, 334024, 334025, 335042, 335521, 341003,
    341307, 341309, 341521, 342017, 342311, 344802, 345028, 345031, 345034, 382050,
    382055, 382419, 382501, 384005, 384316, 385581, 387105, 410517, 411069, 411070,
    415418, 431724, 442606, 444007, 451114, 462099, 477450, 485227, 491443, 494220,
    494662, 500113, 500117, 500118, 501302, 501303, 501513, 502033, 502034, 504300,
    504314, 506325, 507112, 507127, 507171, 507315, 509328, 515006, 517508, 517509,
    518008, 521004, 521320, 522241, 524300, 530057, 530059, 532167, 532184, 532187,
    532204, 533353, 533354, 533355, 535569, 535582, 560119, 562165, 562166, 571190,
    571202, 577008, 577424, 583286, 583288, 585446, 585448, 586162, 586170, 587157,
    600133, 605403, 612906, 621119, 625552, 628155, 636907, 637216, 641051, 682551,
    682552, 682553, 682554, 682555, 682556, 682557, 682558, 682559, 690112, 711331,
    723134, 737107, 737120, 744103, 744104, 744105, 744106, 744107, 744112, 744202,
    744203, 744205, 744206, 744207, 744209, 744210, 744211, 744301, 744302, 744303,
    744304, 751032, 751035, 754298, 754299, 755063, 756050, 756088, 756089, 759149,
    759150, 765010, 765011, 766003, 768024, 782436, 783136, 788818, 791003, 794113,
    794114, 795015, 795121, 796291, 797119, 798628, 800031, 800032, 804409, 805114,
    811306, 821015, 824126, 824304, 826012, 826013, 845405, 845439, 846010, 848104,
    851121, 852134, 854110
];

// ============================================================================
// MAIN
// ============================================================================

// 1. Load master pincodes → zone mapping
const masterData = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
const pincodeToZone = {};
masterData.forEach(entry => {
    const pin = Number(entry.pincode);
    const zone = entry.zone?.toUpperCase();
    if (!isNaN(pin) && zone) pincodeToZone[pin] = zone;
});

// 2. Group exclusion pincodes by zone
const exclusionsByZone = {};
let unmapped = 0;
EXCLUSION_PINCODES.forEach(pin => {
    const zone = pincodeToZone[pin];
    if (!zone) {
        console.warn(`  ⚠️  Pincode ${pin} NOT in pincodes.json (no zone). Skipping.`);
        unmapped++;
        return;
    }
    if (!exclusionsByZone[zone]) exclusionsByZone[zone] = new Set();
    exclusionsByZone[zone].add(pin);
});

console.log(`\n[EXCLUSION] ${EXCLUSION_PINCODES.length} pincodes → ${Object.keys(exclusionsByZone).length} zones (${unmapped} unmapped)\n`);

// 3. Process each UTSF file
const files = fs.readdirSync(UTSF_DIR).filter(f => f.endsWith('.utsf.json'));
console.log(`[EXCLUSION] Processing ${files.length} UTSF files...\n`);

let totalFilesModified = 0;

for (const filename of files) {
    const filePath = path.join(UTSF_DIR, filename);
    const utsfData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const companyName = utsfData.meta?.companyName || 'UNKNOWN';
    const serviceability = utsfData.serviceability || {};

    let fileChanges = 0;
    let pincodesAdded = 0;

    for (const [zone, exclusionPins] of Object.entries(exclusionsByZone)) {
        const coverage = serviceability[zone];
        if (!coverage) continue; // Zone doesn't exist in this file

        // Skip NOT_SERVED zones — no need to exclude what's already not served
        if (coverage.mode === 'NOT_SERVED') continue;

        // Get existing soft exclusions + permanent exceptions for dedup
        const existingSoft = new Set(
            (coverage.softExclusions || []).map(Number)
        );
        const existingExceptSingles = new Set(
            (coverage.exceptSingles || coverage.except_singles || []).map(Number)
        );

        // Add new exclusions that aren't already present in either list
        let newAdded = 0;
        for (const pin of exclusionPins) {
            if (!existingSoft.has(pin) && !existingExceptSingles.has(pin)) {
                existingSoft.add(pin);
                newAdded++;
            }
        }

        if (newAdded > 0) {
            // Write soft exclusions back (sorted)
            coverage.softExclusions = [...existingSoft].sort((a, b) => a - b);

            fileChanges++;
            pincodesAdded += newAdded;
        }
    }

    if (fileChanges > 0) {
        // Append audit entry
        if (!utsfData.updates) utsfData.updates = [];
        utsfData.meta.updateCount = (utsfData.meta.updateCount || 0) + 1;
        utsfData.updates.push({
            timestamp: new Date().toISOString(),
            editorId: 'GLOBAL_EXCLUSION_SCRIPT',
            reason: 'Batch inject soft exclusion pincodes',
            changeSummary: `Added ${pincodesAdded} soft exclusions across ${fileChanges} zones`,
            snapshot: null
        });

        // Write back
        fs.writeFileSync(filePath, JSON.stringify(utsfData, null, 2), 'utf8');
        totalFilesModified++;
        console.log(`  ✅ ${companyName.padEnd(25)} +${pincodesAdded} soft exclusions across ${fileChanges} zones`);
    } else {
        console.log(`  ⏭️  ${companyName.padEnd(25)} no changes (already excluded or zones not served)`);
    }
}

console.log(`\n[EXCLUSION] Done: ${totalFilesModified}/${files.length} files modified.\n`);
