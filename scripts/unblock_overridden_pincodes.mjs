/**
 * unblock_overridden_pincodes.mjs
 *
 * For Shipshopy (and VL Cargo which shares the same structure):
 * Remove pincodes from exceptSingles/exceptRanges/softExclusions
 * if they now have a zone override — the override gives them the correct rate,
 * so blocking them is no longer needed.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTSF_DIR = path.resolve(__dirname, '../data/utsf');

const SHIP_ID = '6968ddedc2cf85d3f4380d52';
const SHIP_PATH = path.join(UTSF_DIR, `${SHIP_ID}.utsf.json`);

function processUtsf(filePath, name) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const overrides = data.zoneOverrides || {};
    const overrideSet = new Set(Object.keys(overrides).map(Number));

    if (overrideSet.size === 0) {
        console.log(`  ${name}: No zone overrides found, skipping.`);
        return;
    }

    console.log(`  ${name}: ${overrideSet.size} zone overrides found`);

    const serviceability = data.serviceability || {};
    let totalRemoved = 0;
    const removedByZone = {};

    for (const [zone, coverage] of Object.entries(serviceability)) {
        let removedFromZone = 0;

        // 1. Clean exceptSingles
        const exceptSingles = coverage.exceptSingles || coverage.except_singles || [];
        if (exceptSingles.length > 0) {
            const propName = coverage.exceptSingles ? 'exceptSingles' : 'except_singles';
            const before = exceptSingles.length;
            coverage[propName] = exceptSingles.filter(pin => {
                if (overrideSet.has(pin)) {
                    removedFromZone++;
                    return false; // Remove from exceptions
                }
                return true; // Keep
            });
            const after = coverage[propName].length;
            if (before !== after) {
                console.log(`    Zone ${zone} exceptSingles: ${before} → ${after} (removed ${before - after})`);
            }
        }

        // 2. Clean softExclusions
        const softExclusions = coverage.softExclusions || [];
        if (softExclusions.length > 0) {
            const before = softExclusions.length;
            coverage.softExclusions = softExclusions.filter(pin => {
                const p = typeof pin === 'number' ? pin : parseInt(pin, 10);
                if (overrideSet.has(p)) {
                    removedFromZone++;
                    return false;
                }
                return true;
            });
            const after = coverage.softExclusions.length;
            if (before !== after) {
                console.log(`    Zone ${zone} softExclusions: ${before} → ${after} (removed ${before - after})`);
            }
        }

        // 3. Clean exceptRanges — expand ranges, check each pin, rebuild
        const exceptRanges = coverage.exceptRanges || coverage.except_ranges || [];
        if (exceptRanges.length > 0) {
            const propName = coverage.exceptRanges ? 'exceptRanges' : 'except_ranges';
            const newRanges = [];
            for (const range of exceptRanges) {
                const start = range.s || range.start;
                const end = range.e || range.end;
                // Check if any pin in range has an override
                let currentStart = null;
                for (let pin = start; pin <= end; pin++) {
                    if (overrideSet.has(pin)) {
                        // Close current range if open
                        if (currentStart !== null) {
                            newRanges.push({ s: currentStart, e: pin - 1 });
                            currentStart = null;
                        }
                        removedFromZone++;
                    } else {
                        if (currentStart === null) currentStart = pin;
                    }
                }
                if (currentStart !== null) {
                    newRanges.push({ s: currentStart, e: end });
                }
            }
            // Filter out degenerate ranges
            coverage[propName] = newRanges.filter(r => r.s <= r.e);
            if (exceptRanges.length !== coverage[propName].length) {
                console.log(`    Zone ${zone} exceptRanges: ${exceptRanges.length} → ${coverage[propName].length} ranges`);
            }
        }

        if (removedFromZone > 0) {
            removedByZone[zone] = removedFromZone;
            totalRemoved += removedFromZone;

            // Update servedCount
            if (coverage.servedCount !== undefined) {
                coverage.servedCount += removedFromZone;
                // Recalculate coverage percent
                if (coverage.totalInZone) {
                    coverage.coveragePercent = Math.round((coverage.servedCount / coverage.totalInZone) * 10000) / 100;
                }
            }
        }
    }

    console.log(`\n  Total pincodes unblocked: ${totalRemoved}`);
    if (Object.keys(removedByZone).length > 0) {
        console.log('  By zone:');
        for (const [zone, count] of Object.entries(removedByZone)) {
            console.log(`    ${zone}: ${count} pincodes unblocked`);
        }
    }

    // Update metadata
    data.updates = data.updates || [];
    data.updates.push({
        date: new Date().toISOString(),
        by: 'UNBLOCK_OVERRIDE_SCRIPT',
        changes: `Unblocked ${totalRemoved} pincodes that have zone overrides from exception lists`,
        scope: 'serviceability'
    });

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`  ✅ Saved ${filePath}`);
}

console.log('='.repeat(60));
console.log('  Unblocking overridden pincodes from exception lists');
console.log('='.repeat(60));
console.log('\nProcessing Shipshopy...');
processUtsf(SHIP_PATH, 'Shipshopy');
