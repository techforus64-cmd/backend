/**
 * Zone Mismatch Report
 * Shows which pincodes in vendor service arrays have incorrect zones
 * compared to master pincodes.json
 */

import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.MONGO_DB_URL = 'mongodb+srv://ForusELectric:BadeDevs%409123@foruscluster.6guqi8k.mongodb.net/test';

async function main() {
  console.log('🔍 Zone Mismatch Report\n');

  await mongoose.connect(process.env.MONGO_DB_URL);
  console.log('✅ Connected to MongoDB\n');

  // Load master pincodes
  const masterPath = path.join(__dirname, '..', 'data', 'pincodes.json');
  const masterPincodes = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
  const masterMap = new Map(masterPincodes.map(p => [String(p.pincode), p]));
  console.log(`📋 Master pincodes: ${masterMap.size}\n`);

  // Load approved transporters
  const transporters = await mongoose.connection.collection('transporters')
    .find({ approvalStatus: 'approved' })
    .toArray();

  console.log(`📦 Checking ${transporters.length} approved transporters...\n`);

  const allMismatches = [];
  const summaryByVendor = [];

  for (const t of transporters) {
    const serviceArray = t.service || [];
    if (!serviceArray.length) continue;

    let correctCount = 0;
    let mismatchCount = 0;
    let notInMasterCount = 0;
    const vendorMismatches = [];

    for (const entry of serviceArray) {
      const pin = String(entry.pincode);
      const masterData = masterMap.get(pin);

      if (!masterData) {
        notInMasterCount++;
        continue;
      }

      const vendorZone = entry.zone;
      const masterZone = masterData.zone;

      if (vendorZone !== masterZone) {
        mismatchCount++;
        vendorMismatches.push({
          vendor: t.companyName,
          pincode: pin,
          vendorZone: vendorZone || 'null',
          masterZone: masterZone,
          city: masterData.city,
          state: masterData.state
        });
      } else {
        correctCount++;
      }
    }

    console.log(`${t.companyName}:`);
    console.log(`   Total: ${serviceArray.length} | Correct: ${correctCount} | Mismatch: ${mismatchCount} | Not in master: ${notInMasterCount}`);

    summaryByVendor.push({
      vendor: t.companyName,
      total: serviceArray.length,
      correct: correctCount,
      mismatch: mismatchCount,
      notInMaster: notInMasterCount,
      accuracy: ((correctCount / (correctCount + mismatchCount)) * 100).toFixed(1) + '%'
    });

    allMismatches.push(...vendorMismatches);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total zone mismatches: ${allMismatches.length}`);

  // Group by zone change pattern
  const patterns = {};
  for (const m of allMismatches) {
    const key = `${m.vendorZone} → ${m.masterZone}`;
    if (!patterns[key]) patterns[key] = { count: 0, samples: [] };
    patterns[key].count++;
    if (patterns[key].samples.length < 5) {
      patterns[key].samples.push(`${m.pincode} (${m.city})`);
    }
  }

  console.log('\n📋 Zone change patterns needed:');
  const sortedPatterns = Object.entries(patterns).sort((a, b) => b[1].count - a[1].count);
  for (const [pattern, data] of sortedPatterns) {
    console.log(`\n   ${pattern}: ${data.count} pincodes`);
    console.log(`      Examples: ${data.samples.join(', ')}`);
  }

  // Create Excel report
  console.log('\n📊 Creating Excel report...');
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Summary by Vendor
  const sheet1 = workbook.addWorksheet('Summary by Vendor');
  sheet1.columns = [
    { header: 'Vendor', key: 'vendor', width: 25 },
    { header: 'Total Pincodes', key: 'total', width: 15 },
    { header: 'Correct Zone', key: 'correct', width: 15 },
    { header: 'Mismatch Zone', key: 'mismatch', width: 15 },
    { header: 'Not in Master', key: 'notInMaster', width: 15 },
    { header: 'Accuracy', key: 'accuracy', width: 12 }
  ];
  sheet1.getRow(1).font = { bold: true };
  summaryByVendor.forEach(s => sheet1.addRow(s));

  // Sheet 2: All Mismatches
  const sheet2 = workbook.addWorksheet('All Mismatches');
  sheet2.columns = [
    { header: 'Vendor', key: 'vendor', width: 25 },
    { header: 'Pincode', key: 'pincode', width: 12 },
    { header: 'Vendor Zone', key: 'vendorZone', width: 12 },
    { header: 'Master Zone', key: 'masterZone', width: 12 },
    { header: 'City', key: 'city', width: 25 },
    { header: 'State', key: 'state', width: 20 }
  ];
  sheet2.getRow(1).font = { bold: true };
  allMismatches.forEach(m => sheet2.addRow(m));

  // Sheet 3: Zone Change Patterns
  const sheet3 = workbook.addWorksheet('Zone Change Patterns');
  sheet3.columns = [
    { header: 'From Zone', key: 'from', width: 12 },
    { header: 'To Zone', key: 'to', width: 12 },
    { header: 'Count', key: 'count', width: 10 },
    { header: 'Sample Pincodes', key: 'samples', width: 60 }
  ];
  sheet3.getRow(1).font = { bold: true };
  for (const [pattern, data] of sortedPatterns) {
    const [from, to] = pattern.split(' → ');
    sheet3.addRow({ from, to, count: data.count, samples: data.samples.join(', ') });
  }

  const outputPath = path.join(__dirname, 'zone_mismatch_report.xlsx');
  await workbook.xlsx.writeFile(outputPath);
  console.log(`✅ Report saved to: ${outputPath}`);

  // Also save JSON
  const jsonPath = path.join(__dirname, 'zone_mismatches.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalMismatches: allMismatches.length,
    summaryByVendor,
    patterns: sortedPatterns.map(([p, d]) => ({ pattern: p, count: d.count, samples: d.samples })),
    mismatches: allMismatches
  }, null, 2));
  console.log(`✅ JSON saved to: ${jsonPath}`);

  await mongoose.disconnect();
  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
