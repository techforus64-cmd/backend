const xlsx = require('xlsx');
const fs = require('fs');

/**
 * SFC Transporter Seeder Script
 * Run this to generate the final transporter document and pincode serviceability list.
 */

// 1. BASE PRICING BY REGION
const BASE_RATES_PER_KG = {
    'South': 8.96,
    'West': 12.04,
    'North': 12.04,
    'East': 12.04,
    'NE/JK': 19.46
};

// 2. SURCHARGES & MINIMUMS
const CONFIG = {
    surcharges: {
        fuel: 0.20,
        idc: 0.05,
        caf: 0.00,
        gst: 0.18
        // total_formula: subtotal = base + fuel(20%) + idc(5%) -> then + 18% GST
    },
    minimums: {
        handling: { rate_per_kg: 3, min: 500 }, // Alternatively ₹1/kg minimum if that's preferred
        cft_min: 6,
        lr_min: 50,
        demurrage: 100 // per day
    }
};

// 3. REGION MATRIX (from screenshot)
const MATRIX_REGIONS = [
    'AMB', 'JAI', 'DEL', 'LKO', 'AMD', 'PNQ', 'BOM', 'NAG', 'IDR',
    'BLR', 'HYD', 'MAA', 'CJB', 'BBI', 'PAT', 'NJP', 'CCU', 'GAU'
];

const TRANSIT_MATRIX_DAYS = [
    [5, 6.5, 5, 6.5, 8, 8, 8, 8, 8, 9.25, 9.25, 9.5, 12, 10, 10, 13, 10, 12],
    [6, 5, 5, 6.5, 8, 8, 8, 8, 8, 9.25, 9.25, 9.5, 12, 10, 10, 13, 10, 12],
    [5, 5, 5, 6, 7.25, 7.5, 7.5, 7.5, 7.5, 9.75, 9.25, 9.75, 11, 11, 11, 15, 10, 14],
    [6, 5.5, 5, 6, 8, 8, 8, 8, 8, 10, 10, 12, 12, 13, 11.5, 11.5, 13, 10, 12],
    [9, 9, 8, 9, 5, 5, 5, 5, 5.5, 9.5, 9, 10, 11, 12, 11, 11, 11, 13],
    [9, 9, 8, 13, 14, 7, 6, 10, 9, 11, 10, 12, 12, 14, 15, 17, 16, 19],
    [12, 10, 8, 10, 10, 10, 10, 6, 8, 11, 8, 11, 13, 10, 11, 13, 12, 15],
    [11, 8, 8, 10, 8, 9, 9, 8, 6, 12, 9, 12, 13, 12, 12, 14, 14, 17],
    [12, 12, 7, 15, 13, 11, 11, 11, 13, 6, 9, 7, 7, 13, 16, 18, 16, 19],
    [12, 12, 10, 12, 11, 9, 9, 8, 9, 9, 6, 9, 10, 11, 13, 15, 13, 17],
    [10, 12, 10, 15, 14, 11, 12, 11, 13, 7, 9, 6, 8, 12, 16, 17, 15, 18],
    [10, 16, 10, 16, 14, 11, 12, 12, 13, 7, 10, 8, 6, 14, 18, 19, 17, 21],
    [12, 12, 11, 11, 14, 13, 13, 10, 12, 12, 11, 12, 14, 6, 10, 11, 8, 12],
    [9, 9, 8.28, 6, 11, 12, 12, 9, 10, 15, 12, 14, 16, 11, 9, 11, 12, 13],
    [11, 11, 8.28, 8, 13, 14, 14, 10, 11, 15, 12, 14, 16, 9, 6, 8, 9, 10],
    [13, 13, 10, 10, 15, 16, 16, 12, 13, 16, 14, 16, 18, 10, 8, 6, 9, 8],
    [14, 13, 8.28, 11, 15, 15, 15, 11, 13, 14, 12, 14, 16, 8, 9, 9, 6, 10],
    [14, 15, 12.06, 12, 17, 17, 17, 14, 15, 9, 15, 16, 19, 11, 10, 8, 9, 6]
];

// Helper to determine pricing zone from macro region
function getPricingZone(excelRegion, areaCode) {
    if (areaCode === 'GAU') return 'NE/JK'; // Explicitly override for Guwahati
    if (excelRegion.includes('NORTH')) return 'North';
    if (excelRegion.includes('WEST')) return 'West';
    if (excelRegion.includes('SOUTH')) return 'South';
    if (excelRegion.includes('EAST')) return 'East';
    return 'North'; // Fallback
}

async function processExcelData() {
    console.log("Reading BD Sheet from Pincode.xlsx...");
    const filePath = 'C:/Users/Abhudaya/Downloads/aeiou (5)-3/Pincode (1).xlsx';
    if (!fs.existsSync(filePath)) {
        console.error("File not found:", filePath);
        return;
    }

    const workbook = xlsx.readFile(filePath);
    const bdSheet = workbook.Sheets['BD'];
    const data = xlsx.utils.sheet_to_json(bdSheet);

    const pincodeMap = {};
    let odaCount = 0;

    data.forEach(row => {
        const pin = row['Pincode'];
        const area = row['Area'];
        const excelRegion = row['Region'];
        const edl = row['EDL'];

        if (pin && area && excelRegion) {
            const pricingZone = getPricingZone(excelRegion, area);
            const isOda = edl === 'Y';

            if (isOda) odaCount++;

            pincodeMap[pin] = {
                pin,
                area,
                region: pricingZone,
                isOda
            };
        }
    });

    console.log(`Total Pincodes Parsed: ${Object.keys(pincodeMap).length}`);
    console.log(`Total ODA Pincodes (EDL=Y): ${odaCount}`);

    const resultPayload = {
        name: "SFC Roadmap Transporter",
        base_rates: BASE_RATES_PER_KG,
        surcharges: CONFIG.surcharges,
        minimum_rules: CONFIG.minimums,
        transit_matrix: {
            regions: MATRIX_REGIONS,
            days: TRANSIT_MATRIX_DAYS
        },
        pincodes_serviceable: Object.values(pincodeMap)
    };

    fs.writeFileSync('C:/Users/Abhudaya/Downloads/aeiou (5)-3/sfc_transporter_config.json', JSON.stringify(resultPayload, null, 2));
    console.log("Configuration and Matrix successfully exported to sfc_transporter_config.json");
    console.log("Approach ready! Provide this structure to your UTSF hybrid syncing logic.");
}

processExcelData();
