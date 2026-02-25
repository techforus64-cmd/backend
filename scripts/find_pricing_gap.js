/**
 * Find Pricing Gap
 * Pincodes where vendors have it in serviceability BUT cannot actually quote a price
 * Because: no price chart OR missing zone combination
 *
 * Tests from origin 110020 (Delhi)
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

const ORIGIN_PINCODE = '110020';

async function main() {
  console.log('🔍 Finding Pricing Gap...\n');
  console.log(`Origin: ${ORIGIN_PINCODE}\n`);

  await mongoose.connect(process.env.MONGO_DB_URL);
  console.log('✅ Connected to MongoDB\n');

  // Load master pincodes
  const masterPath = path.join(__dirname, '..', 'data', 'pincodes.json');
  const masterPincodes = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
  const masterMap = new Map(masterPincodes.map(p => [String(p.pincode), p]));
  console.log(`📋 Master pincodes: ${masterMap.size}`);

  const originData = masterMap.get(ORIGIN_PINCODE);
  console.log(`📍 Origin: ${originData?.city}, ${originData?.state} (Zone: ${originData?.zone})\n`);

  // Load all approved transporters with service and priceChart
  console.log('📦 Loading vendors...');
  const transporters = await mongoose.connection.collection('transporters')
    .find({ approvalStatus: 'approved' })
    .project({ companyName: 1, service: 1, priceChart: 1 })
    .toArray();

  const tempTransporters = await mongoose.connection.collection('temporarytransporters')
    .find({ approvalStatus: 'approved' })
    .project({ companyName: 1, serviceability: 1, priceChart: 1 })
    .toArray();

  console.log(`   Transporters: ${transporters.length}`);
  console.log(`   Temp transporters: ${tempTransporters.length}\n`);

  // Build vendor data structure
  const vendors = [];

  for (const t of transporters) {
    const serviceMap = new Map();
    for (const s of (t.service || [])) {
      if (s.pincode) serviceMap.set(String(s.pincode), s);
    }
    vendors.push({
      name: t.companyName,
      type: 'transporter',
      serviceMap,
      priceChart: t.priceChart || null,
      hasOrigin: serviceMap.has(ORIGIN_PINCODE)
    });
  }

  for (const t of tempTransporters) {
    const serviceMap = new Map();
    for (const s of (t.serviceability || [])) {
      if (s.pincode && s.active !== false) serviceMap.set(String(s.pincode), s);
    }
    vendors.push({
      name: t.companyName,
      type: 'temp',
      serviceMap,
      priceChart: t.priceChart || null,
      hasOrigin: serviceMap.has(ORIGIN_PINCODE)
    });
  }

  // Filter to vendors that have origin pincode
  const vendorsWithOrigin = vendors.filter(v => v.hasOrigin);
  console.log(`📍 Vendors with origin ${ORIGIN_PINCODE}: ${vendorsWithOrigin.length}`);
  vendorsWithOrigin.forEach(v => console.log(`   - ${v.name} (priceChart: ${v.priceChart ? 'YES' : 'NO'})`));

  // Now check each master pincode
  console.log('\n🔄 Checking all master pincodes...\n');

  const pricingGap = []; // Pincodes with serviceability but no pricing
  const trulyUncovered = []; // Pincodes with NO vendor serviceability at all
  const covered = []; // Pincodes that can be priced

  let processed = 0;
  for (const [destPin, destData] of masterMap) {
    if (destPin === ORIGIN_PINCODE) continue; // Skip origin itself

    processed++;
    if (processed % 5000 === 0) {
      console.log(`   Processed ${processed}/${masterMap.size}...`);
    }

    let hasServiceability = false;
    let canBepriced = false;

    for (const vendor of vendorsWithOrigin) {
      // Check if vendor has destination pincode
      const destEntry = vendor.serviceMap.get(destPin);
      if (!destEntry) continue;

      hasServiceability = true;

      // Check if vendor can price this route
      if (!vendor.priceChart) continue;

      // Get zones
      const originEntry = vendor.serviceMap.get(ORIGIN_PINCODE);
      const originZone = originEntry?.zone || originData?.zone;
      const destZone = destEntry?.zone || destData?.zone;

      if (!originZone || !destZone) continue;

      // Check price chart
      const price = vendor.priceChart[originZone]?.[destZone];
      if (price !== undefined && price !== null) {
        canBepriced = true;
        break; // At least one vendor can price it
      }
    }

    if (!hasServiceability) {
      trulyUncovered.push({
        pincode: destPin,
        zone: destData?.zone,
        city: destData?.city,
        state: destData?.state
      });
    } else if (!canBepriced) {
      pricingGap.push({
        pincode: destPin,
        zone: destData?.zone,
        city: destData?.city,
        state: destData?.state
      });
    } else {
      covered.push(destPin);
    }
  }

  // Results
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTS (from origin ' + ORIGIN_PINCODE + ')');
  console.log('='.repeat(60));
  console.log(`Total master pincodes:    ${masterMap.size}`);
  console.log(`Truly uncovered:          ${trulyUncovered.length} (no vendor has it)`);
  console.log(`PRICING GAP:              ${pricingGap.length} (vendors have it, but can't price)`);
  console.log(`Actually covered:         ${covered.length} (can be priced)`);
  console.log('='.repeat(60));

  // Save pricing gap
  if (pricingGap.length > 0) {
    const outputPath = path.join(__dirname, 'pricing_gap.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      origin: ORIGIN_PINCODE,
      originZone: originData?.zone,
      count: pricingGap.length,
      pincodes: pricingGap
    }, null, 2));
    console.log(`\n✅ Pricing gap saved to: ${outputPath}`);

    console.log('\n📋 Sample pricing gap pincodes:');
    pricingGap.slice(0, 30).forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.pincode} - ${p.city}, ${p.state} (${p.zone})`);
    });
  }

  // Save truly uncovered
  if (trulyUncovered.length > 0) {
    const outputPath2 = path.join(__dirname, 'truly_uncovered.json');
    fs.writeFileSync(outputPath2, JSON.stringify({
      generatedAt: new Date().toISOString(),
      count: trulyUncovered.length,
      pincodes: trulyUncovered
    }, null, 2));
    console.log(`\n✅ Truly uncovered saved to: ${outputPath2}`);
  }

  await mongoose.disconnect();
  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
