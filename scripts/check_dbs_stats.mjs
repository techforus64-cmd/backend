/**
 * check_dbs_stats.mjs
 *
 * Prints coverage statistics for all zones in DB Schenker UTSF.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DBS_ID = '67b4b800db5c000000000001';
const UTSF_PATH = path.resolve(__dirname, `../data/utsf/${DBS_ID}.utsf.json`);

const data = JSON.parse(fs.readFileSync(UTSF_PATH, 'utf8'));
const serv = data.serviceability || {};

console.log(`DB Schenker Serviceability Stats:`);
console.log(`---------------------------------`);
console.log(`Zone\tCount\tMode`);

Object.keys(serv).sort().forEach(z => {
    const s = serv[z];
    const count = (s.servedSingles ? s.servedSingles.length : 0) +
        (s.servedRanges ? s.servedRanges.reduce((acc, r) => acc + (r.end - r.start + 1), 0) : 0);
    console.log(`${z}\t${count}\t${s.mode}`);
});
