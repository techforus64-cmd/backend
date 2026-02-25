import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../data/utsf');

const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.utsf.json'));

files.forEach(f => {
    try {
        const content = fs.readFileSync(path.join(DATA_DIR, f), 'utf8');
        const data = JSON.parse(content);
        const name = data.name || data.transporterName || (data.transporter && data.transporter.name) || 'Unknown';
        const oda = data.pricing?.priceRate?.odaCharges || 'None';
        console.log(`File: ${f}`);
        console.log(`  Name: ${name}`);
        console.log(`  Size: ${content.length} bytes`);
        console.log(`  ODA: ${JSON.stringify(oda)}`);
        console.log('---');
    } catch (e) {
        console.log(`File: ${f} - Error: ${e.message}`);
    }
});
