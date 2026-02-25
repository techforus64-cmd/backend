/**
 * Migration Script: Move global exclusion pincodes from exceptSingles → softExclusions
 * 
 * This is a one-time migration. After running, the 223 temporary exclusion pincodes
 * will be in a separate "softExclusions" field per zone, allowing the repair system
 * to auto-unblock them when transporters start serving those pincodes.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');

// The exact 223 pincodes injected by injectGlobalExclusions.js
const SOFT_EXCLUSION_SET = new Set([
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
]);

// ============================================================================
// MAIN
// ============================================================================

const files = fs.readdirSync(UTSF_DIR).filter(f => f.endsWith('.utsf.json'));
console.log(`\n[MIGRATION] Migrating ${SOFT_EXCLUSION_SET.size} pincodes from exceptSingles → softExclusions\n`);
console.log(`[MIGRATION] Processing ${files.length} UTSF files...\n`);

let totalFilesMigrated = 0;

for (const filename of files) {
    const filePath = path.join(UTSF_DIR, filename);
    const utsfData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const companyName = utsfData.meta?.companyName || 'UNKNOWN';
    const serviceability = utsfData.serviceability || {};

    let fileMoved = 0;

    for (const [zone, coverage] of Object.entries(serviceability)) {
        if (!coverage || coverage.mode === 'NOT_SERVED') continue;

        const currentExcept = (coverage.exceptSingles || []).map(Number);
        const softExclusions = (coverage.softExclusions || []).map(Number);

        // Split: keep permanent exceptions, move soft ones
        const permanentExcept = [];
        const newSoft = new Set(softExclusions);

        for (const pin of currentExcept) {
            if (SOFT_EXCLUSION_SET.has(pin)) {
                newSoft.add(pin);
                fileMoved++;
            } else {
                permanentExcept.push(pin);
            }
        }

        // Write back
        coverage.exceptSingles = permanentExcept.sort((a, b) => a - b);
        coverage.softExclusions = [...newSoft].sort((a, b) => a - b);
    }

    if (fileMoved > 0) {
        // Audit entry
        if (!utsfData.updates) utsfData.updates = [];
        utsfData.meta.updateCount = (utsfData.meta.updateCount || 0) + 1;
        utsfData.updates.push({
            timestamp: new Date().toISOString(),
            editorId: 'SOFT_EXCLUSION_MIGRATION',
            reason: 'Migrated temporary exclusions from exceptSingles to softExclusions',
            changeSummary: `Moved ${fileMoved} pincodes to softExclusions`,
            snapshot: null
        });

        fs.writeFileSync(filePath, JSON.stringify(utsfData, null, 2), 'utf8');
        totalFilesMigrated++;
        console.log(`  ✅ ${companyName.padEnd(25)} moved ${fileMoved} pincodes to softExclusions`);
    } else {
        console.log(`  ⏭️  ${companyName.padEnd(25)} no soft exclusions found`);
    }
}

console.log(`\n[MIGRATION] Done: ${totalFilesMigrated}/${files.length} files migrated.\n`);
