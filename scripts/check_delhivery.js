/**
 * Check Delhivery Lite's service entry for 194103
 */

import mongoose from 'mongoose';

process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

const TEST_PINCODE = '194103';

async function main() {
  await mongoose.connect(process.env.MONGO_DB_URL);

  // Get Delhivery Lite full record
  const delhivery = await mongoose.connection.collection('transporters').findOne(
    { companyName: 'Delhivery Lite' }
  );

  console.log('Delhivery Lite record:');
  console.log(`  _id: ${delhivery._id}`);
  console.log(`  companyName: ${delhivery.companyName}`);
  console.log(`  approvalStatus: ${delhivery.approvalStatus}`);
  console.log(`  service array length: ${delhivery.service?.length || 0}`);

  // Find the specific pincode entry
  const pinEntry = (delhivery.service || []).find(s =>
    String(s.pincode) === TEST_PINCODE || s.pincode === parseInt(TEST_PINCODE)
  );

  console.log(`\n  Entry for ${TEST_PINCODE}:`);
  console.log(`  ${JSON.stringify(pinEntry, null, 4)}`);

  // Check if there are any filters being applied
  console.log('\n  Other relevant fields:');
  console.log(`  selectedZones: ${JSON.stringify(delhivery.selectedZones)}`);
  console.log(`  servicableZones: ${JSON.stringify(delhivery.servicableZones)}`);
  console.log(`  isVerified: ${delhivery.isVerified}`);

  await mongoose.disconnect();
}

main().catch(console.error);
