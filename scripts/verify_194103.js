/**
 * Verify 194103 coverage in detail
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

const ORIGIN = '110020';
const DEST = '194103';

async function main() {
  await mongoose.connect(process.env.MONGO_DB_URL);

  // Load master for zone lookup
  const masterPath = path.join(__dirname, '..', 'data', 'pincodes.json');
  const masterPincodes = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
  const masterMap = new Map(masterPincodes.map(p => [String(p.pincode), p]));

  console.log(`📍 Route: ${ORIGIN} → ${DEST}`);
  console.log(`   Origin master zone: ${masterMap.get(ORIGIN)?.zone}`);
  console.log(`   Dest master zone: ${masterMap.get(DEST)?.zone}\n`);

  // Load prices
  const allPrices = await mongoose.connection.collection('prices').find().toArray();
  const pricesByCompanyId = new Map();
  for (const p of allPrices) {
    pricesByCompanyId.set(String(p.companyId), p);
  }

  // Check all transporters
  const transporters = await mongoose.connection.collection('transporters')
    .find({ approvalStatus: 'approved' })
    .toArray();

  console.log('Checking transporters:\n');

  for (const t of transporters) {
    const serviceMap = new Map();
    for (const s of (t.service || [])) {
      if (s.pincode) serviceMap.set(String(s.pincode), s);
    }

    const hasOrigin = serviceMap.has(ORIGIN);
    const hasDest = serviceMap.has(DEST);

    if (!hasOrigin && !hasDest) continue;

    console.log(`${t.companyName}:`);
    console.log(`   Has origin (${ORIGIN}): ${hasOrigin}`);
    console.log(`   Has dest (${DEST}): ${hasDest}`);

    if (hasOrigin && hasDest) {
      const originEntry = serviceMap.get(ORIGIN);
      const destEntry = serviceMap.get(DEST);

      console.log(`   Origin service entry zone: ${originEntry?.zone}`);
      console.log(`   Dest service entry zone: ${destEntry?.zone}`);

      // Get price document
      const priceDoc = pricesByCompanyId.get(String(t._id));
      console.log(`   Has price doc: ${!!priceDoc}`);

      if (priceDoc?.zoneRates) {
        const originZone = originEntry?.zone || masterMap.get(ORIGIN)?.zone;
        const destZone = destEntry?.zone || masterMap.get(DEST)?.zone;

        console.log(`   Looking up: ${originZone} → ${destZone}`);

        const rate = priceDoc.zoneRates[originZone]?.[destZone];
        console.log(`   Rate found: ${rate !== undefined ? rate : 'NO RATE'}`);

        if (rate === undefined) {
          // Show what zones exist
          console.log(`   Available zones in price chart: ${Object.keys(priceDoc.zoneRates)}`);
          console.log(`   Destinations from ${originZone}: ${priceDoc.zoneRates[originZone] ? Object.keys(priceDoc.zoneRates[originZone]) : 'N/A'}`);
        }
      }
    }
    console.log('');
  }

  await mongoose.disconnect();
}

main().catch(console.error);
