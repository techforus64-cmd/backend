import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const data  = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/utsf/6870d8765f9c12f692f3b7b3.utsf.json'), 'utf8'));
const excel = JSON.parse(fs.readFileSync(path.join(__dirname, 'excel_lookup.json'), 'utf8'));

// 1. Is 497335 anywhere in the UTSF at all?
const idx = JSON.stringify(data).indexOf('497335');
console.log('497335 in UTSF file?', idx >= 0 ? 'YES' : 'NO');

// 2. Which serviceability zone is it in?
const svc = data.serviceability || {};
console.log('\nServiceability zones:', Object.keys(svc).join(', '));
let foundInZone = null;
for (const [zone, cov] of Object.entries(svc)) {
  const singles = (cov.servedSingles || cov.served_singles || []).map(Number);
  const ranges  = cov.servedRanges  || cov.served_ranges  || [];
  if (singles.includes(497335)) {
    console.log(`497335 in zone "${zone}" via singles, mode=${cov.mode}`);
    foundInZone = zone;
  }
  for (const r of ranges) {
    const s = r[0] ?? r.s, e = r[1] ?? r.e;
    if (s <= 497335 && 497335 <= e) {
      console.log(`497335 in zone "${zone}" via range [${s}-${e}], mode=${cov.mode}`);
      foundInZone = zone;
    }
  }
}
if (!foundInZone) console.log('497335 NOT found in any served list → not served or served via master zone');

// 3. C2_15 serviceability zone?
if (svc['C2_15']) {
  const cnt = (svc['C2_15'].servedSingles || []).length;
  console.log(`\nC2_15 serviceability zone EXISTS with ${cnt} singles`);
} else {
  console.log('\nC2_15 serviceability zone MISSING ← this is why the override is not applied');
}

// 4. Zone rates
const rates = data.pricing?.zoneRates?.N1 || {};
console.log('\nN1 zone rates:');
console.log('  C2   =', rates['C2'],   '(default)');
console.log('  C2_15=', rates['C2_15'], '(override key exists?', 'C2_15' in rates, ')');

// 5. Which pincodes need C2_15 override?
const need_c2_15 = Object.entries(excel.delhivery)
  .filter(([, v]) => v.zone === 'C2' && v.sfx === 15)
  .map(([pin]) => parseInt(pin));
console.log('\nC2 pincodes that Excel says should be ₹15/kg:', need_c2_15.length);
console.log('Includes 497335?', need_c2_15.includes(497335));
console.log('First 20:', need_c2_15.slice(0, 20).join(', '));
