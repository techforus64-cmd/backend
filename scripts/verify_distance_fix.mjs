import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateDistanceBetweenPincode } from '../utils/distanceService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

console.log('Testing distance fix for border pincode 193225 (Tangdhar)...');

async function test() {
    try {
        const origin = '110020';
        const dest = '193225';

        console.log(`Calculating distance: ${origin} -> ${dest}`);
        const result = await calculateDistanceBetweenPincode(origin, dest);

        console.log('\n✅ SUCCESS: Got result instead of error!');
        console.log('Result:', result);

        if (result.source === 'centroid-fallback' || result.source === 'haversine') {
            console.log('Source: Fallback (Correct behavior for border region)');
        } else {
            console.log(`Source: ${result.source} (Unexpected but acceptable if Google worked)`);
        }

    } catch (err) {
        console.error('\n❌ FAILED: Still throwing error');
        console.error(err);
        process.exit(1);
    }
}

test();
