import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import haversine from '../src/utils/haversine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const centroids = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/pincode_centroids.json'), 'utf8'));
const getLL = (p) => centroids.find(c => String(c.pincode) === String(p));

const origin = getLL(110020); // Delhi Okhla
if (!origin) { console.error('Origin not found'); process.exit(1); }

const dests = [
    193225, // Tangdhar, J&K (LoC)
    194101, // Leh, Ladakh
    194301, // Kargil, Ladakh
    194403, // Zanskar, Ladakh
    172107, // Kalpa, HP (Kinnaur)
    175131, // Manali, HP
    737101, // Gangtok, Sikkim
    794001, // Tura, Meghalaya
    790001, // Itanagar, Arunachal
    334001  // Bikaner, Rajasthan (Desert - likely straighter roads)
];

console.log('Pincode,Region,Haversine(km),EstRoad_1.35(km),EstRoad_1.50(km),EstRoad_1.60(km)');

dests.forEach(d => {
    const t = getLL(d);
    if (!t) {
        console.log(`${d},NF,,,,`);
        return;
    }
    const dist = haversine(origin.lat, origin.lng, t.lat, t.lng);
    console.log(`${d},?,${dist.toFixed(1)},${(dist * 1.35).toFixed(1)},${(dist * 1.5).toFixed(1)},${(dist * 1.6).toFixed(1)}`);
});
