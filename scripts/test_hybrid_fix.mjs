/**
 * test_hybrid_fix.mjs
 *
 * Verifies the FULL_ZONE/FULL_MINUS_EXCEPT + servedSingles hybrid fix.
 * Run: node backend/scripts/test_hybrid_fix.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ZoneCoverageMode = { FULL_ZONE: 'FULL_ZONE', FULL_MINUS_EXCEPTIONS: 'FULL_MINUS_EXCEPTIONS', FULL_MINUS_EXCEPT: 'FULL_MINUS_EXCEPT', ONLY_SERVED: 'ONLY_SERVED', NOT_SERVED: 'NOT_SERVED' };
function isFullMinusMode(m) { return m === 'FULL_MINUS_EXCEPTIONS' || m === 'FULL_MINUS_EXCEPT'; }
function expandPincodeRanges(ranges = [], singles = []) {
    const s = new Set();
    if (Array.isArray(singles)) singles.forEach(p => { const n = parseInt(p, 10); if (!isNaN(n)) s.add(n); });
    if (Array.isArray(ranges)) ranges.forEach(r => { let a, b; if (Array.isArray(r)) { [a, b] = r; } else if (r && typeof r === 'object') { a = r.s || r.start; b = r.e || r.end; } else return; a = parseInt(a, 10); b = parseInt(b, 10); if (!isNaN(a) && !isNaN(b) && b >= a) for (let p = a; p <= b; p++)s.add(p); });
    return s;
}

class UTSFTransporter {
    constructor(d, mp = {}) { this._data = d; this._masterPincodes = mp; this._servedPincodes = new Set(); this._exceptionPincodes = new Set(); this._softExclusionPincodes = new Set(); this._zoneServedPincodes = {}; this._buildIndexes(); }
    get companyName() { return this._data.meta?.companyName || 'Unknown'; }
    get totalPincodes() { return this._servedPincodes.size; }
    _buildIndexes() {
        const svc = this._data.serviceability || {};
        const ztp = {};
        Object.entries(this._masterPincodes).forEach(([pin, zone]) => { const p = parseInt(pin, 10); if (!isNaN(p)) { if (!ztp[zone]) ztp[zone] = new Set(); ztp[zone].add(p); } });
        // PASS 1: exceptions
        Object.entries(svc).forEach(([z, c]) => {
            const er = c.exceptRanges || c.except_ranges || [], es = c.exceptSingles || c.except_singles || [];
            if (er.length > 0 || es.length > 0) expandPincodeRanges(er, es).forEach(p => this._exceptionPincodes.add(p));
            (c.softExclusions || []).forEach(p => { const n = parseInt(p, 10); if (!isNaN(n)) { this._exceptionPincodes.add(n); this._softExclusionPincodes.add(n); } });
        });
        // PASS 2: served — WITH FIX
        Object.entries(svc).forEach(([zone, cov]) => {
            const mode = cov.mode; this._zoneServedPincodes[zone] = new Set(); let candidates = new Set();
            if (mode === ZoneCoverageMode.FULL_ZONE || isFullMinusMode(mode)) {
                const sr = cov.servedRanges || cov.served_ranges || [], ss = cov.servedSingles || cov.served_singles || [];
                if (ss.length > 0 || sr.length > 0) { candidates = expandPincodeRanges(sr, ss); }
                else { candidates = ztp[zone] || new Set(); }
            } else if (mode === ZoneCoverageMode.ONLY_SERVED) {
                candidates = expandPincodeRanges(cov.servedRanges || cov.served_ranges || [], cov.servedSingles || cov.served_singles || []);
            }
            candidates.forEach(pin => { if (!this._exceptionPincodes.has(pin)) { this._servedPincodes.add(pin); this._zoneServedPincodes[zone].add(pin); } });
        });
    }
    isServiceable(pin) { const p = parseInt(pin, 10); if (isNaN(p)) return false; if (this._exceptionPincodes.has(p)) return false; return this._servedPincodes.has(p); }
}

// Load data
const mp = {};
JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/pincodes.json'), 'utf8')).forEach(e => { const p = parseInt(e.pincode, 10); const z = e.zone?.toUpperCase(); if (!isNaN(p) && z) mp[p] = z; });
const sfData = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/utsf/6870d8765f9c12f692f3b7b3.utsf.json'), 'utf8'));
const sf = new UTSFTransporter(sfData, mp);

console.log('======================================================================');
console.log('  UTSF Hybrid Fix Verification');
console.log('======================================================================');
console.log(`Master pincodes: ${Object.keys(mp).length}`);
console.log(`Safexpress served (with fix): ${sf.totalPincodes}`);

// Build GLOBAL set of ALL pincodes in ANY zone's servedSingles/servedRanges across ALL zones
const allSafexpressServed = new Set();
Object.values(sfData.serviceability).forEach(cov => {
    (cov.servedSingles || []).forEach(p => allSafexpressServed.add(parseInt(p, 10)));
    expandPincodeRanges(cov.servedRanges || [], []).forEach(p => allSafexpressServed.add(p));
});
console.log(`Safexpress total pincodes across all zones' servedSingles: ${allSafexpressServed.size}`);

let passed = 0, failed = 0;
function test(name, actual, expected) {
    if (actual === expected) { console.log(`  PASS: ${name}`); passed++; }
    else { console.log(`  FAIL: ${name} (expected ${expected}, got ${actual})`); failed++; }
}

// TEST 1: Pincodes in servedSingles -> serviceable
console.log('\n--- Test 1: Pincodes in Safexpress servedSingles -> serviceable ---');
const n4ss = (sfData.serviceability.N4?.servedSingles || []).slice(0, 3).map(p => parseInt(p, 10));
n4ss.forEach(pin => test(`${pin} (N4 servedSingles)`, sf.isServiceable(pin), true));
const n1ss = (sfData.serviceability.N1?.servedSingles || []).slice(0, 2).map(p => parseInt(p, 10));
n1ss.forEach(pin => test(`${pin} (N1 servedSingles)`, sf.isServiceable(pin), true));

// TEST 2: Pincodes NOT in ANY zone's servedSingles -> NOT serviceable
console.log('\n--- Test 2: Pincodes NOT in ANY Safexpress servedSingles -> NOT serviceable ---');
const trulyNotServed = Object.keys(mp)
    .map(p => parseInt(p, 10))
    .filter(p => !allSafexpressServed.has(p))
    .slice(0, 5);
trulyNotServed.forEach(pin => test(`${pin} (zone=${mp[pin]}, NOT in any servedSingles)`, sf.isServiceable(pin), false));

// TEST 3: Bug pincode 176307
console.log('\n--- Test 3: Bug pincode 176307 ---');
console.log(`  176307 zone in master: ${mp[176307]}`);
console.log(`  176307 in any Safexpress servedSingles: ${allSafexpressServed.has(176307)}`);
test('176307 -> NOT serviceable by Safexpress', sf.isServiceable(176307), false);

// Summary
console.log(`\n${'='.repeat(70)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(70));
if (failed > 0) { console.log('SOME TESTS FAILED'); process.exit(1); }
else { console.log(`ALL TESTS PASSED! Safexpress: ${sf.totalPincodes} served pincodes`); process.exit(0); }
