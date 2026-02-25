/**
 * fix_dbs_coverage.mjs
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  ⛔  DEPRECATED — DO NOT RUN THIS SCRIPT  ⛔                               ║
 * ║                                                                              ║
 * ║  THIS SCRIPT CAUSED A KNOWN DATA CORRUPTION BUG.                            ║
 * ║                                                                              ║
 * ║  ROOT CAUSE:                                                                 ║
 * ║    It reads from 'Pincode_B2B_Delhivery' — the MASTER sheet where EVERY     ║
 * ║    vendor has a non-zero rate for EVERY pincode (rates are just zone         ║
 * ║    lookups, not actual serviceability confirmations). Using rate > 0 as a    ║
 * ║    serviceability signal is WRONG and inflates DB Schenker's coverage with   ║
 * ║    ~1,600 extra pincodes it does NOT actually serve.                         ║
 * ║                                                                              ║
 * ║  WORST AFFECTED ZONE:                                                        ║
 * ║    NE2: inflated from 6 real pincodes → 839 fake pincodes.                  ║
 * ║    Example: pincode 798626 (Nagaland) appeared in DBS results despite        ║
 * ║    showing #N/A in the Excel — because this script added it.                 ║
 * ║                                                                              ║
 * ║  CORRECT SCRIPT TO USE:                                                      ║
 * ║    fix_serviceability_from_excel.mjs                                         ║
 * ║    — reads from 'Pincode_DBS' (the authoritative DBS coverage sheet)         ║
 * ║                                                                              ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

console.error('');
console.error('╔══════════════════════════════════════════════════════════════════════════════╗');
console.error('║  ⛔  ABORTED — THIS SCRIPT IS DEPRECATED AND MUST NOT BE RUN  ⛔           ║');
console.error('║                                                                              ║');
console.error('║  Running this script WILL corrupt DB Schenker serviceability data by        ║');
console.error('║  adding ~1,600 pincodes that DB Schenker does NOT actually serve.           ║');
console.error('║                                                                              ║');
console.error('║  Use instead:  node backend/scripts/fix_serviceability_from_excel.mjs       ║');
console.error('╚══════════════════════════════════════════════════════════════════════════════╝');
console.error('');
process.exit(1);
