/**
 * fix_safexpress_coverage.mjs
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  ⛔  DEPRECATED — DO NOT RUN THIS SCRIPT  ⛔                               ║
 * ║                                                                              ║
 * ║  THIS SCRIPT HAS THE SAME DATA CORRUPTION BUG AS fix_dbs_coverage.mjs.     ║
 * ║                                                                              ║
 * ║  ROOT CAUSE:                                                                 ║
 * ║    Reads from 'Pincode_B2B_Delhivery' (the master sheet) and treats          ║
 * ║    rate > 0 as serviceability confirmation. The master sheet has a non-zero  ║
 * ║    Safexpress rate for ALL 21,339 pincodes — meaning running this script      ║
 * ║    will mark Safexpress as serving every pincode in the database,            ║
 * ║    overriding the actual coverage data.                                       ║
 * ║                                                                              ║
 * ║  CORRECT SCRIPT TO USE:                                                      ║
 * ║    fix_serviceability_from_excel.mjs                                         ║
 * ║    — syncs servedCount metadata for Safexpress without inflating coverage     ║
 * ║                                                                              ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

console.error('');
console.error('╔══════════════════════════════════════════════════════════════════════════════╗');
console.error('║  ⛔  ABORTED — THIS SCRIPT IS DEPRECATED AND MUST NOT BE RUN  ⛔           ║');
console.error('║                                                                              ║');
console.error('║  Running this script WILL corrupt Safexpress serviceability data.           ║');
console.error('║  The master sheet has rates for ALL pincodes — this is not serviceability.  ║');
console.error('║                                                                              ║');
console.error('║  Use instead:  node backend/scripts/fix_serviceability_from_excel.mjs       ║');
console.error('╚══════════════════════════════════════════════════════════════════════════════╝');
console.error('');
process.exit(1);
