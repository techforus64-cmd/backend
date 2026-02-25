/**
 * Test what the calculator sees for 110020 → 194103
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

const FROM_PINCODE = '110020';
const TO_PINCODE = '194103';

async function main() {
  await mongoose.connect(process.env.MONGO_DB_URL);

  // Load master pincodes for zone lookup
  const masterPath = path.join(__dirname, '..', 'data', 'pincodes.json');
  const masterPincodes = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
  const pincodeMap = new Map(masterPincodes.map(p => [String(p.pincode), p]));

  const fromData = pincodeMap.get(FROM_PINCODE);
  const toData = pincodeMap.get(TO_PINCODE);

  console.log('📍 Route:', FROM_PINCODE, '→', TO_PINCODE);
  console.log(`   From: ${fromData?.city}, ${fromData?.state} (Zone: ${fromData?.zone})`);
  console.log(`   To: ${toData?.city}, ${toData?.state} (Zone: ${toData?.zone})`);

  // Check which approved transporters have BOTH pincodes
  console.log('\n📦 Checking transporters with BOTH pincodes in service[]...\n');

  const transporters = await mongoose.connection.collection('transporters')
    .find({ approvalStatus: 'approved' })
    .project({ companyName: 1, service: 1, priceChart: 1 })
    .toArray();

  for (const t of transporters) {
    const serviceMap = new Map();
    for (const s of (t.service || [])) {
      if (s.pincode) serviceMap.set(String(s.pincode), s);
    }

    const hasFrom = serviceMap.has(FROM_PINCODE);
    const hasTo = serviceMap.has(TO_PINCODE);

    if (hasFrom || hasTo) {
      console.log(`${t.companyName}:`);
      console.log(`   Has origin (${FROM_PINCODE}): ${hasFrom ? 'YES' : 'NO'}`);
      console.log(`   Has destination (${TO_PINCODE}): ${hasTo ? 'YES' : 'NO'}`);

      if (hasFrom && hasTo) {
        const fromEntry = serviceMap.get(FROM_PINCODE);
        const toEntry = serviceMap.get(TO_PINCODE);
        console.log(`   Origin entry: ${JSON.stringify(fromEntry)}`);
        console.log(`   Dest entry: ${JSON.stringify(toEntry)}`);

        // Check price chart
        const originZone = fromEntry.zone || fromData?.zone;
        const destZone = toEntry.zone || toData?.zone;
        console.log(`   Price lookup: ${originZone} → ${destZone}`);

        if (t.priceChart) {
          const price = t.priceChart[originZone]?.[destZone];
          console.log(`   Price found: ${price !== undefined ? price : 'NO PRICE'}`);
        } else {
          console.log(`   Price chart: MISSING`);
        }
      }
      console.log('');
    }
  }

  // Also check temp transporters
  console.log('\n📦 Checking temp transporters...\n');

  const tempTransporters = await mongoose.connection.collection('temporarytransporters')
    .find({ approvalStatus: 'approved' })
    .project({ companyName: 1, serviceability: 1, priceChart: 1 })
    .toArray();

  for (const t of tempTransporters) {
    const serviceMap = new Map();
    for (const s of (t.serviceability || [])) {
      if (s.pincode && s.active !== false) serviceMap.set(String(s.pincode), s);
    }

    const hasFrom = serviceMap.has(FROM_PINCODE);
    const hasTo = serviceMap.has(TO_PINCODE);

    if (hasFrom || hasTo) {
      console.log(`${t.companyName}:`);
      console.log(`   Has origin (${FROM_PINCODE}): ${hasFrom ? 'YES' : 'NO'}`);
      console.log(`   Has destination (${TO_PINCODE}): ${hasTo ? 'YES' : 'NO'}`);
      console.log('');
    }
  }

  await mongoose.disconnect();
}

main().catch(console.error);
