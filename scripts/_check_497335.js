const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./backend/data/utsf/6870d8765f9c12f692f3b7b3.utsf.json','utf8'));
const excel = JSON.parse(fs.readFileSync('./backend/scripts/excel_lookup.json','utf8'));

// 1. Is 497335 anywhere in the UTSF?
const str = JSON.stringify(data);
const idx = str.indexOf('497335');
console.log('497335 in UTSF file?', idx >= 0 ? 'YES at index '+idx : 'NO');

// 2. Check which zone it's in serviceability
const svc = data.serviceability || {};
const zones = Object.keys(svc);
console.log('Serviceability zones:', zones.join(', '));

for (const zone of zones) {
  const cov = svc[zone];
  const singles = (cov.servedSingles || cov.served_singles || []).map(Number);
  const ranges = cov.servedRanges || cov.served_ranges || [];

  // Check singles
  if (singles.includes(497335)) {
    console.log('497335 found in zone', zone, '(singles), mode:', cov.mode);
  }
  // Check ranges
  for (const r of ranges) {
    const start = r[0] || r.s;
    const end = r[1] || r.e;
    if (start <= 497335 && 497335 <= end) {
      console.log('497335 found in zone', zone, '(range ['+start+'-'+end+']), mode:', cov.mode);
    }
  }
}

// 3. Check if C2_15 serviceability zone exists
if (svc['C2_15']) {
  console.log('C2_15 serviceability zone EXISTS');
  const c2_15_singles = (svc['C2_15'].servedSingles || []).length;
  console.log('  C2_15 singles count:', c2_15_singles);
} else {
  console.log('C2_15 serviceability zone MISSING from serviceability section');
}

// 4. Zone rates check
const rates = data.pricing && data.pricing.zoneRates;
if (rates && rates['N1']) {
  console.log('N1 zone rates - C2:', rates['N1']['C2'], 'C2_15:', rates['N1']['C2_15']);
}

// 5. How many C2 pincodes need C2_15 override?
const c2_15_pincodes = Object.entries(excel.delhivery)
  .filter(([pin, v]) => v.zone === 'C2' && v.sfx === 15)
  .map(([pin]) => parseInt(pin));
console.log('C2 pincodes needing C2_15 override (sfx=15):', c2_15_pincodes.length);
console.log('First 10:', c2_15_pincodes.slice(0,10).join(', '));
console.log('Includes 497335?', c2_15_pincodes.includes(497335));
