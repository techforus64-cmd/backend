/**
 * Find Coverage Gap
 * Pincodes that are:
 * - In master pincodes.json
 * - NOT in uncovered_pincodes.json (weren't flagged)
 * - BUT have no vendors serving them in DB
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

async function main() {
  console.log('🔍 Finding Coverage Gap...\n');

  // Connect to MongoDB
  await mongoose.connect(process.env.MONGO_DB_URL);
  console.log('✅ Connected to MongoDB\n');

  // 1. Load master pincodes
  const masterPath = path.join(__dirname, '..', 'data', 'pincodes.json');
  const masterPincodes = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
  const masterSet = new Set(masterPincodes.map(p => String(p.pincode)));
  console.log(`📋 Master pincodes.json: ${masterSet.size}`);

  // 2. Load uncovered pincodes (already flagged)
  const uncoveredPath = 'C:\\Users\\FORUS\\Downloads\\uncovered_pincodes.json';
  let uncoveredSet = new Set();
  try {
    const uncoveredPincodes = JSON.parse(fs.readFileSync(uncoveredPath, 'utf8'));
    uncoveredSet = new Set(uncoveredPincodes.map(p => String(p)));
    console.log(`📋 Uncovered pincodes (already flagged): ${uncoveredSet.size}`);
  } catch (e) {
    console.log(`⚠️ Could not load uncovered_pincodes.json: ${e.message}`);
  }

  // 3. Get all pincodes covered by approved vendors
  console.log('\n📦 Fetching vendor coverage from DB...');

  // From transporters
  const transporters = await mongoose.connection.collection('transporters')
    .find({ approvalStatus: 'approved' })
    .project({ service: 1, companyName: 1 })
    .toArray();

  // From temp transporters
  const tempTransporters = await mongoose.connection.collection('temporarytransporters')
    .find({ approvalStatus: 'approved' })
    .project({ serviceability: 1, companyName: 1 })
    .toArray();

  console.log(`   Approved transporters: ${transporters.length}`);
  console.log(`   Approved temp transporters: ${tempTransporters.length}`);

  // Build set of all covered pincodes
  const coveredByVendors = new Set();

  for (const t of transporters) {
    for (const entry of (t.service || [])) {
      if (entry.pincode) {
        coveredByVendors.add(String(entry.pincode));
      }
    }
  }

  for (const t of tempTransporters) {
    for (const entry of (t.serviceability || [])) {
      if (entry.pincode && entry.active !== false) {
        coveredByVendors.add(String(entry.pincode));
      }
    }
  }

  console.log(`\n📊 Pincodes covered by vendors: ${coveredByVendors.size}`);

  // 4. Find the gap
  // Gap = Master - Uncovered - Covered
  const gap = [];
  for (const pin of masterSet) {
    if (!uncoveredSet.has(pin) && !coveredByVendors.has(pin)) {
      gap.push(pin);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTS');
  console.log('='.repeat(60));
  console.log(`Master pincodes:           ${masterSet.size}`);
  console.log(`Already flagged uncovered: ${uncoveredSet.size}`);
  console.log(`Covered by DB vendors:     ${coveredByVendors.size}`);
  console.log(`THE GAP (missed):          ${gap.length}`);
  console.log('='.repeat(60));

  if (gap.length > 0) {
    // Get metadata for gap pincodes
    const pincodeMap = new Map(masterPincodes.map(p => [String(p.pincode), p]));

    const gapWithMeta = gap.map(pin => {
      const meta = pincodeMap.get(pin) || {};
      return {
        pincode: pin,
        zone: meta.zone || 'UNKNOWN',
        city: meta.city || 'UNKNOWN',
        state: meta.state || 'UNKNOWN'
      };
    });

    // Save to file
    const outputPath = path.join(__dirname, 'coverage_gap.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      count: gap.length,
      pincodes: gapWithMeta
    }, null, 2));
    console.log(`\n✅ Saved to: ${outputPath}`);

    // Show sample
    console.log('\n📋 Sample of gap pincodes:');
    gapWithMeta.slice(0, 20).forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.pincode} - ${p.city}, ${p.state} (${p.zone})`);
    });
  } else {
    console.log('\n✅ No gap found - all pincodes are either covered or flagged uncovered!');
  }

  await mongoose.disconnect();
  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
