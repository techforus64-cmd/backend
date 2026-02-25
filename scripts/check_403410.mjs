import { pathToFileURL } from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { UTSFTransporter } = await import(pathToFileURL(path.resolve(__dirname, '../services/utsfService.js')).href);

const master = {};
JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/pincodes.json'), 'utf8')).forEach(e => {
    if (e.pincode && e.zone) master[parseInt(e.pincode)] = e.zone;
});

const dbs = new UTSFTransporter(
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/utsf/67b4b800db5c000000000001.utsf.json'), 'utf8')),
    master
);

const svc = dbs.checkServiceability(403410);
console.log('403410 serviceability:', JSON.stringify(svc));

const r = dbs.calculatePrice(110020, 403410, 700, 1);
if (r?.error) {
    console.log('ERROR:', r.error);
} else {
    console.log('\nDBS 403410 (Goa W2, ODA, 700kg):');
    console.log('  masterZone:', master[403410]);
    console.log('  isOda:', svc.isOda);
    console.log('  Total:  Rs', r.totalCharges, '  (Excel: 9882.5)');
    console.log('  Base:   Rs', r.baseFreight);
    console.log('  Fuel:   Rs', r.breakdown.fuelCharges);
    console.log('  Docket: Rs', r.breakdown.docketCharge);
    console.log('  ODA:    Rs', r.breakdown.odaCharges, '  (Excel: 2800)');
    const match = Math.abs(r.totalCharges - 9882.5) < 0.5;
    console.log('\n  ' + (match ? 'PASS: matches Excel 9882.5' : 'FAIL: does not match Excel 9882.5'));
}
