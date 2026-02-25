/**
 * Update Vendor Service Zones
 * Updates all service[] entry zones to match master pincodes.json
 *
 * DRY RUN by default - set DRY_RUN=false to actually update
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

// ⚠️ SET TO false TO ACTUALLY UPDATE
const DRY_RUN = true;

async function main() {
  console.log('🔄 Update Vendor Service Zones\n');
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '⚠️ LIVE UPDATE'}\n`);

  await mongoose.connect(process.env.MONGO_DB_URL);
  console.log('✅ Connected to MongoDB\n');

  // Load master pincodes
  const masterPath = path.join(__dirname, '..', 'data', 'pincodes.json');
  const masterPincodes = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
  const masterMap = new Map(masterPincodes.map(p => [String(p.pincode), p]));
  console.log(`📋 Master pincodes: ${masterMap.size}\n`);

  // Get all zones in master
  const masterZones = new Set(masterPincodes.map(p => p.zone));
  console.log(`📋 Master zones: ${[...masterZones].sort().join(', ')}\n`);

  // Load approved transporters
  const transporters = await mongoose.connection.collection('transporters')
    .find({ approvalStatus: 'approved' })
    .toArray();

  console.log(`📦 Processing ${transporters.length} approved transporters...\n`);

  let totalUpdated = 0;
  let totalUnchanged = 0;
  let totalNotInMaster = 0;
  const zoneChanges = {}; // Track zone change patterns

  for (const t of transporters) {
    const serviceArray = t.service || [];
    if (!serviceArray.length) {
      console.log(`   ${t.companyName}: No service array, skipping`);
      continue;
    }

    let updatedCount = 0;
    let unchangedCount = 0;
    let notInMasterCount = 0;
    const updatedService = [];

    for (const entry of serviceArray) {
      const pin = String(entry.pincode);
      const masterData = masterMap.get(pin);

      if (!masterData) {
        // Pincode not in master - keep as is
        updatedService.push(entry);
        notInMasterCount++;
        totalNotInMaster++;
        continue;
      }

      const currentZone = entry.zone;
      const masterZone = masterData.zone;

      if (currentZone !== masterZone) {
        // Zone needs update
        const changeKey = `${currentZone || 'null'} → ${masterZone}`;
        zoneChanges[changeKey] = (zoneChanges[changeKey] || 0) + 1;

        updatedService.push({
          ...entry,
          zone: masterZone
        });
        updatedCount++;
        totalUpdated++;
      } else {
        // Zone already correct
        updatedService.push(entry);
        unchangedCount++;
        totalUnchanged++;
      }
    }

    console.log(`   ${t.companyName}: ${updatedCount} updated, ${unchangedCount} unchanged, ${notInMasterCount} not in master`);

    // Update in MongoDB if not dry run and there are changes
    if (!DRY_RUN && updatedCount > 0) {
      await mongoose.connection.collection('transporters').updateOne(
        { _id: t._id },
        { $set: { service: updatedService } }
      );
      console.log(`      ✅ Saved to MongoDB`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total service entries updated: ${totalUpdated}`);
  console.log(`Total unchanged: ${totalUnchanged}`);
  console.log(`Total pincodes not in master: ${totalNotInMaster}`);
  console.log('='.repeat(60));

  // Zone change patterns
  if (Object.keys(zoneChanges).length > 0) {
    console.log('\n📋 Zone change patterns:');
    const sortedChanges = Object.entries(zoneChanges).sort((a, b) => b[1] - a[1]);
    sortedChanges.slice(0, 20).forEach(([change, count]) => {
      console.log(`   ${change}: ${count} pincodes`);
    });
    if (sortedChanges.length > 20) {
      console.log(`   ... and ${sortedChanges.length - 20} more patterns`);
    }
  }

  if (DRY_RUN) {
    console.log('\n⚠️ DRY RUN - No changes were made');
    console.log('   Set DRY_RUN = false in script to apply changes');
  } else {
    console.log('\n✅ All changes applied to MongoDB');
  }

  await mongoose.disconnect();
  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
