import { MongoClient } from 'mongodb';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const uri = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/';

async function main() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('test'); // default db

    // Find Delhivery Lite in temporaryTransporters
    console.log('\n=== SEARCHING temporaryTransporters for Delhivery ===');
    const tiedUp = await db.collection('temporarytransporters').find({
      companyName: { $regex: /delhivery/i }
    }).toArray();

    if (tiedUp.length > 0) {
      for (const t of tiedUp) {
        console.log(`\nCompany: ${t.companyName}`);
        console.log(`ID: ${t._id}`);
        console.log(`customerID: ${t.customerID}`);

        // Check serviceability for our pincodes
        const svc = t.serviceability || [];
        const has110020 = svc.find(s => String(s.pincode) === '110020');
        const has194103 = svc.find(s => String(s.pincode) === '194103');

        console.log(`\nServiceability count: ${svc.length}`);
        console.log(`Has 110020: ${has110020 ? JSON.stringify(has110020) : 'NO'}`);
        console.log(`Has 194103: ${has194103 ? JSON.stringify(has194103) : 'NO'}`);

        // Check priceChart zones
        const priceChart = t.prices?.priceChart || {};
        console.log(`\nPriceChart zones (outer keys): ${Object.keys(priceChart).join(', ')}`);

        // Get all inner zones
        const innerZones = new Set();
        for (const outerZone of Object.keys(priceChart)) {
          for (const innerZone of Object.keys(priceChart[outerZone] || {})) {
            innerZones.add(innerZone);
          }
        }
        console.log(`PriceChart zones (inner keys): ${[...innerZones].join(', ')}`);

        // Check if N1 -> X3 route exists
        const n1ToX3 = priceChart['N1']?.['X3'] ?? priceChart['X3']?.['N1'];
        console.log(`\nN1 -> X3 price exists: ${n1ToX3 !== undefined ? n1ToX3 : 'NO'}`);

        // Show selectedZones
        console.log(`\nselectedZones: ${JSON.stringify(t.selectedZones)}`);
      }
    } else {
      console.log('No Delhivery found in temporaryTransporters');
    }

    // Find Delhivery in transporters (public)
    console.log('\n=== SEARCHING transporters (public) for Delhivery ===');
    const publicVendors = await db.collection('transporters').find({
      companyName: { $regex: /delhivery/i }
    }).toArray();

    if (publicVendors.length > 0) {
      for (const t of publicVendors) {
        console.log(`\nCompany: ${t.companyName}`);
        console.log(`ID: ${t._id}`);

        // Check service for our pincodes
        const svc = t.service || [];
        const has110020 = svc.find(s => String(s.pincode) === '110020');
        const has194103 = svc.find(s => String(s.pincode) === '194103');

        console.log(`Service count: ${svc.length}`);
        console.log(`Has 110020: ${has110020 ? JSON.stringify(has110020) : 'NO'}`);
        console.log(`Has 194103: ${has194103 ? JSON.stringify(has194103) : 'NO'}`);

        // Get pricing from prices collection
        const priceData = await db.collection('prices').findOne({ companyId: t._id });
        if (priceData) {
          const zoneRates = priceData.zoneRates || {};
          console.log(`\nzoneRates outer keys: ${Object.keys(zoneRates).join(', ')}`);

          const innerZones = new Set();
          for (const outerZone of Object.keys(zoneRates)) {
            for (const innerZone of Object.keys(zoneRates[outerZone] || {})) {
              innerZones.add(innerZone);
            }
          }
          console.log(`zoneRates inner keys: ${[...innerZones].join(', ')}`);

          const n1ToX3 = zoneRates['N1']?.['X3'] ?? zoneRates['X3']?.['N1'];
          console.log(`N1 -> X3 price exists: ${n1ToX3 !== undefined ? n1ToX3 : 'NO'}`);
        } else {
          console.log('No pricing found in prices collection');
        }
      }
    } else {
      console.log('No Delhivery found in transporters');
    }

    // Show all unique zones in pincodes.json
    console.log('\n=== ZONES IN pincodes.json ===');
    const pincodes = require('./data/pincodes.json');
    const allZones = [...new Set(pincodes.map(p => p.zone))].sort();
    console.log(`All zones: ${allZones.join(', ')}`);
    console.log(`Total unique zones: ${allZones.length}`);

  } finally {
    await client.close();
  }
}

main().catch(console.error);
