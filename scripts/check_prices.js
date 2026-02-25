/**
 * Check prices collection structure and vendor references
 */

import mongoose from 'mongoose';

process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

async function main() {
  await mongoose.connect(process.env.MONGO_DB_URL);

  // Check prices collection
  console.log('📦 Checking prices collection...\n');

  const pricesCount = await mongoose.connection.collection('prices').countDocuments();
  console.log(`Total price documents: ${pricesCount}\n`);

  // Get a sample price document
  const samplePrice = await mongoose.connection.collection('prices').findOne();
  console.log('Sample price document:');
  console.log(JSON.stringify(samplePrice, null, 2).slice(0, 2000));

  // Check what fields transporters have that might reference prices
  console.log('\n\n📦 Checking transporter fields for price references...\n');

  const transporter = await mongoose.connection.collection('transporters').findOne(
    { approvalStatus: 'approved' },
    { projection: { companyName: 1, priceId: 1, price: 1, priceChart: 1, pricing: 1, rates: 1 } }
  );
  console.log('Transporter fields:');
  console.log(JSON.stringify(transporter, null, 2));

  // Get all field names from a transporter
  const fullTransporter = await mongoose.connection.collection('transporters').findOne(
    { approvalStatus: 'approved' }
  );
  console.log('\nAll transporter fields:');
  console.log(Object.keys(fullTransporter || {}));

  // Check temp transporters
  const tempTransporter = await mongoose.connection.collection('temporarytransporters').findOne(
    { approvalStatus: 'approved' }
  );
  console.log('\nAll temp transporter fields:');
  console.log(Object.keys(tempTransporter || {}));

  // Check if price documents have vendor references
  const priceWithVendor = await mongoose.connection.collection('prices').findOne();
  console.log('\nAll price document fields:');
  console.log(Object.keys(priceWithVendor || {}));

  await mongoose.disconnect();
}

main().catch(console.error);
