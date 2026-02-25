/**
 * Verify specific pincode - where does it exist?
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

const TEST_PINCODE = '194103';

async function main() {
  console.log(`🔍 Verifying pincode: ${TEST_PINCODE}\n`);

  // 1. Check master pincodes.json
  const masterPath = path.join(__dirname, '..', 'data', 'pincodes.json');
  const masterPincodes = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
  const inMaster = masterPincodes.find(p => String(p.pincode) === TEST_PINCODE);
  console.log(`📋 In master pincodes.json: ${inMaster ? 'YES' : 'NO'}`);
  if (inMaster) console.log(`   Data: ${JSON.stringify(inMaster)}`);

  // 2. Check uncovered_pincodes.json
  const uncoveredPath = 'C:\\Users\\FORUS\\Downloads\\uncovered_pincodes.json';
  try {
    const uncoveredPincodes = JSON.parse(fs.readFileSync(uncoveredPath, 'utf8'));
    const inUncovered = uncoveredPincodes.includes(TEST_PINCODE) ||
                        uncoveredPincodes.includes(parseInt(TEST_PINCODE));
    console.log(`📋 In uncovered_pincodes.json: ${inUncovered ? 'YES' : 'NO'}`);
  } catch (e) {
    console.log(`⚠️ Could not load uncovered_pincodes.json`);
  }

  // 3. Check MongoDB
  await mongoose.connect(process.env.MONGO_DB_URL);
  console.log('\n📦 Checking MongoDB...');

  // Check transporters
  const transportersWithPin = await mongoose.connection.collection('transporters')
    .find({
      approvalStatus: 'approved',
      'service.pincode': { $in: [TEST_PINCODE, parseInt(TEST_PINCODE)] }
    })
    .project({ companyName: 1 })
    .toArray();

  console.log(`\n   Transporters with ${TEST_PINCODE} in service[]: ${transportersWithPin.length}`);
  transportersWithPin.forEach(t => console.log(`      - ${t.companyName}`));

  // Check temp transporters
  const tempWithPin = await mongoose.connection.collection('temporarytransporters')
    .find({
      approvalStatus: 'approved',
      'serviceability.pincode': { $in: [TEST_PINCODE, parseInt(TEST_PINCODE)] }
    })
    .project({ companyName: 1 })
    .toArray();

  console.log(`\n   Temp transporters with ${TEST_PINCODE} in serviceability[]: ${tempWithPin.length}`);
  tempWithPin.forEach(t => console.log(`      - ${t.companyName}`));

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`In master pincodes.json:     ${inMaster ? 'YES' : 'NO'}`);
  console.log(`In uncovered_pincodes.json:  Check above`);
  console.log(`In transporter service[]:    ${transportersWithPin.length > 0 ? 'YES' : 'NO'}`);
  console.log(`In temp serviceability[]:    ${tempWithPin.length > 0 ? 'YES' : 'NO'}`);

  if (inMaster && transportersWithPin.length === 0 && tempWithPin.length === 0) {
    console.log('\n⚠️ THIS PINCODE IS A GAP - should have been caught!');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
