/**
 * UTSF Manager - Administrative Control Plane
 * 
 * Provides audit, repair, and rollback utilities for UTSF files.
 * Can be run as CLI or imported as module.
 * 
 * Usage:
 *   node scripts/utsfManager.js audit          - Scan all UTSF files, report compliance
 *   node scripts/utsfManager.js repair <id>    - Repair specific transporter
 *   node scripts/utsfManager.js repair-all     - Batch-repair all transporters
 *   node scripts/utsfManager.js rollback <id> <version> - Rollback to version
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');

// ============================================================================
// MASTER PINCODES LOADER
// ============================================================================

function loadMasterPincodes() {
    if (!fs.existsSync(PINCODES_PATH)) {
        console.error('[UTSFManager] Master pincodes not found at:', PINCODES_PATH);
        return { pincodeToZone: {}, zoneToPincodes: {} };
    }

    const data = JSON.parse(fs.readFileSync(PINCODES_PATH, 'utf8'));
    const pincodeToZone = {};
    const zoneToPincodes = {};

    data.forEach(entry => {
        const pincode = Number(entry.pincode);
        const zone = entry.zone?.toUpperCase();
        if (!isNaN(pincode) && zone) {
            pincodeToZone[pincode] = zone;
            if (!zoneToPincodes[zone]) {
                zoneToPincodes[zone] = [];
            }
            zoneToPincodes[zone].push(pincode);
        }
    });

    console.log(`[UTSFManager] Loaded ${Object.keys(pincodeToZone).length} master pincodes across ${Object.keys(zoneToPincodes).length} zones`);
    return { pincodeToZone, zoneToPincodes };
}

// ============================================================================
// PINCODE COMPRESSION (mirrors utsfEncoder.ts)
// ============================================================================

function compressToRanges(pincodes, threshold = 3) {
    if (!pincodes || pincodes.length === 0) return { ranges: [], singles: [] };

    const sorted = [...new Set(pincodes)].sort((a, b) => a - b);
    const ranges = [];
    const singles = [];

    let start = sorted[0];
    let end = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        const pin = sorted[i];
        if (pin === end + 1) {
            end = pin;
        } else {
            if (end - start >= threshold - 1) {
                ranges.push({ s: start, e: end });
            } else {
                for (let p = start; p <= end; p++) singles.push(p);
            }
            start = pin;
            end = pin;
        }
    }

    if (end - start >= threshold - 1) {
        ranges.push({ s: start, e: end });
    } else {
        for (let p = start; p <= end; p++) singles.push(p);
    }

    return { ranges, singles: singles.sort((a, b) => a - b) };
}

function expandPincodeRanges(ranges = [], singles = []) {
    const pincodes = new Set();
    if (Array.isArray(singles)) {
        singles.forEach(pin => {
            const p = Number(pin);
            if (!isNaN(p)) pincodes.add(p);
        });
    }
    if (Array.isArray(ranges)) {
        ranges.forEach(range => {
            let start, end;
            if (Array.isArray(range)) {
                [start, end] = range;
            } else if (range && typeof range === 'object') {
                start = range.s;
                end = range.e;
            } else return;
            start = Number(start);
            end = Number(end);
            if (!isNaN(start) && !isNaN(end)) {
                for (let pin = start; pin <= end; pin++) pincodes.add(pin);
            }
        });
    }
    return pincodes;
}

// ============================================================================
// AUDIT: Scan and report compliance
// ============================================================================

export function audit() {
    const { pincodeToZone, zoneToPincodes } = loadMasterPincodes();

    if (!fs.existsSync(UTSF_DIR)) {
        console.error('[UTSFManager] UTSF directory not found:', UTSF_DIR);
        return [];
    }

    const files = fs.readdirSync(UTSF_DIR).filter(f => f.endsWith('.utsf.json'));
    console.log(`\n[UTSFManager] Auditing ${files.length} UTSF files...\n`);

    const results = [];

    for (const filename of files) {
        const filePath = path.join(UTSF_DIR, filename);
        const utsfData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const companyName = utsfData.meta?.companyName || 'UNKNOWN';
        const id = utsfData.meta?.id || filename;

        // Check governance headers
        const hasGovernance = !!(utsfData.meta?.created && utsfData.meta?.version && utsfData.updates);
        const complianceScore = utsfData.stats?.complianceScore ?? null;
        const updateCount = utsfData.meta?.updateCount || 0;

        // Compute actual compliance by checking against master
        let actualCompliance = 1.0;
        let totalMaster = 0;
        let totalMissing = 0;

        const serviceability = utsfData.serviceability || {};
        for (const [zone, coverage] of Object.entries(serviceability)) {
            const masterPins = zoneToPincodes[zone] || [];
            totalMaster += masterPins.length;

            if (coverage.mode === 'FULL_ZONE') {
                // Check if ALL master pincodes are truly served (no exceptions)
                const exceptRanges = coverage.exceptRanges || coverage.except_ranges || [];
                const exceptSingles = coverage.exceptSingles || coverage.except_singles || [];
                if (exceptRanges.length > 0 || exceptSingles.length > 0) {
                    const exceptions = expandPincodeRanges(exceptRanges, exceptSingles);
                    totalMissing += exceptions.size;
                }
            } else if (['FULL_MINUS_EXCEPTIONS', 'FULL_MINUS_EXCEPT'].includes(coverage.mode)) {
                const exceptRanges = coverage.exceptRanges || coverage.except_ranges || [];
                const exceptSingles = coverage.exceptSingles || coverage.except_singles || [];
                const exceptions = expandPincodeRanges(exceptRanges, exceptSingles);
                totalMissing += exceptions.size;
            } else if (coverage.mode === 'ONLY_SERVED') {
                const servedRanges = coverage.servedRanges || coverage.served_ranges || [];
                const servedSingles = coverage.servedSingles || coverage.served_singles || [];
                const served = expandPincodeRanges(servedRanges, servedSingles);
                totalMissing += Math.max(0, masterPins.length - served.size);
            } else if (coverage.mode === 'NOT_SERVED') {
                totalMissing += masterPins.length;
            }
        }

        if (totalMaster > 0) {
            actualCompliance = Math.round((1.0 - (totalMissing / totalMaster)) * 10000) / 10000;
        }

        // Zone override count
        const zoneOverrideCount = utsfData.zoneOverrides ? Object.keys(utsfData.zoneOverrides).length : 0;

        const result = {
            id,
            companyName,
            filename,
            hasGovernance,
            storedComplianceScore: complianceScore,
            actualComplianceScore: actualCompliance,
            updateCount,
            zoneOverrideCount,
            needsRepair: !hasGovernance || actualCompliance < 1.0
        };

        results.push(result);

        const status = result.needsRepair ? '⚠️  NEEDS REPAIR' : '✅ OK';
        console.log(`  ${status}  ${companyName.padEnd(25)} compliance=${actualCompliance.toFixed(4)} governance=${hasGovernance ? 'v3' : 'LEGACY'} overrides=${zoneOverrideCount}`);
    }

    console.log(`\n[UTSFManager] Audit complete: ${results.filter(r => r.needsRepair).length}/${results.length} need repair\n`);
    return results;
}

// ============================================================================
// COMPARE: Detail breakdown of served vs master pincodes
// ============================================================================

export function compare(transporterId) {
    const { pincodeToZone, zoneToPincodes } = loadMasterPincodes();
    const filePath = path.join(UTSF_DIR, `${transporterId}.utsf.json`);

    if (!fs.existsSync(filePath)) {
        return null;
    }

    const utsfData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const serviceability = utsfData.serviceability || {};
    const zones = {};

    for (const [zone, masterPins] of Object.entries(zoneToPincodes)) {
        const coverage = serviceability[zone] || { mode: 'NOT_SERVED' };
        const masterCount = masterPins.length;
        let servedCount = 0;
        let missingPincodes = [];

        if (coverage.mode === 'FULL_ZONE') {
            const exceptRanges = coverage.exceptRanges || coverage.except_ranges || [];
            const exceptSingles = coverage.exceptSingles || coverage.except_singles || [];
            if (exceptRanges.length > 0 || exceptSingles.length > 0) {
                const exceptions = expandPincodeRanges(exceptRanges, exceptSingles);
                missingPincodes = [...exceptions].sort((a, b) => a - b);
                servedCount = Math.max(0, masterCount - missingPincodes.length);
            } else {
                servedCount = masterCount;
            }
        } else if (['FULL_MINUS_EXCEPTIONS', 'FULL_MINUS_EXCEPT'].includes(coverage.mode)) {
            const exceptRanges = coverage.exceptRanges || coverage.except_ranges || [];
            const exceptSingles = coverage.exceptSingles || coverage.except_singles || [];
            const exceptions = expandPincodeRanges(exceptRanges, exceptSingles);
            missingPincodes = [...exceptions].sort((a, b) => a - b);
            servedCount = Math.max(0, masterCount - missingPincodes.length);
        } else if (coverage.mode === 'ONLY_SERVED') {
            const servedRanges = coverage.servedRanges || coverage.served_ranges || [];
            const servedSingles = coverage.servedSingles || coverage.served_singles || [];
            const served = expandPincodeRanges(servedRanges, servedSingles);

            // Calculate missing
            masterPins.forEach(pin => {
                if (!served.has(Number(pin))) missingPincodes.push(Number(pin));
            });
            missingPincodes.sort((a, b) => a - b);
            servedCount = served.size;
        } else {
            // NOT_SERVED or undefined
            missingPincodes = [...masterPins].sort((a, b) => a - b);
            servedCount = 0;
        }

        if (masterCount > 0) {
            zones[zone] = {
                masterCount,
                servedCount,
                missingCount: missingPincodes.length,
                compliance: Math.round((servedCount / masterCount) * 100),
                missingPincodes: missingPincodes.length > 0 ? missingPincodes : []
            };
        }
    }

    return {
        id: transporterId,
        companyName: utsfData.meta?.companyName,
        zones
    };
}

// ============================================================================
// REPAIR: Fix a specific UTSF file
// ============================================================================

export function repair(transporterId, editorId = 'SYSTEM_REPAIR_BOT') {
    const { pincodeToZone, zoneToPincodes } = loadMasterPincodes();
    const now = new Date().toISOString();

    const filePath = path.join(UTSF_DIR, `${transporterId}.utsf.json`);
    if (!fs.existsSync(filePath)) {
        console.error(`[UTSFManager] UTSF file not found: ${filePath}`);
        return null;
    }

    const utsfData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const companyName = utsfData.meta?.companyName || 'UNKNOWN';

    console.log(`[UTSFManager] Repairing: ${companyName} (${transporterId}) by ${editorId}`);

    let changesMade = [];

    // 1. Inject governance headers if missing
    if (!utsfData.meta.created) {
        utsfData.meta.created = {
            by: editorId,
            at: utsfData.meta?.createdAt || utsfData.generatedAt || now,
            source: utsfData.sourceFormat || 'UNKNOWN'
        };
        changesMade.push('Injected meta.created governance header');
    }
    if (!utsfData.meta.version) {
        utsfData.meta.version = '3.0.0';
        changesMade.push('Set meta.version to 3.0.0');
    }
    if (utsfData.meta.updateCount === undefined) {
        utsfData.meta.updateCount = 0;
        changesMade.push('Initialized meta.updateCount');
    }
    if (!utsfData.updates) {
        utsfData.updates = [];
        changesMade.push('Initialized updates[] audit trail');
    }

    // 2. Bump version & Set Integrity
    utsfData.version = '3.0';
    if (utsfData.meta.integrityMode !== 'STRICT') {
        utsfData.meta.integrityMode = 'STRICT';
        changesMade.push('Enabled Strict Mode (integrityMode=STRICT)');
    }

    // 3. Strict delta: ensure every zone's exceptions are complete
    const serviceability = utsfData.serviceability || {};
    let totalForcedExceptions = 0;
    let totalMasterPincodes = 0;
    const zoneOverrides = utsfData.zoneOverrides || {};

    for (const [zone, coverage] of Object.entries(serviceability)) {
        const masterPins = zoneToPincodes[zone] || [];
        totalMasterPincodes += masterPins.length;

        if (masterPins.length === 0) continue;

        // Get currently served pincodes
        let servedPins = new Set();

        if (coverage.mode === 'FULL_ZONE' || ['FULL_MINUS_EXCEPTIONS', 'FULL_MINUS_EXCEPT'].includes(coverage.mode)) {
            // Start with all master pincodes
            servedPins = new Set(masterPins.map(Number));

            // Remove exceptions
            const exceptRanges = coverage.exceptRanges || coverage.except_ranges || [];
            const exceptSingles = coverage.exceptSingles || coverage.except_singles || [];
            const exceptions = expandPincodeRanges(exceptRanges, exceptSingles);
            exceptions.forEach(pin => servedPins.delete(pin));
        } else if (coverage.mode === 'ONLY_SERVED') {
            const servedRanges = coverage.servedRanges || coverage.served_ranges || [];
            const servedSingles = coverage.servedSingles || coverage.served_singles || [];
            servedPins = expandPincodeRanges(servedRanges, servedSingles);
        }

        // Calculate missing pincodes (in master but not served)
        const missingPins = [];
        for (const masterPin of masterPins) {
            if (!servedPins.has(Number(masterPin))) {
                missingPins.push(Number(masterPin));
            }
        }

        totalForcedExceptions += missingPins.length;

        // If there are missing pincodes and mode is FULL_ZONE, upgrade to FULL_MINUS_EXCEPT
        if (coverage.mode === 'FULL_ZONE' && missingPins.length > 0) {
            coverage.mode = 'FULL_MINUS_EXCEPT';

            const { ranges, singles } = compressToRanges(missingPins);
            coverage.exceptRanges = ranges;
            coverage.exceptSingles = singles;
            coverage.servedCount = servedPins.size;
            coverage.coveragePercent = Math.round((servedPins.size / masterPins.length) * 100 * 100) / 100;

            changesMade.push(`Zone ${zone}: FULL_ZONE → FULL_MINUS_EXCEPT (${missingPins.length} exceptions injected)`);
        }
    }

    // 4. Compute compliance score
    const complianceScore = totalMasterPincodes > 0
        ? Math.round((1.0 - (totalForcedExceptions / totalMasterPincodes)) * 10000) / 10000
        : 1.0;

    if (!utsfData.stats) utsfData.stats = {};
    utsfData.stats.complianceScore = complianceScore;

    // 5. Save zone overrides
    if (Object.keys(zoneOverrides).length > 0) {
        utsfData.zoneOverrides = zoneOverrides;
    }

    // 5b. Auto-Unblock Soft Exclusions
    // Check if any soft-excluded pincodes are now served by this transporter.
    // If yes, auto-remove them from softExclusions (the temporary block lifts).
    let softUnblocked = 0;
    for (const [zone, coverage] of Object.entries(serviceability)) {
        const softExclusions = coverage.softExclusions || [];
        if (softExclusions.length === 0) continue;

        const masterPins = zoneToPincodes[zone] || [];
        // Rebuild served set for this zone to check coverage
        let zoneServed = new Set();
        if (coverage.mode === 'FULL_ZONE' || ['FULL_MINUS_EXCEPTIONS', 'FULL_MINUS_EXCEPT'].includes(coverage.mode)) {
            zoneServed = new Set(masterPins.map(Number));
            // Remove permanent exceptions only (not soft)
            const exceptRanges = coverage.exceptRanges || coverage.except_ranges || [];
            const exceptSingles = coverage.exceptSingles || coverage.except_singles || [];
            const permExceptions = expandPincodeRanges(exceptRanges, exceptSingles);
            permExceptions.forEach(pin => zoneServed.delete(pin));
        } else if (coverage.mode === 'ONLY_SERVED') {
            const servedRanges = coverage.servedRanges || coverage.served_ranges || [];
            const servedSingles = coverage.servedSingles || coverage.served_singles || [];
            zoneServed = expandPincodeRanges(servedRanges, servedSingles);
        }

        // Check each soft exclusion: if it would be served (is in zone coverage), keep blocking.
        // But if the pincode is NOT in master zone (meaning no coverage), keep blocking too.
        // Only unblock if we have positive evidence it's now served.
        // For now: unblock iff the pincode is in the master zone AND in the served set
        const remaining = [];
        for (const pin of softExclusions) {
            const p = Number(pin);
            if (zoneServed.has(p) && masterPins.includes(p)) {
                // This pincode is now genuinely served — lift the soft block
                softUnblocked++;
                console.log(`  [SOFT-UNBLOCK] Auto-removed ${p} from softExclusions in zone ${zone}`);
            } else {
                remaining.push(p);
            }
        }
        coverage.softExclusions = remaining;
    }

    if (softUnblocked > 0) {
        changesMade.push(`Auto-unblocked ${softUnblocked} soft exclusions (now served)`);
    }

    // 6. Append audit entry
    utsfData.meta.updateCount = (utsfData.meta.updateCount || 0) + 1;
    utsfData.updates.push({
        timestamp: now,
        editorId: editorId,
        reason: 'Repair Script Fix',
        changeSummary: changesMade.join('; ') || 'No changes needed',
        snapshot: null
    });

    // 7. Save to disk
    fs.writeFileSync(filePath, JSON.stringify(utsfData, null, 2), 'utf8');

    console.log(`[UTSFManager] Repaired: ${companyName}`);
    console.log(`  Changes: ${changesMade.length > 0 ? changesMade.join(', ') : 'None (already compliant)'}`);
    console.log(`  Compliance Score: ${complianceScore}`);

    return { id: transporterId, companyName, changesMade, complianceScore };
}

// ============================================================================
// REPAIR ALL: Batch-repair all UTSF files
// ============================================================================

export function repairAll() {
    if (!fs.existsSync(UTSF_DIR)) {
        console.error('[UTSFManager] UTSF directory not found:', UTSF_DIR);
        return [];
    }

    const files = fs.readdirSync(UTSF_DIR).filter(f => f.endsWith('.utsf.json'));
    console.log(`\n[UTSFManager] Batch-repairing ${files.length} UTSF files...\n`);

    const results = [];

    for (const filename of files) {
        const utsfData = JSON.parse(fs.readFileSync(path.join(UTSF_DIR, filename), 'utf8'));
        const transporterId = utsfData.meta?.id || filename.replace('.utsf.json', '');
        const result = repair(transporterId);
        if (result) results.push(result);
    }

    console.log(`\n[UTSFManager] Batch repair complete: ${results.length} files processed\n`);
    return results;
}

// ============================================================================
// ROLLBACK: Restore from updates[] history
// ============================================================================

export function rollback(transporterId, versionIndex) {
    const filePath = path.join(UTSF_DIR, `${transporterId}.utsf.json`);
    if (!fs.existsSync(filePath)) {
        console.error(`[UTSFManager] UTSF file not found: ${filePath}`);
        return null;
    }

    const utsfData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const updates = utsfData.updates || [];

    if (versionIndex < 0 || versionIndex >= updates.length) {
        console.error(`[UTSFManager] Invalid version index ${versionIndex}. Available: 0-${updates.length - 1}`);
        return null;
    }

    const targetUpdate = updates[versionIndex];
    const now = new Date().toISOString();

    // If snapshot exists, restore from it
    if (targetUpdate.snapshot) {
        try {
            const snapshotData = JSON.parse(targetUpdate.snapshot);
            Object.assign(utsfData, snapshotData);
        } catch (e) {
            console.error(`[UTSFManager] Failed to parse snapshot at version ${versionIndex}:`, e.message);
            return null;
        }
    }

    // Append rollback audit entry
    utsfData.meta.updateCount = (utsfData.meta.updateCount || 0) + 1;
    utsfData.updates.push({
        timestamp: now,
        editorId: 'SYSTEM_REPAIR_BOT',
        reason: `Rollback to version index ${versionIndex}`,
        changeSummary: `Rolled back to: ${targetUpdate.changeSummary || targetUpdate.reason || 'N/A'}`,
        snapshot: null
    });

    fs.writeFileSync(filePath, JSON.stringify(utsfData, null, 2), 'utf8');
    console.log(`[UTSFManager] Rolled back ${utsfData.meta?.companyName || transporterId} to version ${versionIndex}`);

    return { id: transporterId, rolledBackTo: versionIndex, companyName: utsfData.meta?.companyName };
}

// ============================================================================
// CLI ENTRYPOINT
// ============================================================================

const args = process.argv.slice(2);
const command = args[0];

if (command === 'audit') {
    audit();
} else if (command === 'repair') {
    if (args[1]) {
        repair(args[1]);
    } else {
        console.log('Usage: node scripts/utsfManager.js repair <transporterId>');
    }
} else if (command === 'repair-all') {
    repairAll();
} else if (command === 'rollback') {
    if (args[1] && args[2]) {
        rollback(args[1], parseInt(args[2], 10));
    } else {
        console.log('Usage: node scripts/utsfManager.js rollback <transporterId> <versionIndex>');
    }
} else if (command) {
    console.log(`Unknown command: ${command}`);
    console.log('Commands: audit, repair <id>, repair-all, rollback <id> <version>');
}
