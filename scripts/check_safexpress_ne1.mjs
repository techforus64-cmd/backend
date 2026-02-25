
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ID = '6870d8765f9c12f692f3b7b3';
const PATH = path.resolve(__dirname, `../data/utsf/${ID}.utsf.json`);

const data = JSON.parse(fs.readFileSync(PATH, 'utf8'));
const zone = 'NE1';
const config = data.serviceability[zone];

if (!config) {
    console.log(`Zone ${zone} NOT configured in Safexpress UTSF.`);
} else {
    console.log(`Zone ${zone} Config:`);
    console.log(`Mode: ${config.mode}`);
    console.log(`Served Singles: ${config.servedSingles ? config.servedSingles.length : 0}`);
    if (config.servedSingles) {
        console.log(`Includes 781068? ${config.servedSingles.includes(781068)}`);
    }
}
