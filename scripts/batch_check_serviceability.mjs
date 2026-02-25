/**
 * batch_check_serviceability.mjs
 * 
 * Batch processes serviceability checks from Excel file.
 * Run: node backend/scripts/batch_check_serviceability.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';

// Load utsfService (this will auto-boot the service)
import utsfService from '../services/utsfService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ORIGIN_PINCODE = 110020;
const WEIGHT_KG = 10;
const INVOICE_VALUE = 1000;
const INPUT_FILE = path.resolve(__dirname, '../../filtered_pincodes.xlsx');
const OUTPUT_FILE = path.resolve(__dirname, '../../batch_serviceability_results.csv');

// --- Helper to escape CSV fields ---
function escapeCsv(field) {
    if (field === null || field === undefined) return '';
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

async function runBatchCheck() {
    console.log('='.repeat(60));
    console.log('  Batch Serviceability Checker (UTSF Only)');
    console.log('='.repeat(60));
    console.log(`Origin: ${ORIGIN_PINCODE}`);
    console.log(`Input: ${INPUT_FILE}`);

    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`Error: Input file not found: ${INPUT_FILE}`);
        process.exit(1);
    }

    // Read Excel
    console.log('Reading Excel file...');
    const workbook = xlsx.readFile(INPUT_FILE);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
        console.error('Error: Excel file is empty or could not be parsed.');
        process.exit(1);
    }

    console.log(`Found ${data.length} rows.`);

    // Prepare CSV header
    const headers = [
        'Origin',
        'Destination',
        'Zone (Origin->Dest)',
        'Serviceable?',
        'Transporters Count',
        'Lowest Price (₹)',
        'Top Transporter',
        'All Transporters'
    ];

    let csvContent = headers.join(',') + '\n';
    let serviceableCount = 0;

    // Process rows
    console.log('Processing...');

    // Wait a moment for UTSF to load (it loads async on import in some cases, though typically sync fs calls)
    // The service uses synchronous fs calls so it should be ready immediately after import.
    // But let's verify.
    if (!utsfService.isLoaded) {
        // Force load if not loaded (though import should have triggered it)
        console.log('UTSF not loaded yet, forcing load...');
        const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
        const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');
        utsfService.loadAllUTSF(UTSF_DIR, PINCODES_PATH);
    }

    const startTime = Date.now();

    data.forEach((row, index) => {
        const destPincode = row.pincode || row.Pincode || row.PINCODE;

        if (!destPincode) {
            console.warn(`Row ${index + 1}: Skipping (no pincode found)`);
            return;
        }

        // Clean pincode
        const cleanDest = parseInt(destPincode, 10);
        if (isNaN(cleanDest)) {
            console.warn(`Row ${index + 1}: Invalid pincode "${destPincode}"`);
            return;
        }

        try {
            // Calculate prices using UTSF service
            const results = utsfService.calculatePricesForRoute(
                ORIGIN_PINCODE,
                cleanDest,
                WEIGHT_KG,
                INVOICE_VALUE
            );

            // Analyze results
            const isServiceable = results.length > 0;
            if (isServiceable) serviceableCount++;

            const count = results.length;
            const lowestPrice = isServiceable ? results[0].totalCharges : '';
            const topTransporter = isServiceable ? results[0].companyName : '';
            const allTransporters = results.map(r => `${r.companyName} (₹${r.totalCharges})`).join('; ');

            const resultZones = isServiceable ? results[0].zone : 'N/A'; // e.g. "N1 -> N2"

            // CSV Row
            const csvRow = [
                ORIGIN_PINCODE,
                cleanDest,
                escapeCsv(resultZones),
                isServiceable ? 'Yes' : 'No',
                count,
                lowestPrice,
                escapeCsv(topTransporter),
                escapeCsv(allTransporters)
            ];

            csvContent += csvRow.join(',') + '\n';

            if ((index + 1) % 100 === 0) {
                process.stdout.write(`Processed ${index + 1}/${data.length}...\r`);
            }

        } catch (err) {
            console.error(`Error processing ${destPincode}:`, err.message);
            csvContent += `${ORIGIN_PINCODE},${cleanDest},ERROR,No,0,,,\n`;
        }
    });

    console.log(`\nDone! Processed ${data.length} rows in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    console.log(`Serviceable: ${serviceableCount}/${data.length}`);

    // Write CSV
    console.log(`Writing output to ${OUTPUT_FILE}...`);
    fs.writeFileSync(OUTPUT_FILE, csvContent);
    console.log('Success.');
}

runBatchCheck();
