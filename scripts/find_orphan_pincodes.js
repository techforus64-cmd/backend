/**
 * Find Orphan Pincodes Script
 * Finds pincodes that exist in vendor serviceability arrays
 * but are NOT present in master pincodes.json
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Direct config
process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

async function main() {
  console.log('🔍 Finding Orphan Pincodes...\n');

  // Connect to MongoDB
  await mongoose.connect(process.env.MONGO_DB_URL);
  console.log('✅ Connected to MongoDB\n');

  // Load master pincodes.json
  const pincodesPath = path.join(__dirname, '..', 'data', 'pincodes.json');
  const masterPincodes = JSON.parse(fs.readFileSync(pincodesPath, 'utf8'));
  const masterSet = new Set(masterPincodes.map(p => String(p.pincode)));
  console.log(`📋 Master pincodes.json: ${masterSet.size} pincodes\n`);

  // Query approved transporters
  console.log('📦 Fetching approved transporters...');
  const transporters = await mongoose.connection.collection('transporters')
    .find({ approvalStatus: 'approved' })
    .project({ service: 1, companyName: 1 })
    .toArray();
  console.log(`   Found ${transporters.length} approved transporters`);

  // Query approved temp transporters
  console.log('📦 Fetching approved temp transporters...');
  const tempTransporters = await mongoose.connection.collection('temporarytransporters')
    .find({ approvalStatus: 'approved' })
    .project({ serviceability: 1, companyName: 1 })
    .toArray();
  console.log(`   Found ${tempTransporters.length} approved temp transporters\n`);

  // Collect all vendor pincodes with their sources
  const vendorPincodeMap = new Map(); // pincode -> { vendors: [], count: number }

  // From transporters.service[]
  for (const t of transporters) {
    const serviceArray = t.service || [];
    for (const entry of serviceArray) {
      if (entry.pincode) {
        const pin = String(entry.pincode);
        if (!vendorPincodeMap.has(pin)) {
          vendorPincodeMap.set(pin, { vendors: [], count: 0 });
        }
        const data = vendorPincodeMap.get(pin);
        data.count++;
        if (!data.vendors.includes(t.companyName)) {
          data.vendors.push(t.companyName || 'Unknown Transporter');
        }
      }
    }
  }

  // From temporarytransporters.serviceability[]
  for (const t of tempTransporters) {
    const serviceArray = t.serviceability || [];
    for (const entry of serviceArray) {
      if (entry.pincode && entry.active !== false) {
        const pin = String(entry.pincode);
        if (!vendorPincodeMap.has(pin)) {
          vendorPincodeMap.set(pin, { vendors: [], count: 0 });
        }
        const data = vendorPincodeMap.get(pin);
        data.count++;
        if (!data.vendors.includes(t.companyName)) {
          data.vendors.push(t.companyName || 'Unknown TempTransporter');
        }
      }
    }
  }

  console.log(`📊 Total unique pincodes in vendor data: ${vendorPincodeMap.size}\n`);

  // Find orphans - pincodes in vendor data but NOT in master
  const orphanPincodes = [];
  for (const [pincode, data] of vendorPincodeMap) {
    if (!masterSet.has(pincode)) {
      orphanPincodes.push({
        pincode,
        vendorCount: data.vendors.length,
        vendors: data.vendors,
        totalOccurrences: data.count
      });
    }
  }

  // Sort by vendor count (most referenced first)
  orphanPincodes.sort((a, b) => b.vendorCount - a.vendorCount);

  console.log('='.repeat(60));
  console.log('📊 RESULTS');
  console.log('='.repeat(60));
  console.log(`Master pincodes.json: ${masterSet.size}`);
  console.log(`Vendor pincodes (unique): ${vendorPincodeMap.size}`);
  console.log(`Orphan pincodes (in vendors but NOT in master): ${orphanPincodes.length}`);
  console.log('='.repeat(60));

  // Save to JSON
  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      masterPincodesCount: masterSet.size,
      vendorPincodesCount: vendorPincodeMap.size,
      orphanPincodesCount: orphanPincodes.length
    },
    orphanPincodes
  };

  const outputPath = path.join(__dirname, 'orphan_pincodes.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ Saved to: ${outputPath}`);

  // Show top 20 orphans
  if (orphanPincodes.length > 0) {
    console.log('\n📋 Top 20 orphan pincodes (by vendor count):');
    orphanPincodes.slice(0, 20).forEach((o, i) => {
      console.log(`   ${i + 1}. ${o.pincode} - ${o.vendorCount} vendor(s): ${o.vendors.slice(0, 3).join(', ')}${o.vendors.length > 3 ? '...' : ''}`);
    });
  }

  await mongoose.disconnect();
  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
