
import mongoose from 'mongoose';
import utsfService from '../services/utsfService.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock DB connection not strictly needed for utsfService if we load files directly
// But we need to ensure the service loads our specific test files

const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');
const UTSF_DIR = path.resolve(__dirname, '../data/utsf');

async function testStrictLogic() {
    console.log('--- STRICT MODE VALIDATION ---');

    // Reload service to pick up changes
    utsfService.reload(UTSF_DIR, PINCODES_PATH);

    // Grabs ID: 7ac9bcae3050e90f5d92eea0 (Should be STRICT)
    const grabs = utsfService.transporters.get('7ac9bcae3050e90f5d92eea0');

    if (!grabs) {
        console.error('CRITICAL: Grabs transporter not found in UTSF service');
        return;
    }

    console.log(`Transporter: ${grabs.companyName}`);
    console.log(`Integrity Mode: ${grabs._data.meta?.integrityMode}`);

    // Test Case 1: 800032 (Phantom Pincode - should be BLOCKED)
    const phantomPin = 800032;
    const isPhantomServed = grabs.isServiceable(phantomPin);
    console.log(`Pincode ${phantomPin} (Phantom): ${isPhantomServed ? 'SERVED ❌' : 'BLOCKED ✅'}`);

    // Test Case 2: 110026 (Valid Serviceable - should be SERVED)
    // Check raw data dummy: Grabs covers 110026? 
    // Wait, Grabs raw dummy had 110026 in the meta but raw file had 110020, 110025, 800001
    // Let's check 110020
    const validPin = 110020;
    const isValidServed = grabs.isServiceable(validPin);
    console.log(`Pincode ${validPin} (Valid): ${isValidServed ? 'SERVED ✅' : 'BLOCKED ❌'}`);

    // Test Case 3: Verify N1 zone status
    // N1 was listed as missing 458 pins in logs
    // 110001 is in N1. Is it in Grabs raw file? No.
    const n1Pin = 110001;
    const isN1Served = grabs.isServiceable(n1Pin);
    console.log(`Pincode ${n1Pin} (N1 - Not in Raw): ${isN1Served ? 'SERVED ❌' : 'BLOCKED ✅'}`);

}

testStrictLogic().catch(console.error);
