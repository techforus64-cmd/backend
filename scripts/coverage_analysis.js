/**
 * Coverage Analysis Script
 * Checks uncovered pincodes against Google Maps API and vendor coverage
 * Outputs Excel with two sections: "Unreachable by Road" and "No Vendors Serviceable"
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Direct config
process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';
process.env.GOOGLE_MAP_API_KEY = 'AIzaSyAqs3abXDKVZS8C_P13vs3axGLCQ3Ksbbk';

// Import distance service
import { calculateDistanceBetweenPincode } from '../utils/distanceService.js';

const ORIGIN = '110020';
const ORIGIN_ZONE = 'N1';
const BATCH_SIZE = 10; // Process in batches to avoid rate limiting
const DELAY_BETWEEN_BATCHES_MS = 1000; // 1 second between batches

async function main() {
  console.log('🚀 Starting Coverage Analysis...\n');

  // Connect to MongoDB
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGO_DB_URL);
  console.log('✅ Connected to MongoDB\n');

  // Load pincodes to check
  const uncoveredPath = 'C:\\Users\\FORUS\\Downloads\\uncovered_pincodes.json';
  const uncoveredPincodes = JSON.parse(fs.readFileSync(uncoveredPath, 'utf8'));
  console.log(`📋 Loaded ${uncoveredPincodes.length} pincodes to analyze\n`);

  // Load pincodes.json for city/state/zone data
  const pincodesData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'pincodes.json'), 'utf8'));
  const pincodeMap = new Map(pincodesData.map(p => [String(p.pincode), p]));
  console.log(`📋 Loaded ${pincodeMap.size} pincodes for metadata\n`);

  // Load vendor serviceability from MongoDB
  console.log('📦 Loading vendor serviceability...');
  const transporters = await mongoose.connection.collection('transporters')
    .find({ approvalStatus: 'approved' })
    .project({ service: 1, companyName: 1 })
    .toArray();

  const tempTransporters = await mongoose.connection.collection('temporarytransporters')
    .find({ approvalStatus: 'approved' })
    .project({ serviceability: 1, companyName: 1 })
    .toArray();

  // Build set of all serviceable pincodes (for quick lookup)
  const serviceablePincodes = new Set();

  // From transporters (public)
  transporters.forEach(t => {
    (t.service || []).forEach(s => {
      if (s.pincode) serviceablePincodes.add(String(s.pincode));
    });
  });

  // From temp transporters
  tempTransporters.forEach(t => {
    (t.serviceability || []).forEach(s => {
      if (s.pincode && s.active !== false) serviceablePincodes.add(String(s.pincode));
    });
  });

  console.log(`✅ Found ${serviceablePincodes.size} unique serviceable pincodes across all vendors\n`);

  // Check if origin is serviceable
  const originServiceable = serviceablePincodes.has(ORIGIN);
  console.log(`📍 Origin ${ORIGIN} serviceable: ${originServiceable}\n`);

  // Results arrays
  const unreachableByRoad = [];
  const noVendorsServiceable = [];

  // Process pincodes in batches
  const batches = [];
  for (let i = 0; i < uncoveredPincodes.length; i += BATCH_SIZE) {
    batches.push(uncoveredPincodes.slice(i, i + BATCH_SIZE));
  }

  console.log(`🔄 Processing ${batches.length} batches of ${BATCH_SIZE} pincodes each...\n`);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(`\n📦 Batch ${batchIndex + 1}/${batches.length} (${batch.length} pincodes)`);

    const batchPromises = batch.map(async (pincode) => {
      const pin = String(pincode);
      const metadata = pincodeMap.get(pin) || { zone: 'UNKNOWN', city: 'UNKNOWN', state: 'UNKNOWN' };

      try {
        // Call Google Maps via distance service
        const result = await calculateDistanceBetweenPincode(ORIGIN, pin);

        // Route exists - check vendor coverage
        const destinationServiceable = serviceablePincodes.has(pin);

        if (!destinationServiceable) {
          // Route exists but no vendors serve this pincode
          return {
            type: 'no_vendors',
            pincode: pin,
            zone: metadata.zone || 'UNKNOWN',
            city: metadata.city || 'UNKNOWN',
            state: metadata.state || 'UNKNOWN',
            distanceKm: result.distanceKm,
            estDays: result.estTime,
            reason: 'No vendor has this pincode in serviceability'
          };
        }

        // Both route and vendor exist - shouldn't be in uncovered list
        return {
          type: 'covered',
          pincode: pin,
          zone: metadata.zone,
          city: metadata.city,
          state: metadata.state,
          distanceKm: result.distanceKm,
          reason: 'Actually covered (should not be in uncovered list)'
        };

      } catch (error) {
        if (error.code === 'NO_ROAD_ROUTE') {
          // Google says no road route
          return {
            type: 'unreachable',
            pincode: pin,
            zone: metadata.zone || 'UNKNOWN',
            city: metadata.city || 'UNKNOWN',
            state: metadata.state || 'UNKNOWN',
            reason: 'Google Maps: No driving route found'
          };
        } else if (error.code === 'PINCODE_NOT_FOUND') {
          // Pincode not in centroids
          return {
            type: 'unreachable',
            pincode: pin,
            zone: metadata.zone || 'UNKNOWN',
            city: metadata.city || 'UNKNOWN',
            state: metadata.state || 'UNKNOWN',
            reason: `Pincode not found in centroids database`
          };
        } else {
          // Other error
          console.error(`  ❌ Error for ${pin}: ${error.message}`);
          return {
            type: 'error',
            pincode: pin,
            zone: metadata.zone || 'UNKNOWN',
            city: metadata.city || 'UNKNOWN',
            state: metadata.state || 'UNKNOWN',
            reason: error.message
          };
        }
      }
    });

    const batchResults = await Promise.all(batchPromises);

    // Categorize results
    for (const result of batchResults) {
      if (result.type === 'unreachable') {
        unreachableByRoad.push(result);
        console.log(`  🚫 ${result.pincode} - Unreachable: ${result.reason}`);
      } else if (result.type === 'no_vendors') {
        noVendorsServiceable.push(result);
        console.log(`  📭 ${result.pincode} - No vendors (${result.distanceKm} km)`);
      } else if (result.type === 'covered') {
        console.log(`  ✅ ${result.pincode} - Actually covered`);
      } else {
        console.log(`  ⚠️ ${result.pincode} - Error: ${result.reason}`);
      }
    }

    // Rate limit delay between batches
    if (batchIndex < batches.length - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  // Create Excel workbook
  console.log('\n📊 Creating Excel report...');
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Unreachable by Road
  const sheet1 = workbook.addWorksheet('Unreachable by Road');
  sheet1.columns = [
    { header: 'Pincode', key: 'pincode', width: 12 },
    { header: 'Zone', key: 'zone', width: 10 },
    { header: 'City', key: 'city', width: 25 },
    { header: 'State', key: 'state', width: 25 },
    { header: 'Reason', key: 'reason', width: 40 }
  ];

  // Style header
  sheet1.getRow(1).font = { bold: true };
  sheet1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF6B6B' } };

  unreachableByRoad.forEach(r => sheet1.addRow(r));
  console.log(`  📝 Sheet "Unreachable by Road": ${unreachableByRoad.length} pincodes`);

  // Sheet 2: No Vendors Serviceable
  const sheet2 = workbook.addWorksheet('No Vendors Serviceable');
  sheet2.columns = [
    { header: 'Pincode', key: 'pincode', width: 12 },
    { header: 'Zone', key: 'zone', width: 10 },
    { header: 'City', key: 'city', width: 25 },
    { header: 'State', key: 'state', width: 25 },
    { header: 'Distance (km)', key: 'distanceKm', width: 15 },
    { header: 'Est. Days', key: 'estDays', width: 12 },
    { header: 'Reason', key: 'reason', width: 40 }
  ];

  // Style header
  sheet2.getRow(1).font = { bold: true };
  sheet2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB3B' } };

  noVendorsServiceable.forEach(r => sheet2.addRow(r));
  console.log(`  📝 Sheet "No Vendors Serviceable": ${noVendorsServiceable.length} pincodes`);

  // Save Excel file
  const outputPath = path.join(__dirname, 'coverage_analysis_report.xlsx');
  await workbook.xlsx.writeFile(outputPath);
  console.log(`\n✅ Report saved to: ${outputPath}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total pincodes analyzed: ${uncoveredPincodes.length}`);
  console.log(`🚫 Unreachable by road: ${unreachableByRoad.length}`);
  console.log(`📭 No vendors serviceable: ${noVendorsServiceable.length}`);
  console.log('='.repeat(60));

  await mongoose.disconnect();
  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
