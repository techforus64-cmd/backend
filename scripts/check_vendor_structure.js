import mongoose from 'mongoose';

process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

async function main() {
  await mongoose.connect(process.env.MONGO_DB_URL);

  // Check a transporter's service entry structure
  const t = await mongoose.connection.collection('transporters').findOne(
    { approvalStatus: 'approved' },
    { projection: { service: { $slice: 3 }, companyName: 1 } }
  );
  console.log('Transporter service entry sample:');
  console.log(JSON.stringify(t?.service?.[0], null, 2));
  console.log('\nKeys:', Object.keys(t?.service?.[0] || {}));

  // Check temp transporter serviceability entry - find one that has data
  const tt = await mongoose.connection.collection('temporarytransporters').findOne(
    { approvalStatus: 'approved', 'serviceability.0': { $exists: true } },
    { projection: { serviceability: { $slice: 3 }, companyName: 1 } }
  );
  console.log('\nTemp transporter serviceability entry sample:');
  console.log(JSON.stringify(tt?.serviceability?.[0], null, 2));
  console.log('\nKeys:', Object.keys(tt?.serviceability?.[0] || {}));

  // Also check what fields exist across multiple vendors
  const allTransporters = await mongoose.connection.collection('transporters')
    .find({ approvalStatus: 'approved' })
    .project({ service: { $slice: 1 }, companyName: 1 })
    .toArray();

  console.log('\n--- All approved transporters service sample ---');
  for (const tr of allTransporters) {
    if (tr.service?.[0]) {
      console.log(`${tr.companyName}: ${JSON.stringify(tr.service[0])}`);
    }
  }

  await mongoose.disconnect();
}

main();
