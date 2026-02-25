/**
 * Find Pricing Gap v2
 * Uses correct prices collection lookup (companyId → transporter._id)
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

const ORIGIN_PINCODE = '110020';

async function main() {
  console.log('🔍 Finding Pricing Gap v2...\n');
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

  // Load all prices
  console.log('📦 Loading prices collection...');
  const allPrices = await mongoose.connection.collection('prices').find().toArray();
  const pricesByCompanyId = new Map();
  for (const p of allPrices) {
    pricesByCompanyId.set(String(p.companyId), p);
  }
  console.log(`   Found ${allPrices.length} price documents\n`);

  // Load approved transporters
  console.log('📦 Loading vendors...');
  const transporters = await mongoose.connection.collection('transporters')
    .find({ approvalStatus: 'approved' })
    .toArray();

  const tempTransporters = await mongoose.connection.collection('temporarytransporters')
    .find({ approvalStatus: 'approved' })
    .toArray();

  console.log(`   Transporters: ${transporters.length}`);
  console.log(`   Temp transporters: ${tempTransporters.length}\n`);

  // Build vendor data with prices
  const vendors = [];

  for (const t of transporters) {
    const serviceMap = new Map();
    for (const s of (t.service || [])) {
      if (s.pincode) serviceMap.set(String(s.pincode), s);
    }

    // Get price from prices collection using companyId
    const priceDoc = pricesByCompanyId.get(String(t._id));

    vendors.push({
      name: t.companyName,
      id: String(t._id),
      type: 'transporter',
      serviceMap,
      zoneRates: priceDoc?.zoneRates || null,
      hasOrigin: serviceMap.has(ORIGIN_PINCODE),
      hasPrice: !!priceDoc?.zoneRates
    });
  }

  for (const t of tempTransporters) {
    const serviceMap = new Map();
    for (const s of (t.serviceability || [])) {
      if (s.pincode && s.active !== false) serviceMap.set(String(s.pincode), s);
    }

    // Get price - temp transporters might have prices field as ObjectId
    let priceDoc = null;
    if (t.prices) {
      priceDoc = pricesByCompanyId.get(String(t.prices)) ||
                 await mongoose.connection.collection('prices').findOne({ _id: t.prices });
    }
    // Also try by companyId
    if (!priceDoc) {
      priceDoc = pricesByCompanyId.get(String(t._id));
    }

    vendors.push({
      name: t.companyName,
      id: String(t._id),
      type: 'temp',
      serviceMap,
      zoneRates: priceDoc?.zoneRates || null,
      hasOrigin: serviceMap.has(ORIGIN_PINCODE),
      hasPrice: !!priceDoc?.zoneRates
    });
  }

  // Show vendor pricing status
  console.log('📍 Vendors with origin ' + ORIGIN_PINCODE + ':');
  const vendorsWithOrigin = vendors.filter(v => v.hasOrigin);
  vendorsWithOrigin.forEach(v => {
    console.log(`   - ${v.name}: serviceability=YES, zoneRates=${v.hasPrice ? 'YES' : 'NO'}`);
  });

  // Count vendors with actual pricing
  const vendorsWithPricing = vendorsWithOrigin.filter(v => v.hasPrice);
  console.log(`\n   Vendors with BOTH origin & pricing: ${vendorsWithPricing.length}`);

  if (vendorsWithPricing.length === 0) {
    console.log('\n⚠️ NO vendors have pricing data! Cannot calculate coverage.');
    await mongoose.disconnect();
    return;
  }

  // Check coverage
  console.log('\n🔄 Checking all master pincodes...\n');

  const pricingGap = [];
  const trulyUncovered = [];
  const covered = [];

  let processed = 0;
  for (const [destPin, destData] of masterMap) {
    if (destPin === ORIGIN_PINCODE) continue;

    processed++;
    if (processed % 5000 === 0) {
      console.log(`   Processed ${processed}/${masterMap.size}...`);
    }

    let hasServiceability = false;
    let canBePriced = false;

    for (const vendor of vendorsWithPricing) {
      const destEntry = vendor.serviceMap.get(destPin);
      if (!destEntry) continue;

      hasServiceability = true;

      // Get zones
      const originEntry = vendor.serviceMap.get(ORIGIN_PINCODE);
      const originZone = originEntry?.zone || originData?.zone;
      const destZone = destEntry?.zone || destData?.zone;

      if (!originZone || !destZone) continue;

      // Check zone rates
      const price = vendor.zoneRates?.[originZone]?.[destZone];
      if (price !== undefined && price !== null) {
        canBePriced = true;
        break;
      }
    }

    // Also check vendors with serviceability but no pricing
    if (!hasServiceability) {
      for (const vendor of vendorsWithOrigin.filter(v => !v.hasPrice)) {
        if (vendor.serviceMap.has(destPin)) {
          hasServiceability = true;
          break;
        }
      }
    }

    if (!hasServiceability) {
      trulyUncovered.push({
        pincode: destPin,
        zone: destData?.zone,
        city: destData?.city,
        state: destData?.state
      });
    } else if (!canBePriced) {
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
  console.log(`PRICING GAP:              ${pricingGap.length} (vendors have it, can't price)`);
  console.log(`Actually covered:         ${covered.length} (can be priced)`);
  console.log('='.repeat(60));

  // Save results
  if (pricingGap.length > 0) {
    const outputPath = path.join(__dirname, 'pricing_gap.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      origin: ORIGIN_PINCODE,
      count: pricingGap.length,
      pincodes: pricingGap
    }, null, 2));
    console.log(`\n✅ Pricing gap saved to: ${outputPath}`);

    console.log('\n📋 Sample pricing gap pincodes:');
    pricingGap.slice(0, 20).forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.pincode} - ${p.city}, ${p.state} (${p.zone})`);
    });
  }

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
