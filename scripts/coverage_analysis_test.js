/**
 * TEST: Coverage Analysis Script
 * Tests with just 5 pincodes before running full analysis
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Direct config (for testing)
process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';
process.env.GOOGLE_MAP_API_KEY = 'AIzaSyAqs3abXDKVZS8C_P13vs3axGLCQ3Ksbbk';

// Import distance service
import { calculateDistanceBetweenPincode } from '../utils/distanceService.js';

const ORIGIN = '110020';

// Test pincodes - mix of types:
// - 788818: Known problematic NE India (Google may fail)
// - 744101: Andaman Islands (should be unreachable)
// - 110021: Delhi nearby (should work)
// - 851121: Bihar (should work)
// - 173033: UNKNOWN zone from orphan list
const TEST_PINCODES = ['788818', '744101', '110021', '851121', '173033'];

async function main() {
  console.log('🧪 TEST: Coverage Analysis\n');
  console.log(`Testing ${TEST_PINCODES.length} pincodes: ${TEST_PINCODES.join(', ')}\n`);

  // Connect to MongoDB
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGO_DB_URL);
  console.log('✅ Connected to MongoDB\n');

  // Load pincodes.json for metadata
  const pincodesData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'pincodes.json'), 'utf8'));
  const pincodeMap = new Map(pincodesData.map(p => [String(p.pincode), p]));

  // Load vendor serviceability
  const transporters = await mongoose.connection.collection('transporters')
    .find({ approvalStatus: 'approved' })
    .project({ service: 1 })
    .toArray();

  const tempTransporters = await mongoose.connection.collection('temporarytransporters')
    .find({ approvalStatus: 'approved' })
    .project({ serviceability: 1 })
    .toArray();

  const serviceablePincodes = new Set();
  transporters.forEach(t => {
    (t.service || []).forEach(s => {
      if (s.pincode) serviceablePincodes.add(String(s.pincode));
    });
  });
  tempTransporters.forEach(t => {
    (t.serviceability || []).forEach(s => {
      if (s.pincode && s.active !== false) serviceablePincodes.add(String(s.pincode));
    });
  });

  console.log(`Vendor serviceability loaded: ${serviceablePincodes.size} pincodes\n`);
  console.log('='.repeat(80));

  for (const pin of TEST_PINCODES) {
    const metadata = pincodeMap.get(pin) || { zone: 'UNKNOWN', city: 'UNKNOWN', state: 'UNKNOWN' };
    const inVendorService = serviceablePincodes.has(pin);

    console.log(`\n📍 Testing: ${ORIGIN} → ${pin}`);
    console.log(`   Metadata: Zone=${metadata.zone}, City=${metadata.city}, State=${metadata.state}`);
    console.log(`   In vendor serviceability: ${inVendorService}`);

    try {
      const result = await calculateDistanceBetweenPincode(ORIGIN, pin);
      console.log(`   ✅ Route found: ${result.distanceKm} km, ${result.estTime} days, source: ${result.source}`);

      if (!inVendorService) {
        console.log(`   📭 RESULT: No Vendors Serviceable`);
      } else {
        console.log(`   ✅ RESULT: Covered (has route + vendor)`);
      }
    } catch (error) {
      if (error.code === 'NO_ROAD_ROUTE') {
        console.log(`   🚫 RESULT: Unreachable by Road (Google: ${error.message})`);
      } else if (error.code === 'PINCODE_NOT_FOUND') {
        console.log(`   ⚠️ RESULT: Pincode not in centroids (${error.message})`);
      } else {
        console.log(`   ❌ ERROR: ${error.message}`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('🧪 TEST COMPLETE');
  console.log('='.repeat(80));

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
