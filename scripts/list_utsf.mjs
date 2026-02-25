import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utsfDir = path.resolve(__dirname, '../data/utsf');

const files = fs.readdirSync(utsfDir).filter(f => f.endsWith('.utsf.json'));
for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(utsfDir, f), 'utf8'));
    console.log(`${f} -> ${data.meta.companyName} (ID: ${data.meta.id})`);
}
