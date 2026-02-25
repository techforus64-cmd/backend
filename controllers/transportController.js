import mongoose from "mongoose";
import customerModel from "../model/customerModel.js";
import priceModel from "../model/priceModel.js";
import temporaryTransporterModel from "../model/temporaryTransporterModel.js";
import transporterModel from "../model/transporterModel.js";
import PackingList from "../model/packingModel.js";
import BoxLibrary from "../model/boxLibraryModel.js";
import redisClient from "../utils/redisClient.js";
import { calculateDistanceBetweenPincode } from "../utils/distanceService.js";
import { zoneForPincode } from "../src/utils/pincodeZoneLookup.js";
import { validateShipmentDetails } from "../utils/chargeableWeightService.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dotenv from "dotenv";
import workerPool from "../services/worker-pool.service.js";
import utsfService from "../services/utsfService.js";
import { validateAllQuotes } from "../utils/smartShield.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
import {
  validateZoneMatrix,
  sanitizeZoneCodes,
  validateGSTIN,
  validateEmail,
  validatePhone,
  validatePincode,
  sanitizeString,
} from "../utils/validators.js";

// ============================================================================
// PERFORMANCE OPTIMIZATION: Pre-calculate volumetric weights for common kFactors
// This avoids recalculating the same values for each vendor in the loop
// ============================================================================
const COMMON_K_FACTORS = [4500, 5000, 5500, 6000];

/**
 * Pre-calculates volumetric weights for all common kFactors
 * @param {Array} shipment_details - Array of shipment items
 * @param {Object} legacyParams - Legacy single-box params {length, width, height, noofboxes}
 * @returns {Map<number, number>} Map of kFactor → volumetricWeight
 */
function preCalculateVolumetricWeights(shipment_details, legacyParams = {}) {
  const weights = new Map();
  const { length, width, height, noofboxes } = legacyParams;

  for (const kFactor of COMMON_K_FACTORS) {
    let volumetricWeight = 0;

    if (Array.isArray(shipment_details) && shipment_details.length > 0) {
      volumetricWeight = shipment_details.reduce((sum, item) => {
        const volWeightForItem =
          ((item.length || 0) *
            (item.width || 0) *
            (item.height || 0) *
            (item.count || 0)) /
          kFactor;
        return sum + Math.ceil(volWeightForItem);
      }, 0);
    } else if (length && width && height && noofboxes) {
      const volWeightForLegacy =
        ((length || 0) * (width || 0) * (height || 0) * (noofboxes || 0)) /
        kFactor;
      volumetricWeight = Math.ceil(volWeightForLegacy);
    }

    weights.set(kFactor, volumetricWeight);
  }

  return weights;
}

/**
 * Gets volumetric weight for a specific kFactor, using pre-calculated cache if available
 * @param {number} kFactor - The divisor for volumetric calculation
 * @param {Map} preCalculated - Pre-calculated weights map
 * @param {Array} shipment_details - Fallback shipment details
 * @param {Object} legacyParams - Fallback legacy params
 * @returns {number} The volumetric weight
 */
function getVolumetricWeight(kFactor, preCalculated, shipment_details, legacyParams = {}) {
  // Check if we have pre-calculated value
  if (preCalculated.has(kFactor)) {
    return preCalculated.get(kFactor);
  }

  // Calculate on-demand for non-standard kFactors
  const { length, width, height, noofboxes } = legacyParams;

  if (Array.isArray(shipment_details) && shipment_details.length > 0) {
    return shipment_details.reduce((sum, item) => {
      const volWeightForItem =
        ((item.length || 0) *
          (item.width || 0) *
          (item.height || 0) *
          (item.count || 0)) /
        kFactor;
      return sum + Math.ceil(volWeightForItem);
    }, 0);
  } else if (length && width && height && noofboxes) {
    const volWeightForLegacy =
      ((length || 0) * (width || 0) * (height || 0) * (noofboxes || 0)) /
      kFactor;
    return Math.ceil(volWeightForLegacy);
  }

  return 0;
}

// ============================================================================
// PERFORMANCE: Debug logging control - set to false in production
// To revert: change ENABLE_VENDOR_DEBUG_LOGGING to true
// ============================================================================
const ENABLE_VENDOR_DEBUG_LOGGING = process.env.NODE_ENV !== 'production' && process.env.DEBUG_VENDORS === 'true';

// ============================================================================
// PERFORMANCE: Redis cache settings for calculatePrice results
// Cache TTL: 5 minutes (prices can change, but not frequently)
// To disable caching: set ENABLE_RESULT_CACHING to false
// ============================================================================
const ENABLE_RESULT_CACHING = true;
const RESULT_CACHE_TTL_SECONDS = 300; // 5 minutes

/** Helper: robust access to zoneRates whether Map or plain object */
// helper: safe get unit price from various chart shapes and zone key cases
// STRICT: Only returns price if explicit origin→destination or destination→origin rate exists
function getUnitPriceFromPriceChart(priceChart, originZoneCode, destZoneCode) {
  if (!priceChart || !originZoneCode || !destZoneCode) return null;
  const o = String(originZoneCode).trim().toUpperCase();
  const d = String(destZoneCode).trim().toUpperCase();

  // STRATEGY 1: Direct lookup - priceChart[originZone][destZone] or priceChart[destZone][originZone]
  const direct =
    (priceChart[o] && priceChart[o][d]) ??
    (priceChart[d] && priceChart[d][o]);
  if (direct != null) {
    return Number(direct);
  }

  // STRATEGY 2: Case-insensitive search on top level keys
  const keys = Object.keys(priceChart || {});
  for (const k of keys) {
    if (String(k).trim().toUpperCase() === o) {
      const row = priceChart[k] || {};
      const val = row[d] ?? row[String(destZoneCode)];
      if (val != null) return Number(val);
    }
    if (String(k).trim().toUpperCase() === d) {
      const row = priceChart[k] || {};
      const val = row[o] ?? row[String(originZoneCode)];
      if (val != null) return Number(val);
    }
  }

  // No direct rate found - vendor does not have explicit pricing for this route
  return null;
}

export const deletePackingList = async (req, res) => {
  try {
    const presetId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(presetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid preset id",
      });
    }

    const preset = await PackingList.findById(presetId);

    if (!preset) {
      return res.status(404).json({
        success: false,
        message: "Preset not found",
      });
    }

    const authCustomerId = req.customer?._id?.toString();
    const presetCustomerId = preset.customerId?.toString();

    if (!req.customer?._id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (req.customer?.isAdmin !== true && authCustomerId !== presetCustomerId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    await preset.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Preset deleted successfully",
    });
  } catch (error) {
    console.error("[PackingList] deletePackingList failed", {
      presetId: req.params?.id,
      authCustomerId: req.customer?._id,
      error: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Server error while deleting preset.",
    });
  }
};

// -----------------------------
// Helpers for calculatePrice
// -----------------------------
function clampNumber(v, min, max) {
  let n = Number(v || 0);
  if (typeof min === "number" && Number.isFinite(min)) n = Math.max(n, min);
  if (typeof max === "number" && Number.isFinite(max)) n = Math.min(n, max);
  return Math.round(n); // return rupee-rounded integer
}
/**
 * ✅ NEW HELPER: Calculate invoice value based charges
 * Logic: MAX( (InvoiceValue * Percentage / 100), MinimumAmount )
 */

/**
 * Compute the total of all custom/carrier-specific surcharges.
 * Formula types:
 *   PCT_OF_BASE      – (value/100) × baseFreight
 *   PCT_OF_SUBTOTAL  – (value/100) × standardSubtotal
 *   FLAT             – fixed ₹ per shipment
 *   PER_KG           – value × chargeableWeight
 *   MAX_FLAT_PKG     – max(value, value2 × chargeableWeight)
 */
function computeCustomSurcharges(surcharges, baseFreight, chargeableWeight, standardSubtotal) {
  if (!surcharges || !surcharges.length) return 0;
  return surcharges
    .filter(s => s && s.enabled !== false)
    .sort((a, b) => (a.order || 99) - (b.order || 99))
    .reduce((acc, s) => {
      const v  = Number(s.value)  || 0;
      const v2 = Number(s.value2) || 0;
      switch (s.formula) {
        case 'PCT_OF_BASE':     return acc + (v / 100) * baseFreight;
        case 'PCT_OF_SUBTOTAL': return acc + (v / 100) * standardSubtotal;
        case 'FLAT':            return acc + v;
        case 'PER_KG':          return acc + v * chargeableWeight;
        case 'MAX_FLAT_PKG':    return acc + Math.max(v, v2 * chargeableWeight);
        default:                return acc;
      }
    }, 0);
}

function calculateInvoiceValueCharge(invoiceValue, invoiceValueCharges) {
  // If not enabled or no invoice value, return 0
  if (!invoiceValueCharges?.enabled || !invoiceValue || invoiceValue <= 0) {
    return 0;
  }

  const { percentage, minimumAmount } = invoiceValueCharges;

  // Calculate percentage-based charge
  const percentageCharge = (invoiceValue * (percentage || 0)) / 100;

  // Return MAX of percentage charge or minimum amount
  const finalCharge = Math.max(percentageCharge, minimumAmount || 0);

  return Math.round(finalCharge); // Return rounded rupee amount
}
/**
 * applyInvoiceRule(ruleObject, invoiceValue, ctx)
 * - ruleObject: a small JSON DSL object stored on vendor/price doc (see examples below)
 * - invoiceValue: numeric invoice value (rupees)
 * - ctx: { mode, totalWeight, distance, chargeableWeight, etc. }
 *
 * Supported rule types: "percentage", "flat", "per_unit", "slab", "conditional", "composite"
 * This is purposely conservative and avoids eval() / insecure operations.
 */
function applyInvoiceRule(rule, invoiceValue, ctx = {}) {
  if (!rule) return 0;
  try {
    const type = (rule.type || "").toString().toLowerCase();
    switch (type) {
      case "percentage": {
        const pct = Number(rule.percent || rule.percentage || 0);
        const raw = invoiceValue * (pct / 100);
        return clampNumber(raw, rule.min, rule.max);
      }
      case "flat": {
        return clampNumber(Number(rule.amount || 0), rule.min, rule.max);
      }
      case "per_unit": {
        const unit = Number(rule.unit || rule.unitAmount || 1);
        const amt = Number(rule.amount_per_unit || rule.amount || 0);
        if (unit <= 0) return 0;
        // default: round up units
        const units = rule.round_up
          ? Math.ceil(invoiceValue / unit)
          : Math.floor(invoiceValue / unit);
        const raw = units * amt;
        return clampNumber(raw, rule.min, rule.max);
      }
      case "slab": {
        const slabs = Array.isArray(rule.slabs) ? rule.slabs : [];
        const found = slabs.find((s) => {
          const min = s.min ?? -Infinity;
          const max = s.max ?? Infinity;
          return invoiceValue >= min && invoiceValue <= max;
        });
        if (!found) return 0;
        const pct = Number(found.percent || 0);
        const raw = invoiceValue * (pct / 100);
        return clampNumber(raw, rule.min ?? found.min, rule.max ?? found.max);
      }
      case "conditional": {
        const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
        for (const c of conds) {
          let ok = true;
          const checks = c.if || {};
          for (const k of Object.keys(checks)) {
            if (ctx[k] == null) {
              ok = false;
              break;
            }
            if (String(ctx[k]) !== String(checks[k])) {
              ok = false;
              break;
            }
          }
          if (ok) return applyInvoiceRule(c.rule, invoiceValue, ctx);
        }
        return applyInvoiceRule(rule.default, invoiceValue, ctx);
      }
      case "composite": {
        const parts = Array.isArray(rule.parts) ? rule.parts : [];
        let total = 0;
        for (const p of parts) total += applyInvoiceRule(p, invoiceValue, ctx);
        return clampNumber(total, rule.min, rule.max);
      }
      default:
        return 0;
    }
  } catch (e) {
    console.warn("applyInvoiceRule error:", e?.message || e);
    return 0;
  }
}

// ============================================================================
// PERFORMANCE: Batch Parallel Processing Helper
// Process items in batches to achieve true parallelization without worker threads
// ============================================================================

/**
 * Process array items in batches with Promise.allSettled
 * @param {Array} items - Items to process
 * @param {Function} processFn - Async function to process each item
 * @param {number} batchSize - Number of items per batch (default: 8 for optimal performance)
 * @returns {Promise<Array>} Processed results (nulls filtered out)
 */
async function processBatched(items, processFn, batchSize = 8) {
  if (!items || items.length === 0) return [];

  const allResults = [];

  // Split into batches
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    // Process batch in TRULY parallel with Promise.allSettled (handles errors gracefully)
    const batchResults = await Promise.allSettled(
      batch.map(item => processFn(item))
    );

    // Extract successful results
    const successfulResults = batchResults
      .filter(r => r.status === 'fulfilled' && r.value !== null && r.value !== undefined)
      .map(r => r.value);

    allResults.push(...successfulResults);

    // Yield to event loop between batches (prevents blocking)
    if (i + batchSize < items.length) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  return allResults;
}

// -----------------------------
// Replace your existing calculatePrice with this entire block
// -----------------------------
// -----------------------------
// Replace your existing calculatePrice with this entire block
// -----------------------------
export const calculatePrice = async (req, res) => {
  try {
    // PERFORMANCE: Minimal logging in hot path
    const startTime = Date.now();
    const {
      customerID,
      userogpincode,
      modeoftransport,
      fromPincode,
      toPincode,
      noofboxes,
      length,
      width,
      height,
      weight,
      shipment_details,
      invoiceValue: invoiceValueRaw, // NEW: invoiceValue from FE
    } = req.body;

    const INVOICE_MIN = 1;
    const INVOICE_MAX = 100_000_000; // configurable upper bound

    const rid = req.id || "no-reqid";

    // =========================================================================
    // PERFORMANCE: Redis cache settings for calculatePrice results
    // Cache TTL: 5 minutes (prices can change, but not frequently)
    // To disable: set ENABLE_RESULT_CACHING to false at top of file
    // =========================================================================
    // 🔴 FORCED DISABLE FOR DEBUGGING
    const ENABLE_RESULT_CACHING = false;
    const RESULT_CACHE_TTL_SECONDS = 300;

    let cacheKey = null;
    if (ENABLE_RESULT_CACHING && redisClient.isReady) {
      try {
        // Build deterministic cache key from request parameters
        const shipmentHash = JSON.stringify(shipment_details || [{ noofboxes, length, width, height, weight }]);
        cacheKey = `calc:${customerID}:${fromPincode}:${toPincode}:${modeoftransport}:${invoiceValueRaw || 0}:${shipmentHash}`;

        const cachedResult = await redisClient.get(cacheKey);
        if (cachedResult) {
          console.log(`[${rid}] ⚡ CACHE HIT - returning cached result (saved ~2000ms)`);
          const parsed = JSON.parse(cachedResult);
          // Add cache indicator to debug info
          parsed.debug = { ...parsed.debug, fromCache: true, cacheKey };
          return res.status(200).json(parsed);
        }
      } catch (cacheErr) {
        // Cache error should not block calculation - just log and continue
        console.warn(`[${rid}] Cache read error (continuing without cache):`, cacheErr.message);
      }
    }

    // Validate invoiceValue - allow missing/empty values (default to 1)
    let invoiceValue = INVOICE_MIN; // Default value
    if (invoiceValueRaw !== undefined && invoiceValueRaw !== null && invoiceValueRaw !== '') {
      const parsedInvoice = Number(invoiceValueRaw);
      if (!Number.isFinite(parsedInvoice) || parsedInvoice < INVOICE_MIN || parsedInvoice > INVOICE_MAX) {
        // DEBUG LOG REMOVED
        invoiceValue = INVOICE_MIN;
      } else {
        invoiceValue = parsedInvoice;
      }
    }
    // DEBUG LOG REMOVED
    let actualWeight;
    if (Array.isArray(shipment_details) && shipment_details.length > 0) {
      actualWeight = shipment_details.reduce(
        (sum, b) => sum + (b.weight || 0) * (b.count || 0),
        0
      );
    } else {
      actualWeight = (weight || 0) * (noofboxes || 0);
    }

    const hasLegacy =
      noofboxes !== undefined &&
      length !== undefined &&
      width !== undefined &&
      height !== undefined &&
      weight !== undefined;

    if (
      !customerID ||
      !userogpincode ||
      !modeoftransport ||
      !fromPincode ||
      !toPincode ||
      (!(Array.isArray(shipment_details) && shipment_details.length > 0) &&
        !hasLegacy)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields. Provide shipment_details or legacy weight/box parameters.",
      });
    }

    // DIMENSION VALIDATION: Reject zero/negative dimensions to prevent volumetric bypass
    // This prevents undercharging for bulky but light items
    if (Array.isArray(shipment_details) && shipment_details.length > 0) {
      const validation = validateShipmentDetails(shipment_details);
      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          message: `Invalid shipment details: ${validation.error}`,
          error: 'INVALID_DIMENSIONS',
        });
      }
    } else if (hasLegacy) {
      // Validate legacy parameters
      if (length <= 0 || width <= 0 || height <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Dimensions (length, width, height) must be positive numbers',
          error: 'INVALID_DIMENSIONS',
        });
      }
      if (weight < 0) {
        return res.status(400).json({
          success: false,
          message: 'Weight must be a non-negative number',
          error: 'INVALID_WEIGHT',
        });
      }
      if (noofboxes <= 0 || !Number.isInteger(noofboxes)) {
        return res.status(400).json({
          success: false,
          message: 'Number of boxes must be a positive integer',
          error: 'INVALID_BOX_COUNT',
        });
      }
    }

    // Calculate distance using Google Maps API (throws error if no route)
    let distData;
    try {
      distData = await calculateDistanceBetweenPincode(fromPincode, toPincode);
    } catch (error) {
      // Handle NO_ROAD_ROUTE error
      if (error.code === 'NO_ROAD_ROUTE') {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'NO_ROAD_ROUTE',
          fromPincode,
          toPincode
        });
      }
      // Handle PINCODE_NOT_FOUND error
      if (error.code === 'PINCODE_NOT_FOUND') {
        return res.status(400).json({
          success: false,
          message: error.message,
          error: 'PINCODE_NOT_FOUND',
          field: error.field
        });
      }
      // Handle API errors
      if (error.code === 'API_KEY_MISSING' || error.code === 'GOOGLE_API_ERROR' || error.code === 'API_TIMEOUT') {
        return res.status(500).json({
          success: false,
          message: 'Distance calculation service unavailable. Please try again.',
          error: error.code
        });
      }
      // Generic error
      console.error('Distance calculation error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to calculate distance',
        error: 'CALCULATION_FAILED'
      });
    }

    const estTime = distData.estTime;
    const dist = distData.distance;

    // canonical values for DB vs lookups
    const fromPinNum = Number(fromPincode);
    const toPinNum = Number(toPincode);
    const fromPinStr = String(fromPincode).trim();
    const toPinStr = String(toPincode).trim();

    // Validate customerID format before DB queries to prevent CastError
    if (!mongoose.Types.ObjectId.isValid(customerID)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer ID format.",
      });
    }

    try {
      // PERFORMANCE: Run all 3 DB queries in PARALLEL instead of sequential
      console.time(`[${rid}] DB_PARALLEL`);
      const [tiedUpCompanies, customerData, transporterData] = await Promise.all([
        // Query 1: Tied-up companies - OPTIMIZED: Only fetch the 2 pincodes we need from serviceability
        // This reduces data from potentially 30,000+ entries per vendor to just 2
        temporaryTransporterModel.aggregate([
          {
            $match: {
              // REMOVED customerID filter - show all vendors to all users (public marketplace)
              $or: [
                { approvalStatus: "approved" },
                { approvalStatus: { $exists: false } }
              ],
              // Filter out test/dummy transporters
              companyName: {
                $not: {
                  $regex: /test|tester|dummy|vellore/i
                }
              }
            }
          },
          {
            $project: {
              customerID: 1,
              companyName: 1,
              prices: 1,
              selectedZones: 1,
              zoneConfig: 1,
              invoiceValueCharges: 1,
              approvalStatus: 1,
              isVerified: 1,
              rating: 1,
              vendorRatings: 1,
              totalRatings: 1,
              // CRITICAL OPTIMIZATION: Only fetch the 2 pincodes we need
              serviceability: {
                $filter: {
                  input: { $ifNull: ["$serviceability", []] },
                  as: "s",
                  cond: { $in: ["$$s.pincode", [fromPinStr, toPinStr]] }
                }
              }
            }
          }
        ]).option({ maxTimeMS: 20000 }),

        // Query 2: Customer data
        customerModel
          .findById(customerID)
          .select("isSubscribed")
          .lean()
          .maxTimeMS(15000),

        // Query 3: Public transporters - OPTIMIZED: Only fetch the 2 pincodes we need from service array
        transporterModel.aggregate([
          {
            $match: {
              companyName: {
                $not: {
                  $regex: /test|tester|dummy|vellore/i
                }
              }
            }
          },
          {
            $project: {
              companyName: 1,
              phone: 1,
              email: 1,
              rating: 1,
              vendorRatings: 1,
              totalRatings: 1,
              isVerified: 1,
              approvalStatus: 1,
              // CRITICAL: Only fetch the 2 pincodes we need from service array
              service: {
                $filter: {
                  input: { $ifNull: ["$service", []] },
                  as: "s",
                  cond: { $in: ["$$s.pincode", [fromPinNum, toPinNum, fromPinStr, toPinStr]] }
                }
              }
            }
          }
        ]).option({ maxTimeMS: 15000 })
      ]);
      console.timeEnd(`[${rid}] DB_PARALLEL`);

      if (!customerData) {
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      }

      // 🔓 Subscription Gating Disabled: All users receive full vendor details
      const isSubscribed = true; // previously: !!customerData.isSubscribed;
      // Zone lookup (fast - uses in-memory map)
      const fromZoneRaw = zoneForPincode(fromPinStr);
      const toZoneRaw = zoneForPincode(toPinStr);
      const fromZone = fromZoneRaw ? String(fromZoneRaw).trim().toUpperCase() : null;
      const toZone = toZoneRaw ? String(toZoneRaw).trim().toUpperCase() : null;

      if (!fromZone || !toZone) {
        return res.status(400).json({
          success: false,
          message: "Invalid pincodes - could not determine zones",
        });
      }

      let l1 = Number.MAX_SAFE_INTEGER;

      // ===== PERFORMANCE: Pre-build serviceability Maps ONCE (not per vendor) =====
      console.time(`[${rid}] PREBUILD_SERVICEABILITY_MAPS`);
      const serviceabilityMaps = new Map(
        tiedUpCompanies.map(tuc => {
          if (!Array.isArray(tuc.serviceability) || tuc.serviceability.length === 0) {
            return [tuc._id, null];
          }

          // Build pincode → entry Map for O(1) lookup instead of O(n) find()
          const pincodeMap = new Map();
          for (const entry of tuc.serviceability) {
            if (entry.active !== false) {
              pincodeMap.set(String(entry.pincode), entry);
            }
          }
          return [tuc._id, pincodeMap];
        })
      );
      console.timeEnd(`[${rid}] PREBUILD_SERVICEABILITY_MAPS`);

      // ===== PERFORMANCE: Pre-calculate volumetric weights for common kFactors =====
      // This avoids recalculating the same values 50-100 times in vendor loops
      const preCalcVolumetricWeights = preCalculateVolumetricWeights(
        shipment_details,
        { length, width, height, noofboxes }
      );

      // Tied-up companies (customer-specific vendors)
      console.time(`[${rid}] BUILD tiedUpResult`);
      const tiedUpRaw = await Promise.all(
        tiedUpCompanies.map(async (tuc) => {
          try {
            const companyName = tuc.companyName;
            if (!companyName) return null;

            const priceChart = tuc.prices?.priceChart;
            if (!priceChart || !Object.keys(priceChart).length) return null;

            // use already-normalised zones
            const originZone = fromZone;
            const destZone = toZone;
            if (!originZone || !destZone) return null;

            // ============================================================
            // PERFORMANCE: Use pre-built Map for O(1) pincode lookup
            // ============================================================
            const pincodeMap = serviceabilityMaps.get(tuc._id);

            let effectiveOriginZone = originZone;
            let effectiveDestZone = destZone;
            let destIsOda = false;

            if (pincodeMap) {
              // O(1) Map lookup instead of O(n) find()
              const originEntry = pincodeMap.get(fromPinStr);
              const destEntry = pincodeMap.get(toPinStr);

              // Check if both pincodes are serviceable
              if (!originEntry || !destEntry) {
                return null;
              }

              // Use the zones from serviceability
              effectiveOriginZone = originEntry.zone?.toUpperCase() || originZone;
              effectiveDestZone = destEntry.zone?.toUpperCase() || destZone;
              destIsOda = !!(destEntry.isOda || destEntry.isODA);
            } else {
              // ============================================================
              // LEGACY FALLBACK DISABLED (2026-01-30)
              // Reason: All real vendors use explicit serviceability arrays.
              //          Zone-only fallback was only used by test accounts.
              // EXCEPTION: FALLBACK_VENDORS (Wheelsyee, Local FTL) are
              //            zone-only FTL providers — let them through.
              // ============================================================
              const nameLower = (companyName || '').toLowerCase();
              const isFallbackVendor = ['wheelseye', 'local ftl', 'ftl transporter', 'local-ftl']
                .some(fv => nameLower.includes(fv));
              if (!isFallbackVendor) {
                return null; // No serviceability = no coverage (except fallback vendors)
              }
              // Fallback vendor: use master zone-only matching (no serviceability check)
            }

            // Get unit price using effective zones (from serviceability or fallback)
            let unitPrice = getUnitPriceFromPriceChart(
              priceChart,
              effectiveOriginZone,
              effectiveDestZone
            );
            if (unitPrice == null) {
              // No price for this route - skip silently for performance
              return null;
            }

            const pr = tuc.prices.priceRate || {};

            // 🔍 DEBUG: Log vendor pricing data for any vendor with "jan" in name (case insensitive)
            // PERFORMANCE: Only log when ENABLE_VENDOR_DEBUG_LOGGING is true (disabled in production)
            if (ENABLE_VENDOR_DEBUG_LOGGING && tuc.companyName && tuc.companyName.toLowerCase().includes('jan')) {
              console.log('🔍 [DEBUG ADD JAN] =====================================');
              console.log(`🔍 [DEBUG] Vendor: "${tuc.companyName}" (_id: ${tuc._id})`);
              console.log(`🔍 [DEBUG] Route: ${effectiveOriginZone} → ${effectiveDestZone}`);
              console.log(`🔍 [DEBUG] unitPrice from priceChart: ₹${unitPrice}/kg`);
              console.log(`🔍 [DEBUG] priceChart content:`, JSON.stringify(tuc.prices?.priceChart));
              console.log(`🔍 [DEBUG] priceRate.docketCharges: ₹${pr.docketCharges}`);
              console.log(`🔍 [DEBUG] priceRate.fuel: ${pr.fuel}%`);
              console.log(`🔍 [DEBUG] priceRate.greenTax: ₹${pr.greenTax}`);
              console.log(`🔍 [DEBUG] priceRate.daccCharges: ₹${pr.daccCharges}`);
              console.log(`🔍 [DEBUG] priceRate.miscellanousCharges: ₹${pr.miscellanousCharges}`);
              console.log(`🔍 [DEBUG] priceRate.minCharges: ₹${pr.minCharges}`);
              console.log(`🔍 [DEBUG] priceRate.rovCharges:`, pr.rovCharges);
              console.log(`🔍 [DEBUG] priceRate.handlingCharges:`, pr.handlingCharges);
              console.log(`🔍 [DEBUG] priceRate.appointmentCharges:`, pr.appointmentCharges);
              console.log(`🔍 [DEBUG] priceRate.divisor/kFactor: ${pr.divisor ?? pr.kFactor ?? 'default 5000'}`);
              console.log('🔍 [DEBUG ADD JAN] =====================================');
            }
            const kFactor = pr.kFactor ?? pr.divisor ?? 5000;

            // PERFORMANCE: Use pre-calculated volumetric weight instead of recalculating
            const volumetricWeight = getVolumetricWeight(
              kFactor,
              preCalcVolumetricWeights,
              shipment_details,
              { length, width, height, noofboxes }
            );

            const chargeableWeight = Math.max(volumetricWeight, actualWeight);
            const baseFreight = unitPrice * chargeableWeight;
            const docketCharge = pr.docketCharges || 0;
            const minCharges = pr.minCharges || 0;
            const greenTax = pr.greenTax || 0;
            const daccCharges = pr.daccCharges || 0;
            const miscCharges = pr.miscellanousCharges || 0;
            // ⚠️  FUEL SURCHARGE FORMULA — READ BEFORE MODIFYING ⚠️
            // ─────────────────────────────────────────────────────────────────
            // `pr.fuel`    = percentage stored as a whole number (e.g. 5 → 5%)
            // `pr.fuelMax` = ₹ rupee CAP that simulates a flat-rate fuel charge
            //
            // Flat-rate pattern : fuel=100  + fuelMax=400  → always ₹400 max
            // Percentage pattern: fuel=5    + fuelMax=0/null → 5% of baseFreight
            //
            // NEVER remove the Math.min / fuelMax cap — doing so will make
            // vendors that use the flat-rate pattern charge 100% of baseFreight
            // (effectively doubling the price).  Confirm with the user BEFORE
            // changing this formula or the field semantics in the DB/UTSF files.
            // MUST stay in sync with Block 2 (line ~1074) and utsfService.js (~line 497).
            // ─────────────────────────────────────────────────────────────────
            const fuelCharges = Math.min(((pr.fuel || 0) / 100) * baseFreight, pr.fuelMax || Infinity);
            const rovCharges = Math.max(
              ((pr.rovCharges?.variable || 0) / 100) * baseFreight,
              pr.rovCharges?.fixed || 0
            );
            const insuaranceCharges = Math.max(
              ((pr.insuaranceCharges?.variable || 0) / 100) * baseFreight,
              pr.insuaranceCharges?.fixed || 0
            );
            const odaCharges = destIsOda
              ? (pr.odaCharges?.fixed || 0) +
              chargeableWeight * ((pr.odaCharges?.variable || 0) / 100)
              : 0;
            const handlingCharges =
              (pr.handlingCharges?.fixed || 0) +
              chargeableWeight * ((pr.handlingCharges?.variable || 0) / 100);
            const fmCharges = Math.max(
              ((pr.fmCharges?.variable || 0) / 100) * baseFreight,
              pr.fmCharges?.fixed || 0
            );
            const appointmentCharges = Math.max(
              ((pr.appointmentCharges?.variable || 0) / 100) * baseFreight,
              pr.appointmentCharges?.fixed || 0
            );

            // FIX: minCharges is a FLOOR constraint, not an additive fee
            // effectiveBaseFreight ensures freight is never below minimum
            const effectiveBaseFreight = Math.max(baseFreight, minCharges);

            const _standardSubtotal1 =
              effectiveBaseFreight +
              docketCharge +
              greenTax +
              daccCharges +
              miscCharges +
              fuelCharges +
              rovCharges +
              insuaranceCharges +
              odaCharges +
              handlingCharges +
              fmCharges +
              appointmentCharges;
            const totalChargesBeforeAddon =
              _standardSubtotal1 +
              computeCustomSurcharges(pr.surcharges, baseFreight, chargeableWeight, _standardSubtotal1);

            // 🔍 DEBUG: Log CALCULATED values for "Add Jan"
            // PERFORMANCE: Only log when ENABLE_VENDOR_DEBUG_LOGGING is true (disabled in production)
            if (ENABLE_VENDOR_DEBUG_LOGGING && tuc.companyName && tuc.companyName.toLowerCase().includes('jan')) {
              console.log('🧮 [DEBUG CALC] =====================================');
              console.log(`🧮 [DEBUG] actualWeight: ${actualWeight} kg`);
              console.log(`🧮 [DEBUG] volumetricWeight: ${volumetricWeight} kg`);
              console.log(`🧮 [DEBUG] chargeableWeight: ${chargeableWeight} kg`);
              console.log(`🧮 [DEBUG] baseFreight: ₹${baseFreight} (${unitPrice} × ${chargeableWeight})`);
              console.log(`🧮 [DEBUG] effectiveBaseFreight: ₹${effectiveBaseFreight}`);
              console.log(`🧮 [DEBUG] fuelCharges: ₹${fuelCharges.toFixed(2)}`);
              console.log(`🧮 [DEBUG] docketCharge: ₹${docketCharge}`);
              console.log(`🧮 [DEBUG] rovCharges: ₹${rovCharges}`);
              console.log(`🧮 [DEBUG] handlingCharges: ₹${handlingCharges}`);
              console.log(`🧮 [DEBUG] appointmentCharges: ₹${appointmentCharges}`);
              console.log(`🧮 [DEBUG] totalChargesBeforeAddon: ₹${totalChargesBeforeAddon.toFixed(2)}`);
              console.log('🧮 [DEBUG CALC] =====================================');
            }

            l1 = Math.min(l1, totalChargesBeforeAddon);

            // --- NEW: invoice addon detection points (try multiple common paths)
            const possibleRule =
              tuc.invoice_rule ||
              tuc.invoiceRule ||
              (tuc.prices &&
                (tuc.prices.invoice_rule || tuc.prices.invoiceRule)) ||
              null;

            // ✅ Use our simple invoiceValueCharges field from schema
            const invoiceAddon = calculateInvoiceValueCharge(
              invoiceValue,
              tuc.invoiceValueCharges
            );

            // PERF: Removed verbose invoiceRule logging

            return {
              companyId: tuc._id,
              companyName: companyName,
              originPincode: fromPincode,
              destinationPincode: toPincode,
              estimatedTime: estTime,
              distance: dist,
              actualWeight: parseFloat(actualWeight.toFixed(2)),
              volumetricWeight: parseFloat(volumetricWeight.toFixed(2)),
              chargeableWeight: parseFloat(chargeableWeight.toFixed(2)),
              unitPrice,
              baseFreight,
              docketCharge,
              minCharges,
              greenTax,
              daccCharges,
              miscCharges,
              fuelCharges,
              formulaParams: {
                source: 'MongoDB',
                kFactor: kFactor,
                fuelPercent: pr.fuel || 0,
                docketCharge: docketCharge,
                rovPercent: pr.rovCharges?.variable || 0,
                rovFixed: pr.rovCharges?.fixed || 0,
                minCharges: minCharges,
                odaConfig: { isOda: destIsOda, fixed: pr.odaCharges?.fixed || 0, variable: pr.odaCharges?.variable || 0 },
                unitPrice: unitPrice,
                baseFreight: baseFreight,
                effectiveBaseFreight: effectiveBaseFreight
              },
              rovCharges,
              insuaranceCharges,
              odaCharges,
              handlingCharges,
              fmCharges,
              appointmentCharges,

              // 🔥 NEW FIELDS (needed for UI)
              invoiceValue,                                       // What user entered
              invoiceAddon: Math.round(invoiceAddon),     // Calculated surcharge
              invoiceValueCharge: Math.round(invoiceAddon),

              totalCharges: Math.round(totalChargesBeforeAddon + invoiceAddon),
              totalChargesWithoutInvoiceAddon: Math.round(totalChargesBeforeAddon),

              isHidden: false,
              isTemporaryTransporter: true,
              // Flag to distinguish user's own vendors from others
              isTiedUp: tuc.customerID && tuc.customerID.toString() === customerID.toString(),
              // Zone configuration for Service Zones modal
              selectedZones: tuc.selectedZones || [],
              zoneConfig: tuc.zoneConfig || {},
              priceChart: tuc.prices?.priceChart || {},
              // Approval status for UI display
              approvalStatus: tuc.approvalStatus || 'approved', // Default to approved for legacy vendors
              // Verification status for badge display
              isVerified: tuc.isVerified || false,
              // Vendor rating from database (user-configurable rating)
              rating: tuc.rating ?? 4, // Use nullish coalescing to preserve 0 ratings
              // Detailed vendor ratings breakdown
              vendorRatings: tuc.vendorRatings || null,
              totalRatings: tuc.totalRatings || 0,
            };

          } catch (error) {
            console.error(`  [ERROR] Failed processing tied-up vendor ${tuc.companyName || tuc._id}:`, error.message);
            return null;
          }
        })
      );
      const tiedUpResult = tiedUpRaw.filter((r) => r);
      console.timeEnd(`[${rid}] BUILD tiedUpResult`);
      // DEBUG LOG REMOVED
      // PERFORMANCE FIX: Removed duplicate DB query and 220 lines of redundant processing
      // The tiedUpCompanies query above already fetches all approved vendors with pricing
      // This saves ~300-500ms per request
      const temporaryTransporterResult = [];

      // ===== PERFORMANCE OPTIMIZATION: Batch fetch all prices (eliminates N+1 query) =====
      // BEFORE: 50 transporters = 50 separate DB queries (10-15 seconds)
      // AFTER: 1 batch query for all transporters (0.5-1 second)
      console.time(`[${rid}] BATCH_FETCH_PRICES`);
      const transporterIds = transporterData.map(t => t._id);
      const allPrices = await priceModel
        .find({ companyId: { $in: transporterIds } })
        .select("companyId priceRate zoneRates invoiceValueCharges")
        .lean()
        .maxTimeMS(15000);

      // Build Map for O(1) lookup instead of O(n) array.find
      const priceMap = new Map(
        allPrices.map(p => [String(p.companyId), p])
      );
      console.timeEnd(`[${rid}] BATCH_FETCH_PRICES`);
      console.log(`[${rid}] Fetched ${allPrices.length} price records for ${transporterIds.length} transporters`);
      // ===== END OPTIMIZATION =====

      // Public transporter results (unchanged except invoice addon)
      console.time(`[${rid}] BUILD transporterResult`);
      const transporterRaw = await Promise.all(
        transporterData.map(async (data) => {
          try {
            // DEBUG LOG REMOVED
            // ========== UNIFIED ZONE LOOKUP (Same as Temporary) ==========

            // PERFORMANCE: Only use fast global zone lookup (O(1) Map lookup)
            // Removed slow Try 2 (zoneConfig loops) and Try 3 (service array loops)
            const originZone = zoneForPincode(String(fromPincode));
            const destZone = zoneForPincode(String(toPincode));

            // REJECT if zones not found
            if (!originZone || !destZone) {
              return null;
            }

            // Normalize zones
            const normalizedOriginZone = String(originZone).toUpperCase();
            const normalizedDestZone = String(destZone).toUpperCase();

            // ========== PINCODE-LEVEL CHECK (STRICT) ==========
            // Public transporters must have BOTH origin and destination in service[] array
            // Zone-level matching is disabled - pincode-level is the only source of truth
            const serviceArray = data.service || [];
            if (!serviceArray.length) {
              return null; // No service array = no coverage
            }

            // Build pincode Map for O(1) lookup
            const pincodeMap = new Map();
            for (const entry of serviceArray) {
              if (entry.pincode) {
                pincodeMap.set(String(entry.pincode), entry);
              }
            }

            const fromPinStr = String(fromPincode);
            const toPinStr = String(toPincode);

            // STRICT: Both origin AND destination must be in service array
            const originEntry = pincodeMap.get(fromPinStr);
            const destEntry = pincodeMap.get(toPinStr);
            if (!originEntry || !destEntry) {
              return null; // Pincode not in vendor's service list
            }

            // Use ODA from service entry if available
            const isDestOda = destEntry.isODA === true;

            // ========== PRICING LOOKUP ==========
            // PERFORMANCE: Use pre-fetched Map instead of DB query
            const priceData = priceMap.get(String(data._id));

            if (!priceData) {
              return null;
            }

            const pr = priceData.priceRate || {};
            const unitPrice = getUnitPriceFromPriceChart(
              priceData.zoneRates,
              normalizedOriginZone,
              normalizedDestZone
            );
            if (!unitPrice) {
              return null;
            }

            const kFactor = pr.kFactor ?? pr.divisor ?? 5000;

            // PERFORMANCE: Use pre-calculated volumetric weight instead of recalculating
            const volumetricWeight = getVolumetricWeight(
              kFactor,
              preCalcVolumetricWeights,
              shipment_details,
              { length, width, height, noofboxes }
            );

            const chargeableWeight = Math.max(volumetricWeight, actualWeight);
            const baseFreight = unitPrice * chargeableWeight;
            const docketCharge = pr.docketCharges || 0;
            const minCharges = pr.minCharges || 0;
            const greenTax = pr.greenTax || 0;
            const daccCharges = pr.daccCharges || 0;
            const miscCharges = pr.miscellanousCharges || 0;
            // ⚠️  FUEL SURCHARGE FORMULA — READ BEFORE MODIFYING ⚠️
            // ─────────────────────────────────────────────────────────────────
            // `pr.fuel`    = percentage stored as a whole number (e.g. 5 → 5%)
            // `pr.fuelMax` = ₹ rupee CAP that simulates a flat-rate fuel charge
            //
            // Flat-rate pattern : fuel=100  + fuelMax=400  → always ₹400 max
            // Percentage pattern: fuel=5    + fuelMax=0/null → 5% of baseFreight
            //
            // NEVER remove the Math.min / fuelMax cap — doing so will make
            // vendors that use the flat-rate pattern charge 100% of baseFreight
            // (effectively doubling the price).  Confirm with the user BEFORE
            // changing this formula or the field semantics in the DB/UTSF files.
            // MUST stay in sync with Block 1 (line ~811) and utsfService.js (~line 497).
            // ─────────────────────────────────────────────────────────────────
            const fuelCharges = Math.min(((pr.fuel || 0) / 100) * baseFreight, pr.fuelMax || Infinity);
            const rovCharges = Math.max(
              ((pr.rovCharges?.variable || 0) / 100) * baseFreight,
              pr.rovCharges?.fixed || 0
            );
            const insuaranceCharges = Math.max(
              ((pr.insuaranceCharges?.variable || 0) / 100) * baseFreight,
              pr.insuaranceCharges?.fixed || 0
            );
            let odaCharges = 0;
            if (isDestOda) {
              const odaFixed = pr.odaCharges?.fixed || pr.odaCharges?.f || 0;
              const odaVar = pr.odaCharges?.variable || pr.odaCharges?.v || 0;
              const odaThreshold = pr.odaCharges?.thresholdWeight || 0;
              const odaMode = pr.odaCharges?.mode || 'legacy';
              if (odaMode === 'switch') {
                odaCharges = chargeableWeight <= odaThreshold ? odaFixed : odaVar * chargeableWeight;
              } else if (odaMode === 'excess') {
                odaCharges = odaFixed + Math.max(0, chargeableWeight - odaThreshold) * odaVar;
              } else {
                odaCharges = odaFixed + (chargeableWeight * odaVar / 100);
              }
            }
            const handlingCharges =
              (pr.handlingCharges?.fixed || 0) +
              chargeableWeight * ((pr.handlingCharges?.variable || 0) / 100);
            const fmCharges = Math.max(
              ((pr.fmCharges?.variable || 0) / 100) * baseFreight,
              pr.fmCharges?.fixed || 0
            );
            const appointmentCharges = Math.max(
              ((pr.appointmentCharges?.variable || 0) / 100) * baseFreight,
              pr.appointmentCharges?.fixed || 0
            );

            // FIX: minCharges is a FLOOR constraint, not an additive fee
            // effectiveBaseFreight ensures freight is never below minimum
            const effectiveBaseFreight = Math.max(baseFreight, minCharges);

            const _standardSubtotal2 =
              effectiveBaseFreight +
              docketCharge +
              greenTax +
              daccCharges +
              miscCharges +
              fuelCharges +
              rovCharges +
              insuaranceCharges +
              odaCharges +
              handlingCharges +
              fmCharges +
              appointmentCharges;
            const totalChargesBeforeAddon =
              _standardSubtotal2 +
              computeCustomSurcharges(pr.surcharges, baseFreight, chargeableWeight, _standardSubtotal2);

            // PERF: Removed verbose per-vendor success logging

            // NOTE: Removed l1 filter - public vendors should always show regardless of tied-up vendor prices


            // ✅ NEW LOGIC: Calculate Invoice Charges
            const invoiceAddon = calculateInvoiceValueCharge(
              invoiceValue,
              priceData.invoiceValueCharges || {}
            );

            if (!isSubscribed) {
              // Return hidden quote with charges
              return {
                totalCharges: Math.round(totalChargesBeforeAddon + invoiceAddon),
                totalChargesWithoutInvoiceAddon:
                  Math.round(totalChargesBeforeAddon),
                invoiceAddon: Math.round(invoiceAddon),
                invoiceValueCharge: Math.round(invoiceAddon),
                isHidden: true,
              };
            }
            // DEBUG LOG REMOVED
            return {
              companyId: data._id,
              companyName: data.companyName,
              originPincode: fromPincode,
              destinationPincode: toPincode,
              estimatedTime: estTime,
              distance: dist,
              actualWeight: parseFloat(actualWeight.toFixed(2)),
              volumetricWeight: parseFloat(volumetricWeight.toFixed(2)),
              chargeableWeight: parseFloat(chargeableWeight.toFixed(2)),
              unitPrice,
              baseFreight,
              docketCharge,
              minCharges,
              greenTax,
              daccCharges,
              miscCharges,
              miscCharges,
              fuelCharges,
              formulaParams: {
                source: 'MongoDB',
                kFactor: kFactor,
                fuelPercent: pr.fuel || 0,
                docketCharge: docketCharge,
                rovPercent: pr.rovCharges?.variable || 0,
                rovFixed: pr.rovCharges?.fixed || 0,
                minCharges: minCharges,
                odaConfig: { isOda: isDestOda, fixed: pr.odaCharges?.fixed || 0, variable: pr.odaCharges?.variable || 0 },
                unitPrice: unitPrice,
                baseFreight: baseFreight,
                effectiveBaseFreight: effectiveBaseFreight
              },
              rovCharges,
              rovCharges,
              insuaranceCharges,
              odaCharges,
              handlingCharges,
              fmCharges,
              appointmentCharges,
              totalCharges: Math.round(totalChargesBeforeAddon + invoiceAddon),
              totalChargesWithoutInvoiceAddon: Math.round(totalChargesBeforeAddon),
              invoiceAddon: Math.round(invoiceAddon),
              invoiceValueCharge: Math.round(invoiceAddon),
              isHidden: false,
              isTemporaryTransporter: false, // PUBLIC transporters are from transporters collection, NOT temporaryTransporters
              // Zone configuration for Service Zones modal
              selectedZones: data.servicableZones || data.serviceZones || [],
              zoneConfig: data.zoneConfig || {},
              // Pass actual pincode count from vendor's service array
              servicePincodeCount: data.service?.length || 0,
              // Public transporters are pre-verified by the system - show as "Verified" in UI
              approvalStatus: 'approved',
              isVerified: data.isVerified === true,
              //If DB says true → UI shows verified, If DB says false → UI shows unverified
              // Contact information for "Contact Now" feature
              phone: data.phone || null,
              email: data.email || null,
              // Vendor rating from database (user-configurable rating)
              rating: data.rating ?? 4, // Use nullish coalescing to preserve 0 ratings
              // Detailed vendor ratings breakdown
              vendorRatings: data.vendorRatings || null,
              totalRatings: data.totalRatings || 0,
            };
          } catch (error) {
            console.error(`  [ERROR] Failed processing ${data.companyName}:`, error.message);
            return null;
          }
        })
      );
      const transporterResult = transporterRaw.filter((r) => r);
      console.timeEnd(`[${rid}] BUILD transporterResult`);
      // DEBUG LOG REMOVED
      const allTiedUpResults = [...tiedUpResult, ...temporaryTransporterResult];

      // =========================================================================
      // UTSF FALLBACK: Query UTSF transporters as well
      // =========================================================================
      let utsfResults = [];
      try {
        console.time(`[${rid}] UTSF_CALC`);
        // Use default kFactor=5000 for the initial chargeable weight;
        // each UTSF transporter recalculates internally with its own kFactor
        const defaultVolWeight = getVolumetricWeight(
          5000,
          preCalcVolumetricWeights,
          shipment_details,
          { length, width, height, noofboxes }
        );
        const chargeableWeight = Math.max(defaultVolWeight, actualWeight);

        utsfResults = utsfService.calculatePricesForRoute(
          fromPincode,
          toPincode,
          chargeableWeight,
          invoiceValue
        );

        // Transform UTSF results to match MongoDB result format
        utsfResults = utsfResults.map(utsf => ({
          _id: utsf.transporterId,
          companyName: utsf.companyName,
          customerID: utsf.customerID,
          totalCharges: utsf.totalCharges,
          estimatedTime: estTime, // Use same estimated time (matches MongoDB vendor format)
          distance: dist, // Use same distance
          zone: `${utsf.originZone} → ${utsf.destZone}`,
          rating: utsf.rating || 4.0,
          isVerified: utsf.isVerified || false,
          source: 'utsf', // Mark as UTSF source
          // Flatten breakdown to root so CalculationDetailsPage can read quote.docketCharge etc.
          ...utsf.breakdown,
          breakdown: utsf.breakdown,
          isOda: utsf.isOda || false,
          unitPrice: utsf.unitPrice,
          originPincode: fromPincode,
          destinationPincode: toPincode,
          chargeableWeight: chargeableWeight,
          actualWeight: actualWeight,
          volumetricWeight: defaultVolWeight,
          // Pass formulaParams so CalculationDetailsPage can render the full breakdown
          formulaParams: utsf.formulaParams,
        }));

        console.timeEnd(`[${rid}] UTSF_CALC`);
        console.log(`[UTSF] Found ${utsfResults.length} UTSF transporters for route`);
      } catch (utsfErr) {
        console.error(`[UTSF] Error calculating UTSF prices:`, utsfErr.message);
        // Continue without UTSF results
      }

      // =========================================================
      // HOT-SWITCH: UTSF takes priority over legacy MongoDB
      // =========================================================
      const utsfIds = new Set(utsfResults.map(u => String(u._id)));
      // ALSO match by companyName (case-insensitive) to catch vendors with different IDs
      const utsfNames = new Set(utsfResults.map(u => (u.companyName || '').trim().toLowerCase()));

      // FALLBACK VENDORS WHITELIST (Case-Insensitive)
      // These vendors must NEVER be filtered out, even if UTSF exists (dual-path safety)
      const FALLBACK_VENDORS = ['wheelseye', 'local ftl', 'ftl transporter', 'local-ftl'];

      const isFallback = (p) => {
        if (!p || !p.companyName) return false;
        const name = p.companyName.toLowerCase();
        return FALLBACK_VENDORS.some(fv => name.includes(fv));
      };

      // Check if a MongoDB result is overridden by UTSF (by _id OR companyName)
      const isOverriddenByUtsf = (r) => {
        if (utsfIds.has(String(r._id || r.companyId))) return true;
        const name = (r.companyName || '').trim().toLowerCase();
        return name && utsfNames.has(name);
      };

      // 1. Filter TiedUp Results (Mutate in-place)
      // Remove MongoDB vendors that have a UTSF replacement (by ID or name)
      const keptTiedUp = allTiedUpResults.filter(r => !isOverriddenByUtsf(r) || isFallback(r));
      // Clear and repopulate the original array
      allTiedUpResults.length = 0;
      allTiedUpResults.push(...keptTiedUp);

      // 2. Filter Public MongoDB Results (Mutate in-place)
      const keptTransporter = transporterResult.filter(r => !isOverriddenByUtsf(r) || isFallback(r));
      transporterResult.length = 0;
      transporterResult.push(...keptTransporter);

      // 3. Use ALL UTSF results (they are the authority now)
      // Note: We don't filter utsfResults because they are the authority
      const newUtsfResults = utsfResults;

      // =========================================================
      // 🛠️ UTSF DEBUG LOG
      // =========================================================
      console.log("UTSF DEBUG [HOT-SWITCH]", {
        utsfCount: newUtsfResults.length,
        mongoTiedUpKept: allTiedUpResults.length,
        // mongoPublicKept: transporterResult.length
      });

      // Split UTSF results: user's own UTSF vendors go to tiedUp, rest to company
      // Set isTiedUp flag correctly so frontend categorizes them properly
      const utsfTiedUp = newUtsfResults
        .filter(u => u.customerID && String(u.customerID) === String(customerID))
        .map(u => ({ ...u, isTiedUp: true }));
      const utsfPublic = newUtsfResults
        .filter(u => !u.customerID || String(u.customerID) !== String(customerID))
        .map(u => ({ ...u, isTiedUp: false }));
      allTiedUpResults.push(...utsfTiedUp);

      // Combine all results
      const combinedCompanyResult = [...transporterResult, ...utsfPublic];

      // Add debugging summary when no results found
      if (allTiedUpResults.length === 0 && combinedCompanyResult.length === 0) {
        // DEBUG LOG REMOVED
        // DEBUG LOG REMOVED
        // DEBUG LOG REMOVED
        // DEBUG LOG REMOVED
        // DEBUG LOG REMOVED
      }

      // PERFORMANCE: Log total processing time
      console.log(`[PERF] calculatePrice completed in ${Date.now() - startTime}ms (MongoDB: ${transporterResult.length}, UTSF: ${newUtsfResults.length})`);

      // =========================================================================
      // SMART SHIELD: Validate all quotes for anomalies before sending to frontend
      // Catches: NaN values, negative charges, weight mismatches, formula drift,
      //          extreme outliers, phantom charges, and more
      // =========================================================================
      const allQuotesForValidation = [...allTiedUpResults, ...combinedCompanyResult];
      const shieldResult = validateAllQuotes(allQuotesForValidation);

      // Log anomalies to server console for monitoring
      if (shieldResult.summary.errors > 0 || shieldResult.summary.warnings > 0) {
        console.warn(`[SMART SHIELD] Route ${fromPincode}→${toPincode}: ${shieldResult.summary.errors} errors, ${shieldResult.summary.warnings} warnings across ${shieldResult.summary.totalQuotes} quotes (score: ${shieldResult.overallScore})`);
        // Log individual errors (warnings only at debug level)
        shieldResult.quoteResults.forEach(qr => {
          const errors = qr.flags.filter(f => f.severity === 'error');
          if (errors.length > 0) {
            console.error(`  [SHIELD ERROR] ${qr.companyName}: ${errors.map(e => e.message).join('; ')}`);
          }
        });
        if (shieldResult.cohortFlags.length > 0) {
          shieldResult.cohortFlags.forEach(cf => {
            console.warn(`  [SHIELD OUTLIER] ${cf.message}`);
          });
        }
      }

      const responseData = {
        success: true,
        message: allTiedUpResults.length > 0 || combinedCompanyResult.length > 0
          ? "Price calculated successfully"
          : "No vendors found for this route. Check if vendors have pricing configured for these zones.",
        tiedUpResult: allTiedUpResults,
        companyResult: combinedCompanyResult,
        // PERFORMANCE FIX: Return distance so frontend doesn't need separate API call
        distanceKm: distData.distanceKm || parseFloat(String(dist).replace(/[^0-9.]/g, '')) || 0,
        distanceText: dist,
        estimatedDays: estTime,
        // Smart Shield anomaly report
        smartShield: {
          overallScore: shieldResult.overallScore,
          summary: shieldResult.summary,
          cohortFlags: shieldResult.cohortFlags,
          // Per-quote flags mapped by companyName for easy frontend lookup
          quoteFlags: shieldResult.quoteResults.reduce((map, qr) => {
            if (qr.flags.length > 0) {
              map[qr.companyName] = { flags: qr.flags, score: qr.score };
            }
            return map;
          }, {}),
        },
        // Debug info to help frontend understand why no results
        debug: {
          originZone: fromZone,
          destinationZone: toZone,
          totalTiedUpVendors: tiedUpCompanies.length,
          totalPublicTransporters: transporterData.length,
          matchedTiedUp: allTiedUpResults.length,
          matchedPublicMongoDB: transporterResult.length,
          matchedUTSF: newUtsfResults.length,
          matchedPublicTotal: combinedCompanyResult.length,
          processingTimeMs: Date.now() - startTime,
        }
      };

      // =========================================================================
      // PERFORMANCE: Cache the result in Redis for future requests
      // Only cache successful responses with results
      // To disable: set ENABLE_RESULT_CACHING to false at top of file
      // =========================================================================
      if (ENABLE_RESULT_CACHING && cacheKey && redisClient.isReady) {
        try {
          // Only cache if we have results (don't cache empty responses)
          if (allTiedUpResults.length > 0 || transporterResult.length > 0) {
            await redisClient.setEx(cacheKey, RESULT_CACHE_TTL_SECONDS, JSON.stringify(responseData));
            console.log(`[${rid}] 📦 Result cached for ${RESULT_CACHE_TTL_SECONDS}s`);
          }
        } catch (cacheErr) {
          // Cache write error should not affect response
          console.warn(`[${rid}] Cache write error (response still sent):`, cacheErr.message);
        }
      }

      return res.status(200).json(responseData);
    } catch (err) {
      console.error(`[${rid}] An error occurred in calculatePrice:`, err);
      console.error(`[${rid}] Stack trace:`, err.stack);
      console.error(`[${rid}] Request params: from=${fromPincode}, to=${toPincode}, customerID=${customerID}`);
      // GRACEFUL DEGRADATION: Return 200 with empty results instead of 500
      // This allows the frontend to still render the "Your Vendors" section
      // with "Find nearest serviceable pincode" and "Add a vendor" buttons
      return res.status(200).json({
        success: true,
        message: "Price calculated with errors. Some results may be missing.",
        tiedUpResult: [],
        companyResult: [],
        distanceKm: 0,
        distanceText: "N/A",
        estimatedDays: "N/A",
        smartShield: { overallScore: 1, summary: { totalQuotes: 0, errors: 0, warnings: 0, infos: 0, cleanQuotes: 0 }, cohortFlags: [], quoteFlags: {} },
        debug: {
          error: true,
          errorType: err.name,
          errorMessage: err.message,
          processingTimeMs: Date.now() - startTime,
        },
      });
    }
  } catch (outerErr) {
    console.error("OUTER ERROR in calculatePrice:", outerErr);
    console.error("Stack:", outerErr.stack);
    return res.status(500).json({
      success: false,
      message: "Fatal error",
    });
  }
};

export const addTiedUpCompany = async (req, res) => {
  try {
    let {
      customerID,
      vendorCode,
      vendorPhone,
      vendorEmail,
      gstNo,
      transportMode,
      address,
      state,
      city,
      pincode,
      rating,
      companyName,
      contactPersonName,
      subVendor,
      priceRate,
      priceChart,
      selectedZones,
      vendorJson, // ⬅️ NEW: grab vendorJson if FE sends it
      invoiceValueCharges, // ⬅️ optional direct field support
      // NEW: Serviceability data (pincode-authoritative)
      serviceability,
      serviceabilityChecksum,
      serviceabilitySource,
      // NEW FIELDS for Quick Lookup autofill support:
      serviceMode,
      volumetricUnit,
      volumetricDivisor,
      cftFactor,
      // NEW: Individual vendor rating parameters
      vendorRatings,
      isDraft, // ✅ Received from frontend
    } = req.body;

    // Debug: Log received values to verify they're coming through
    console.log('📥 Received vendor data:', {
      companyName,
      contactPersonName: contactPersonName || '(empty)',
      subVendor: subVendor || '(empty)',
      hasPriceRate: !!priceRate,
      priceRateKeys: priceRate ? Object.keys(priceRate) : [],
      serviceabilityCount: Array.isArray(serviceability) ? serviceability.length :
        (typeof serviceability === 'string' ? 'STRING' : 'NONE'),
      serviceabilityChecksum: serviceabilityChecksum || '(none)',
      serviceabilitySource: serviceabilitySource || '(none)',
      codChargesReceived: priceRate?.codCharges ? {
        fixed: priceRate.codCharges.fixed,
        variable: priceRate.codCharges.variable,
      } : 'NOT PRESENT',
      topayChargesReceived: priceRate?.topayCharges ? {
        fixed: priceRate.topayCharges.fixed,
        variable: priceRate.topayCharges.variable,
      } : 'NOT PRESENT',
    });

    // Parse JSON strings if they come from FormData
    if (typeof priceRate === "string") {
      try {
        priceRate = JSON.parse(priceRate);
      } catch (e) {
        console.error("Failed to parse priceRate:", e);
      }
    }

    if (typeof priceChart === "string") {
      try {
        priceChart = JSON.parse(priceChart);
      } catch (e) {
        console.error("Failed to parse priceChart:", e);
      }
    }

    if (typeof selectedZones === "string") {
      try {
        selectedZones = JSON.parse(selectedZones);
      } catch (e) {
        console.error("Failed to parse selectedZones:", e);
      }
    }

    // NEW: Parse serviceability if it's a JSON string (from FormData)
    if (typeof serviceability === "string") {
      try {
        serviceability = JSON.parse(serviceability);
      } catch (e) {
        console.error("Failed to parse serviceability:", e);
        serviceability = [];
      }
    }

    // NEW: Parse vendorRatings if it's a JSON string (from FormData)
    if (typeof vendorRatings === "string") {
      try {
        vendorRatings = JSON.parse(vendorRatings);
      } catch (e) {
        console.error("Failed to parse vendorRatings:", e);
        vendorRatings = null;
      }
    }

    // 🔹 NEW: parse vendorJson if it's a JSON string
    let parsedVendorJson = null;
    if (vendorJson) {
      try {
        parsedVendorJson =
          typeof vendorJson === "string" ? JSON.parse(vendorJson) : vendorJson;
      } catch (e) {
        console.error("Failed to parse vendorJson:", e);
      }
    }

    // Extract serviceability from vendorJson if not provided directly
    if ((!serviceability || !Array.isArray(serviceability) || serviceability.length === 0) && parsedVendorJson?.serviceability) {
      serviceability = parsedVendorJson.serviceability;
      serviceabilityChecksum = serviceabilityChecksum || parsedVendorJson.serviceabilityChecksum || '';
      serviceabilitySource = serviceabilitySource || parsedVendorJson.serviceabilitySource || 'wizard';
    }

    // 🔹 NEW: build invoiceValueCharges from either vendorJson or direct body
    const defaultInvoiceValueCharges = {
      enabled: false,
      percentage: 0,
      minimumAmount: 0,
      description: "Invoice Value Handling Charges",
    };

    const invoiceFromVendorJson =
      parsedVendorJson && parsedVendorJson.invoiceValueCharges
        ? parsedVendorJson.invoiceValueCharges
        : null;

    const invoiceFromBody =
      invoiceValueCharges && typeof invoiceValueCharges === "object"
        ? invoiceValueCharges
        : null;

    const finalInvoiceValueCharges = {
      ...defaultInvoiceValueCharges,
      ...(invoiceFromVendorJson || {}),
      ...(invoiceFromBody || {}),
    };

    // ============================================================
    // VALIDATION: Check for required fields
    // ============================================================
    // If serviceability is provided, priceChart can be empty (we'll build it from zones)
    const hasServiceability = Array.isArray(serviceability) && serviceability.length > 0;
    const hasPriceChart = priceChart && typeof priceChart === 'object' && Object.keys(priceChart).length > 0;

    // Basic required field validation
    // ✅ DRAFT MODE: Skip strict validation
    if (isDraft) {
      if (!customerID || !companyName) {
        return res.status(400).json({
          success: false,
          message:
            "customerID and companyName are required even for drafts",
        });
      }
    } else {
      if (
        !customerID ||
        !vendorCode ||
        !vendorPhone ||
        !vendorEmail ||
        !gstNo ||
        !transportMode ||
        !address ||
        !state ||
        !pincode ||
        !rating ||
        !companyName ||
        !priceRate
      ) {
        return res.status(400).json({
          success: false,
          message:
            "customerID, companyName, and priceRate are required",
        });
      }

      // Must have either serviceability or priceChart (only for final submit)
      if (!hasServiceability && !hasPriceChart) {
        return res.status(400).json({
          success: false,
          message:
            "Either serviceability data or priceChart is required",
        });
      }
    }

    // Enhanced companyName validation
    if (!companyName || typeof companyName !== 'string' || companyName.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Company name must be at least 2 characters",
      });
    }

    // Input validation and sanitization
    const validationErrors = [];

    // ✅ DRAFT MODE: Skip detailed validation checks
    if (!isDraft) {
      if (!validateEmail(vendorEmail)) {
        validationErrors.push("Invalid email format");
      }

      if (!validatePhone(vendorPhone)) {
        validationErrors.push(
          "Invalid phone number format (must be 10 digits, cannot start with 0)"
        );
      }

      if (!validateGSTIN(gstNo)) {
        validationErrors.push("Invalid GSTIN format");
      }

      if (!validatePincode(pincode)) {
        validationErrors.push("Invalid pincode format (must be 6 digits)");
      }

      if (
        selectedZones &&
        Array.isArray(selectedZones) &&
        selectedZones.length > 0
      ) {
        const sanitizedZones = sanitizeZoneCodes(selectedZones);
        const matrixValidation = validateZoneMatrix(priceChart, sanitizedZones);

        if (!matrixValidation.valid) {
          validationErrors.push(...matrixValidation.errors);
        }
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    // Sanitize inputs
    const sanitizedCompanyName = sanitizeString(companyName, 100);
    const sanitizedContactPersonName = contactPersonName ? sanitizeString(contactPersonName, 50) : "";
    const sanitizedAddress = sanitizeString(address, 200);
    const sanitizedState = sanitizeString(state, 50);
    const sanitizedCity = city ? sanitizeString(city, 50) : "";
    const sanitizedSubVendor = subVendor ? sanitizeString(subVendor, 50) : "";
    const sanitizedZones = selectedZones ? sanitizeZoneCodes(selectedZones) : [];

    // Check duplicate temp vendor
    const existingTempVendor = await temporaryTransporterModel.findOne({
      customerID: customerID,
      companyName: sanitizedCompanyName,
      vendorCode: vendorCode,
    });

    if (existingTempVendor) {
      return res.status(400).json({
        success: false,
        message: "This vendor already exists for your account",
      });
    }

    // ============================================================
    // BUILD zoneConfig from serviceability data
    // This creates a map: { zone: [pincode1, pincode2, ...] }
    // ============================================================
    const zoneConfigMap = new Map();
    const validServiceability = [];

    if (Array.isArray(serviceability) && serviceability.length > 0) {
      for (const entry of serviceability) {
        if (entry.pincode && entry.zone) {
          // Add to zoneConfig map
          if (!zoneConfigMap.has(entry.zone)) {
            zoneConfigMap.set(entry.zone, []);
          }
          zoneConfigMap.get(entry.zone).push(String(entry.pincode));

          // Normalize and validate the entry
          validServiceability.push({
            pincode: String(entry.pincode),
            zone: String(entry.zone).toUpperCase(),
            state: entry.state || '',
            city: entry.city || '',
            isODA: Boolean(entry.isODA),
            active: entry.active !== false, // default to true
          });
        }
      }

      console.log('📋 Built zoneConfig from serviceability:', {
        zonesCount: zoneConfigMap.size,
        zones: Array.from(zoneConfigMap.keys()),
        totalPincodes: validServiceability.length,
      });
    }

    // Update selectedZones from serviceability if not provided
    const finalSelectedZones = sanitizedZones.length > 0
      ? sanitizedZones
      : Array.from(zoneConfigMap.keys());

    // 🧨 KEY PART: now we actually save invoiceValueCharges
    // Debug: Log what we're about to save
    console.log('💾 Saving to DB:', {
      companyName: sanitizedCompanyName,
      contactPersonName: sanitizedContactPersonName || '(empty)',
      subVendor: sanitizedSubVendor || '(empty)',
      serviceabilityCount: validServiceability.length,
      zoneConfigZones: Array.from(zoneConfigMap.keys()),
      selectedZones: finalSelectedZones,
      codCharges: priceRate?.codCharges || 'NOT IN PRICERATE',
      topayCharges: priceRate?.topayCharges || 'NOT IN PRICERATE',
      rovCharges: priceRate?.rovCharges || 'NOT IN PRICERATE',
      prepaidCharges: priceRate?.prepaidCharges || 'NOT IN PRICERATE',
      fullPriceRate: priceRate ? 'HAS DATA' : 'MISSING',
    });

    const tempData = await new temporaryTransporterModel({
      customerID: customerID,
      companyName: sanitizedCompanyName,
      contactPersonName: sanitizedContactPersonName,
      vendorCode: vendorCode,
      vendorPhone: Number(vendorPhone),
      vendorEmail: vendorEmail.trim().toLowerCase(),
      gstNo: gstNo.trim().toUpperCase(),
      transportMode: transportMode,
      address: sanitizedAddress,
      state: sanitizedState,
      city: sanitizedCity,
      pincode: Number(pincode),
      rating: Number(rating) || 3,
      // APPROVAL STATUS: Drafts are 'draft', others 'approved'
      approvalStatus: isDraft ? 'draft' : 'approved',
      // NEW: Individual vendor rating parameters
      vendorRatings: vendorRatings || {
        priceSupport: 0,
        deliveryTime: 0,
        tracking: 0,
        salesSupport: 0,
        damageLoss: 0,
      },
      subVendor: sanitizedSubVendor,
      // Verification status - new vendors are unverified by default
      isVerified: false,
      // NEW: Additional fields for autofill
      serviceMode: serviceMode || '',
      volumetricUnit: volumetricUnit || 'cm',
      // NOTE: divisor is now ONLY in prices.priceRate.divisor (single source of truth)
      // Removed root-level divisor to fix Quick Lookup autofill inconsistency
      cftFactor: cftFactor ? Number(cftFactor) : null,
      selectedZones: finalSelectedZones,
      // NEW: zoneConfig built from serviceability
      zoneConfig: Object.fromEntries(zoneConfigMap),
      // NEW: Serviceability array (pincode-authoritative)
      serviceability: validServiceability,
      serviceabilityChecksum: serviceabilityChecksum || '',
      serviceabilitySource: serviceabilitySource || (validServiceability.length > 0 ? 'excel' : ''),
      prices: {
        priceRate: priceRate,
        priceChart: priceChart || {},
      },
      invoiceValueCharges: finalInvoiceValueCharges,
    }).save({ validateBeforeSave: !isDraft });

    if (tempData) {
      return res.status(201).json({
        success: true,
        message: "Vendor added successfully to your tied-up vendors",
        data: tempData,
      });
    } else {
      return res.status(500).json({
        success: false,
        message: "Failed to save vendor",
      });
    }
  } catch (err) {
    console.error("Error in addTiedUpCompany:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error:
        process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const getTiedUpCompanies = async (req, res) => {
  try {
    const userid = await req.query;
    const data = await usertransporterrelationshipModel.findOne({
      customerID: userid,
    });
    return res.status(200).json({
      success: true,
      message: "Tied up companies fetched successfully",
      data: data,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const getTemporaryTransporters = async (req, res) => {
  try {
    const { customerID } = req.query;
    // DEBUG LOG REMOVED
    // If no customerID, return all temporary transporters (for super admin)
    const baseQuery = customerID ? { customerID: customerID } : {};
    // Filter out test/dummy transporters
    const query = {
      ...baseQuery,
      companyName: {
        $not: {
          $regex: /test|tester|dummy|vellore/i
        }
      }
    };
    // DEBUG LOG REMOVED
    // Fetch ALL transporters without any limit
    const temporaryTransporters = await temporaryTransporterModel.find(query).select('-serviceability -zoneConfig').lean();

    // =========================================================
    // UTSF MERGE: Inject UTSF transporters for this customer
    // =========================================================
    if (customerID) {
      const utsfTransporters = utsfService.getTransportersByCustomerId(customerID);

      // Convert UTSF to compatible format
      const utsfformatted = utsfTransporters.map(t => ({
        _id: t.id,
        companyName: t.companyName,
        approvalStatus: t.data.meta?.approvalStatus || 'pending',
        isVerified: t.isVerified,
        rating: t.rating,
        transporterType: t.transporterType,
        source: 'utsf', // Flag for frontend
        updatedAt: t.data.meta?.updatedAt
      }));

      // HOT-SWITCH: Remove MongoDB entries that are overridden by UTSF
      const utsfIds = new Set(utsfformatted.map(u => String(u._id)));

      // Filter in place (keep only those NOT in UTSF)
      for (let i = temporaryTransporters.length - 1; i >= 0; i--) {
        if (utsfIds.has(String(temporaryTransporters[i]._id))) {
          temporaryTransporters.splice(i, 1);
        }
      }

      // Add UTSF to the list
      temporaryTransporters.push(...utsfformatted);
    }

    return res.status(200).json({
      success: true,
      message: "Temporary transporters fetched successfully",
      data: temporaryTransporters,
    });
  } catch (error) {
    console.error("[BACKEND] Error fetching temporary transporters:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * Get a single temporary transporter by ID
 * GET /api/transporter/temporary/:id
 */
export const getTemporaryTransporterById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Transporter ID is required",
      });
    }

    const transporter = await temporaryTransporterModel
      .findById(id)
      .select('-serviceability -zoneConfig') // Exclude large fields for performance
      .lean();

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: "Temporary transporter not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Temporary transporter fetched successfully",
      data: transporter,
    });
  } catch (error) {
    console.error("[BACKEND] Error fetching temporary transporter by ID:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const updateTemporaryTransporterStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be pending, approved, or rejected",
      });
    }

    const updatedTransporter = await temporaryTransporterModel.findByIdAndUpdate(
      id,
      { approvalStatus: status },
      { new: true }
    );

    if (!updatedTransporter) {
      return res.status(404).json({
        success: false,
        message: "Temporary transporter not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Vendor ${status} successfully`,
      data: updatedTransporter,
    });
  } catch (error) {
    console.error("Error updating temporary transporter status:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const toggleTemporaryTransporterVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { isVerified } = req.body;

    if (typeof isVerified !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "Invalid isVerified value. Must be boolean",
      });
    }

    const updatedTransporter = await temporaryTransporterModel.findByIdAndUpdate(
      id,
      { isVerified },
      { new: true }
    );

    if (!updatedTransporter) {
      return res.status(404).json({
        success: false,
        message: "Temporary transporter not found",
      });
    }

    // Clear all cached calculation results when verification status changes
    // This ensures users see the updated verification badge immediately
    if (redisClient.isReady) {
      try {
        const keys = await redisClient.keys('calc:*');
        if (keys.length > 0) {
          await redisClient.del(keys);
          console.log(`[CACHE] Cleared ${keys.length} cached calculation results after verification change`);
        }
      } catch (cacheErr) {
        console.warn('[CACHE] Failed to clear cache after verification change:', cacheErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Vendor marked as ${isVerified ? 'verified' : 'unverified'} successfully`,
      data: updatedTransporter,
    });
  } catch (error) {
    console.error("Error toggling temporary transporter verification:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// ============================================================================
// REGULAR TRANSPORTER VERIFICATION FUNCTIONS
// These mirror the temporary transporter functions but work with the 
// transporters collection (regular transporters)
// ============================================================================

/**
 * Update regular transporter approval status
 * PUT /api/transporter/regular/:id/status
 */
export const updateTransporterStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be pending, approved, or rejected",
      });
    }

    const updatedTransporter = await transporterModel.findByIdAndUpdate(
      id,
      { approvalStatus: status },
      { new: true }
    ).select("-password -servicableZones -service");

    if (!updatedTransporter) {
      return res.status(404).json({
        success: false,
        message: "Transporter not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Transporter ${status} successfully`,
      data: updatedTransporter,
    });
  } catch (error) {
    console.error("Error updating transporter status:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * Toggle regular transporter verification status
 * PUT /api/transporter/regular/:id/verification
 */
export const toggleTransporterVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { isVerified } = req.body;

    if (typeof isVerified !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "Invalid isVerified value. Must be boolean",
      });
    }

    const updatedTransporter = await transporterModel.findByIdAndUpdate(
      id,
      { isVerified },
      { new: true }
    ).select("-password -servicableZones -service");

    if (!updatedTransporter) {
      return res.status(404).json({
        success: false,
        message: "Transporter not found",
      });
    }

    // Clear cached calculation results when verification status changes
    if (redisClient.isReady) {
      try {
        const keys = await redisClient.keys('calc:*');
        if (keys.length > 0) {
          await redisClient.del(keys);
          console.log(`[CACHE] Cleared ${keys.length} cached calculation results after verification change`);
        }
      } catch (cacheErr) {
        console.warn('[CACHE] Failed to clear cache after verification change:', cacheErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Transporter marked as ${isVerified ? 'verified' : 'unverified'} successfully`,
      data: updatedTransporter,
    });
  } catch (error) {
    console.error("Error toggling transporter verification:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

/**
 * Get all regular transporters for admin management
 * GET /api/transporter/regular
 * Returns transporters with approval and verification status
 */
export const getRegularTransporters = async (req, res) => {
  try {
    // Filter out test/dummy transporters
    const query = {
      companyName: {
        $not: {
          $regex: /test|tester|dummy|vellore/i
        }
      }
    };

    const transporters = await transporterModel
      .find(query)
      .select("-password -servicableZones -service")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Transporters fetched successfully",
      data: transporters,
    });
  } catch (error) {
    console.error("[BACKEND] Error fetching regular transporters:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const getTransporters = async (req, res) => {
  try {
    const { search } = req.query;
    if (!search || typeof search !== "string" || !search.trim()) {
      return res.status(400).json([]);
    }
    const regex = new RegExp("^" + search, "i");
    const companies = await transporterModel
      .find({ companyName: { $regex: regex } })
      .limit(10)
      .select("companyName");
    res.json(companies.map((c) => c.companyName));
  } catch (err) {
    console.error("Fetch companies error:", err);
    res.status(500).json([]);
  }
};

export const getAllTransporters = async (req, res) => {
  try {
    const transporters = await transporterModel
      .find()
      .select("-password -servicableZones -service");
    if (transporters.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No transporters found",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Transporters fetched successfully",
      data: transporters,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// Remove a tied-up vendor for a specific customer by company name (case-insensitive)
export const removeTiedUpVendor = async (req, res) => {
  try {
    // DEBUG LOG REMOVED
    console.log("📦 req.body:", JSON.stringify(req.body, null, 2));
    console.log("📥 req.params:", JSON.stringify(req.params, null, 2));
    console.log("📤 req.query:", JSON.stringify(req.query, null, 2));
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // Get data from body (preserve original extraction)
    let { customerID, companyName, vendorId } = req.body || {};
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // Accept id from URL/query if not present in body
    if (!vendorId) {
      if (req.params && req.params.id) {
        vendorId = req.params.id;
        // DEBUG LOG REMOVED
      } else if (req.query && (req.query.vendorId || req.query.id)) {
        vendorId = req.query.vendorId || req.query.id;
        // DEBUG LOG REMOVED
      }
    }

    // FALLBACK: Get customerID from auth middleware if not in body
    if (!customerID) {
      customerID =
        req.customer?._id ||
        req.customer?.id ||
        req.user?._id ||
        req.user?.id;
      // DEBUG LOG REMOVED
    }
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // VALIDATION
    if (!customerID || (!companyName && !vendorId)) {
      // DEBUG LOG REMOVED
      // DEBUG LOG REMOVED
      // DEBUG LOG REMOVED
      // DEBUG LOG REMOVED
      return res.status(400).json({
        success: false,
        message: "customerID and either companyName or vendorId are required",
        debug:
          process.env.NODE_ENV === "development"
            ? {
              receivedCustomerID: !!customerID,
              receivedCompanyName: !!companyName,
              receivedVendorId: !!vendorId,
            }
            : undefined,
      });
    }
    // DEBUG LOG REMOVED
    let relDeleted = 0;
    let tempDeleted = 0;

    // DELETE BY VENDOR ID (preferred)
    if (vendorId) {
      // DEBUG LOG REMOVED
      const tempRes = await temporaryTransporterModel.deleteOne({
        _id: vendorId,
        customerID: customerID,
      });

      tempDeleted = tempRes?.deletedCount || 0;
      console.log(`  ✓ Deleted ${tempDeleted} temporary transporter(s)`);
    }
    // DELETE BY COMPANY NAME (fallback)
    else if (companyName) {
      // DEBUG LOG REMOVED
      const nameRegex = new RegExp(`^${companyName}$`, "i");

      // Find transporter by name to remove relationships
      const transporter = await transporterModel
        .findOne({
          companyName: nameRegex,
        })
        .select("_id");

      if (transporter?._id) {
        // DEBUG LOG REMOVED
        const relRes = await usertransporterrelationshipModel.deleteMany({
          customerID,
          transporterId: transporter._id,
        });

        relDeleted = relRes?.deletedCount || 0;
        console.log(`  ✓ Deleted ${relDeleted} relationship(s)`);
      } else {
        // DEBUG LOG REMOVED
      }

      // Remove any temporary transporters added for this customer
      const tempRes = await temporaryTransporterModel.deleteMany({
        customerID,
        companyName: nameRegex,
      });

      tempDeleted = tempRes?.deletedCount || 0;
      console.log(`  ✓ Deleted ${tempDeleted} temporary transporter(s)`);
    }
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    if (tempDeleted > 0 || relDeleted > 0) {
      // DEBUG LOG REMOVED
      return res.status(200).json({
        success: true,
        message: "Vendor removed successfully",
        removedRelationships: relDeleted,
        removedTemporary: tempDeleted,
      });
    } else {
      // DEBUG LOG REMOVED
      return res.status(404).json({
        success: false,
        message: "Vendor not found or already deleted",
      });
    }
  } catch (err) {
    console.error("💥 ERROR in removeTiedUpVendor:", err);
    console.error("Stack trace:", err.stack);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error:
        process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

export const savePckingList = async (req, res) => {
  try {
    const {
      customerId,
      name,
      modeoftransport,
      originPincode,
      destinationPincode,
      noofboxes,
      quantity,
      length,
      width,
      height,
      weight,
    } = req.body;

    const authCustomerId = req.customer?._id?.toString();
    const effectiveCustomerId = (req.customer?.isAdmin ? customerId : authCustomerId) || authCustomerId || customerId;

    if (!effectiveCustomerId) {
      return res.status(400).json({
        success: false,
        message: "customerId is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(effectiveCustomerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customerId",
      });
    }

    if (
      !name ||
      !modeoftransport ||
      !originPincode ||
      !destinationPincode ||
      !noofboxes ||
      !length ||
      !width ||
      !height ||
      !weight
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill all the fields",
      });
    }
    const data = await new PackingList({
      customerId: new mongoose.Types.ObjectId(effectiveCustomerId),
      name,
      modeoftransport,
      originPincode,
      destinationPincode,
      noofboxes,
      length,
      width,
      height,
      weight,
    }).save();
    if (data) {
      return res.status(200).json({
        success: true,
        message: "Packing list saved successfully",
      });
    }
  } catch (error) {
    console.error("[PackingList] savePckingList failed", {
      customerId: req.body?.customerId,
      authCustomerId: req.customer?._id,
      error: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

export const getPackingList = async (req, res) => {
  try {
    const queryCustomerId =
      req.query?.customerId || req.query?.customerID || req.query?.customerid;
    const authCustomerId = req.customer?._id?.toString();
    const effectiveCustomerId = (queryCustomerId || authCustomerId)?.toString();

    if (!effectiveCustomerId) {
      return res.status(400).json({
        success: false,
        message: "customerId is required",
        data: [],
      });
    }

    if (!mongoose.Types.ObjectId.isValid(effectiveCustomerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customerId",
        data: [],
      });
    }

    if (!req.customer?._id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        data: [],
      });
    }

    if (
      req.customer?.isAdmin !== true &&
      authCustomerId &&
      effectiveCustomerId !== authCustomerId
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        data: [],
      });
    }

    const data = await PackingList.find({
      customerId: new mongoose.Types.ObjectId(effectiveCustomerId),
    })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Packing list found successfully",
      data,
    });
  } catch (error) {
    console.error("[PackingList] getPackingList failed", {
      query: req.query,
      authCustomerId: req.customer?._id,
      error: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Server Error",
      data: [],
    });
  }
};

export const getTrasnporterDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const details = await transporterModel
      .findOne({ _id: id })
      .select("-password -servicableZones -service");
    if (details) {
      return res.status(200).json({
        success: true,
        data: details,
      });
    }
  } catch (error) {
    // DEBUG LOG REMOVED
    return res.status(500).json({
      success: true,
      message: "Server Error",
    });
  }
};

export const updateVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const customerID = req.customer?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Verify vendor belongs to customer
    const vendor = await temporaryTransporterModel.findOne({
      _id: id,
      customerID: customerID,
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found or access denied",
      });
    }

    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.customerID;
    // ✅ REMOVED: Don't delete prices - allow updating prices
    // delete updateData.prices;

    const updatedVendor = await temporaryTransporterModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedVendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Vendor updated successfully",
      data: updatedVendor,
    });
  } catch (error) {
    console.error("Error updating vendor:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating vendor",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get zone matrix for a vendor
 * GET /api/transporter/zone-matrix/:vendorId
 */
export const getZoneMatrix = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const customerID = req.customer?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const vendor = await temporaryTransporterModel.findOne({
      _id: vendorId,
      customerID: customerID,
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found or access denied",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Zone matrix retrieved successfully",
      data: {
        vendorId: vendor._id,
        companyName: vendor.companyName,
        priceChart: vendor.prices?.priceChart || {},
        selectedZones: vendor.selectedZones || [],
      },
    });
  } catch (error) {
    console.error("Error retrieving zone matrix:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while retrieving zone matrix",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update zone matrix for a vendor
 * PUT /api/transporter/zone-matrix/:vendorId
 */
export const updateZoneMatrix = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { priceChart, selectedZones } = req.body;
    const customerID = req.customer?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!priceChart) {
      return res.status(400).json({
        success: false,
        message: "priceChart is required",
      });
    }

    // Verify vendor belongs to customer
    const vendor = await temporaryTransporterModel.findOne({
      _id: vendorId,
      customerID: customerID,
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found or access denied",
      });
    }

    // Validate zone matrix if selectedZones provided
    const validationErrors = [];
    if (
      selectedZones &&
      Array.isArray(selectedZones) &&
      selectedZones.length > 0
    ) {
      const sanitizedZones = sanitizeZoneCodes(selectedZones);
      const matrixValidation = validateZoneMatrix(priceChart, sanitizedZones);

      if (!matrixValidation.valid) {
        validationErrors.push(...matrixValidation.errors);
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    // Update zone matrix
    const sanitizedZones = selectedZones
      ? sanitizeZoneCodes(selectedZones)
      : vendor.selectedZones;

    const updatedVendor = await temporaryTransporterModel.findByIdAndUpdate(
      vendorId,
      {
        "prices.priceChart": priceChart,
        selectedZones: sanitizedZones,
      },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Zone matrix updated successfully",
      data: {
        vendorId: updatedVendor._id,
        companyName: updatedVendor.companyName,
        priceChart: updatedVendor.prices.priceChart,
        selectedZones: updatedVendor.selectedZones,
      },
    });
  } catch (error) {
    console.error("Error updating zone matrix:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating zone matrix",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Delete zone matrix for a vendor (resets to empty)
 * DELETE /api/transporter/zone-matrix/:vendorId
 */
export const deleteZoneMatrix = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const customerID = req.customer?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Verify vendor belongs to customer
    const vendor = await temporaryTransporterModel.findOne({
      _id: vendorId,
      customerID: customerID,
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found or access denied",
      });
    }

    // Reset zone matrix
    const updatedVendor = await temporaryTransporterModel.findByIdAndUpdate(
      vendorId,
      {
        "prices.priceChart": {},
        selectedZones: [],
      },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Zone matrix deleted successfully",
      data: {
        vendorId: updatedVendor._id,
        companyName: updatedVendor.companyName,
        priceChart: updatedVendor.prices.priceChart,
        selectedZones: updatedVendor.selectedZones,
      },
    });
  } catch (error) {
    console.error("Error deleting zone matrix:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting zone matrix",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Save wizard data to backend
 * POST /api/vendor/wizard-data
 */
export const saveWizardData = async (req, res) => {
  try {
    const { zones, priceMatrix, oda, other } = req.body;
    const customerID = req.customer?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Validate price matrix if provided
    if (priceMatrix && zones && Array.isArray(zones) && zones.length > 0) {
      const selectedZones = zones.map((z) => z.zoneCode).filter(Boolean);
      if (selectedZones.length > 0) {
        const matrixValidation = validateZoneMatrix(priceMatrix, selectedZones);
        if (!matrixValidation.valid) {
          return res.status(400).json({
            success: false,
            message: "Invalid zone matrix structure",
            errors: matrixValidation.errors,
          });
        }
      }
    }

    // For now, just acknowledge save; storage strategy can be plugged in later
    return res.status(200).json({
      success: true,
      message: "Wizard data saved successfully",
      data: {
        saved: true,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error saving wizard data:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while saving wizard data",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get wizard data from backend
 * GET /api/vendor/wizard-data
 */
export const getWizardData = async (req, res) => {
  try {
    const customerID = req.customer?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Placeholder empty structure
    return res.status(200).json({
      success: true,
      message: "Wizard data retrieved successfully",
      data: {
        zones: [],
        priceMatrix: {},
        oda: {
          enabled: false,
          pincodes: [],
          surcharge: { fixed: 0, variable: 0 },
        },
        other: {
          minWeight: 0,
          docketCharges: 0,
          fuel: 0,
          // ... other fields
        },
      },
    });
  } catch (error) {
    console.error("Error retrieving wizard data:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while retrieving wizard data",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ============================================================================
// DEBUG ENDPOINT - Check companyName field presence
// ============================================================================
export const debugVendorFields = async (req, res) => {
  try {
    const { customerID } = req.query;

    if (!customerID) {
      return res.status(400).json({
        success: false,
        message: "customerID is required"
      });
    }

    const vendors = await temporaryTransporterModel.find({
      customerID: customerID
    });

    const report = vendors.map(v => ({
      _id: v._id,
      hasCompanyName: !!(v.companyName && v.companyName.trim()),
      companyName: v.companyName || 'MISSING',
      vendorCode: v.vendorCode || 'N/A',
      vendorEmail: v.vendorEmail || 'N/A',
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    }));

    const missing = report.filter(r => !r.hasCompanyName);
    const present = report.filter(r => r.hasCompanyName);

    res.json({
      success: true,
      summary: {
        total: vendors.length,
        withCompanyName: present.length,
        missingCompanyName: missing.length,
        percentageGood: vendors.length > 0
          ? ((present.length / vendors.length) * 100).toFixed(1) + '%'
          : 'N/A'
      },
      allVendors: report,
      missingCompanyNameVendors: missing.length > 0 ? missing : null,
    });
  } catch (error) {
    console.error('Error in debugVendorFields:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Update temporary transporter/vendor details
 * PUT /api/transporter/temporary/:id
 * Super Admin only
 */
export const updateTemporaryTransporter = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    // DEBUG LOG REMOVED
    // DEBUG LOG REMOVED
    console.log("  - Update fields:", Object.keys(updates));

    // Remove fields that shouldn't be updated via this endpoint
    delete updates._id;
    delete updates.customerID;
    delete updates.createdAt;
    delete updates.updatedAt;

    // Check if vendor exists first
    const existingVendor = await temporaryTransporterModel.findById(id);
    // DEBUG LOG REMOVED
    if (existingVendor) {
      // DEBUG LOG REMOVED
    }

    // Find and update the vendor
    const updatedVendor = await temporaryTransporterModel.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!updatedVendor) {
      // DEBUG LOG REMOVED
      return res.status(404).json({
        success: false,
        message: "Vendor not found",
      });
    }
    // DEBUG LOG REMOVED
    return res.status(200).json({
      success: true,
      message: "Vendor updated successfully",
      data: updatedVendor,
    });
  } catch (error) {
    console.error("Error updating temporary transporter:", error);

    // Validation error handling
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        fieldErrors: error.errors
      });
    }

    // Generic error
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update vendor",
    });
  }
};

// ==============================================================================
// SEARCH TRANSPORTERS - For Quick Lookup on Add Vendor page
// Searches both public transporters AND temporary transporters (tied-up vendors)
// ==============================================================================
// ==============================================================================
// SEARCH TRANSPORTERS - Fixed with logging
// ==============================================================================
export const searchTransporters = async (req, res) => {
  const reqId = Date.now();

  try {
    const { query, customerID, limit = 10 } = req.query;

    // LOG 1: Request received
    console.log(`\n[SEARCH-${reqId}] Query: "${query}" | CustomerID: ${customerID} | Limit: ${limit}`);

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search query must be at least 2 characters"
      });
    }

    const searchRegex = new RegExp(query, 'i');
    const limitNum = Math.min(parseInt(limit) || 10, 50);

    const searchOr = [
      { companyName: searchRegex },
      { vendorCode: searchRegex },
      { vendorEmail: searchRegex },
      { displayName: searchRegex }
    ];

    // Filter to exclude test/dummy transporters
    const excludeTestNames = {
      companyName: {
        $not: {
          $regex: /test|tester|dummy|vellore/i
        }
      }
    };

    // Only show approved vendors (matching calculator page behavior)
    const approvedOnly = { approvalStatus: 'approved' };

    const tempQuery = customerID
      ? { $and: [{ $or: searchOr }, { customerID: customerID }, excludeTestNames, approvedOnly] }
      : { $and: [{ $or: searchOr }, excludeTestNames, approvedOnly] };

    // Search both collections
    const [publicTransporters, tempTransporters] = await Promise.all([
      transporterModel
        .find({ $and: [{ $or: searchOr }, excludeTestNames, approvedOnly] })
        .select('companyName displayName vendorCode vendorPhone vendorEmail gstNo address state city pincode rating selectedZones serviceZones serviceableZones servicableZones zoneConfig service approvalStatus')
        .limit(limitNum)
        .lean(),

      temporaryTransporterModel
        .find(tempQuery)
        .select('companyName contactPersonName displayName vendorCode vendorPhone vendorEmail gstNo subVendor address state city pincode transportMode serviceMode volumetricUnit cftFactor rating selectedZones zoneConfig zoneConfigurations approvalStatus prices serviceability serviceabilityChecksum serviceabilitySource')
        .limit(limitNum)
        .lean()
    ]);

    // =========================================================
    // UTSF MERGE & HOT-SWITCH
    // =========================================================
    const utsfResults = [];
    if (customerID) {
      const allUtsf = utsfService.getTransportersByCustomerId(customerID);

      // Filter by search query and approval status (only approved vendors)
      for (const t of allUtsf) {
        const utsfApproval = t.data.meta?.approvalStatus || 'pending';
        if (utsfApproval !== 'approved') continue;
        if (
          searchRegex.test(t.companyName) ||
          (t.vendorCode && searchRegex.test(t.vendorCode)) ||
          (t.data.meta.email && searchRegex.test(t.data.meta.email))
        ) {
          utsfResults.push(t);
        }
      }
    }

    // HOT-SWITCH: Filter out mongo results that are overridden by UTSF
    const utsfIds = new Set(utsfResults.map(u => String(u.id)));

    // Filter Public & Temp arrays in place
    // Note: Usually public won't match private UTSF IDs, but safety first
    for (let i = publicTransporters.length - 1; i >= 0; i--) {
      if (utsfIds.has(String(publicTransporters[i]._id))) publicTransporters.splice(i, 1);
    }
    for (let i = tempTransporters.length - 1; i >= 0; i--) {
      if (utsfIds.has(String(tempTransporters[i]._id))) tempTransporters.splice(i, 1);
    }

    // LOG 2: Results count (Update with UTSF)
    console.log(`[SEARCH-${reqId}] Found: ${publicTransporters.length} public, ${tempTransporters.length} temporary, ${utsfResults.length} UTSF`);

    const results = [];

    // Process UTSF Transporters
    utsfResults.forEach(t => {
      // Basic approximation of zones/serviceability for search result preview
      const zoneKeys = Object.keys(t.serviceability || {});

      results.push({
        id: t.id,
        source: 'utsf',
        isTemporary: true,
        companyName: t.companyName,
        legalCompanyName: t.companyName,
        displayName: t.companyName,
        vendorCode: t.vendorCode || '',
        rating: t.rating,
        approvalStatus: t.data.meta?.approvalStatus || 'pending',
        zones: zoneKeys,
        zoneConfigs: zoneKeys.map(z => ({
          zoneCode: z,
          zoneName: z,
          isComplete: true
        })),
        serviceabilityCount: t.totalPincodes,
        hasRichPincodeData: true
      });
    });


    // Process PUBLIC transporters
    // Process PUBLIC transporters
    publicTransporters.forEach(t => {
      // FIX: Get zones from correct fields
      const zones = t.serviceZones || t.serviceableZones || t.servicableZones || t.selectedZones || [];
      const zoneConfigKeys = Object.keys(t.zoneConfig || {});
      const finalZones = zones.length > 0 ? zones : zoneConfigKeys;

      // FIX: Send service array for smart enrichment on frontend
      const serviceability = (t.service || []).map(s => {
        if (typeof s === 'string') {
          return { pincode: s, zone: '', state: '', city: '', isODA: false };
        }
        return {
          pincode: String(s.pincode || s.Pincode || ''),
          zone: String(s.zone || s.Zone || '').toUpperCase(),
          state: s.state || s.State || '',
          city: s.city || s.City || '',
          isODA: s.isODA || s.IsODA || false,
        };
      });

      results.push({
        id: t._id?.toString(),
        source: 'public',
        isTemporary: false,
        companyName: t.companyName,
        legalCompanyName: t.companyName,
        displayName: t.displayName || t.companyName,
        vendorCode: t.vendorCode,
        vendorPhone: t.vendorPhone,
        vendorEmail: t.vendorEmail,
        gstNo: t.gstNo,
        address: t.address,
        state: t.state,
        city: t.city,
        pincode: t.pincode,
        rating: t.rating,
        zones: finalZones.map(z => String(z).toUpperCase()),
        zoneConfigs: finalZones.map(z => ({
          zoneCode: String(z).toUpperCase(),
          zoneName: String(z).toUpperCase(),
          region: String(z).startsWith('NE') ? 'Northeast' :
            String(z).startsWith('N') ? 'North' :
              String(z).startsWith('S') ? 'South' :
                String(z).startsWith('E') ? 'East' :
                  String(z).startsWith('W') ? 'West' :
                    String(z).startsWith('X') ? 'Special' :
                      String(z).startsWith('C') ? 'Central' : 'North',
          selectedStates: [],
          selectedCities: [],
          isComplete: false
        })),
        // CRITICAL: Send serviceability for smart enrichment
        serviceability: serviceability,
        serviceabilityCount: t.service?.length || 0,
        hasRichPincodeData: (t.service?.length || 0) >= 50,
      });
    });

    // Process TEMPORARY transporters
    tempTransporters.forEach((t, idx) => {
      // LOG 4: Each temp transporter
      console.log(`[SEARCH-${reqId}] [TEMP-${idx}] ${t.companyName} | zones: ${t.selectedZones?.length || 0} | serviceability: ${t.serviceability?.length || 0} | priceChart: ${Object.keys(t.prices?.priceChart || {}).length}`);

      // Build zoneConfigs from various sources
      let zoneConfigs = [];
      if (t.zoneConfigurations?.length > 0) {
        zoneConfigs = t.zoneConfigurations;
      } else if (t.zoneConfig) {
        const zc = t.zoneConfig instanceof Map ? Object.fromEntries(t.zoneConfig) : t.zoneConfig;
        zoneConfigs = Object.keys(zc).map(z => ({
          zoneCode: z,
          zoneName: z,
          region: z.startsWith('NE') ? 'Northeast' : z.startsWith('N') ? 'North' : z.startsWith('S') ? 'South' : z.startsWith('E') ? 'East' : z.startsWith('W') ? 'West' : z.startsWith('X') ? 'Special' : z.startsWith('C') ? 'Central' : 'North',
          selectedStates: [],
          selectedCities: [],
          isComplete: false
        }));
      }

      results.push({
        id: t._id?.toString(),
        source: 'temporary',
        isTemporary: true,
        companyName: t.companyName,
        legalCompanyName: t.companyName,
        displayName: t.displayName || t.companyName,
        contactPersonName: t.contactPersonName || '',
        vendorCode: t.vendorCode,
        vendorPhone: t.vendorPhone,
        vendorEmail: t.vendorEmail,
        gstNo: t.gstNo,
        subVendor: t.subVendor || '',
        address: t.address,
        state: t.state,
        city: t.city,
        pincode: t.pincode,
        mode: t.transportMode || 'Road',
        transportMode: t.transportMode || 'Road',
        serviceMode: t.serviceMode || '',
        rating: t.rating,
        approvalStatus: t.approvalStatus || 'pending',
        zones: t.selectedZones || [],
        zoneConfigs: zoneConfigs,
        volumetricUnit: t.volumetricUnit || 'cm',
        cftFactor: t.cftFactor || null,
        charges: {
          ...(t.prices?.priceRate || {}),
          divisor: t.prices?.priceRate?.divisor || 5000,
        },
        priceChart: t.prices?.priceChart || {},
        invoiceValueCharges: t.prices?.invoiceValueCharges || {},
        serviceability: t.serviceability || [],
        serviceabilityChecksum: t.serviceabilityChecksum || '',
        serviceabilitySource: t.serviceabilitySource || '',
      });
    });

    // Sort by relevance
    const lowerQuery = query.toLowerCase();
    results.sort((a, b) => {
      const aName = (a.companyName || '').toLowerCase();
      const bName = (b.companyName || '').toLowerCase();
      if (aName === lowerQuery && bName !== lowerQuery) return -1;
      if (bName === lowerQuery && aName !== lowerQuery) return 1;
      if (aName.startsWith(lowerQuery) && !bName.startsWith(lowerQuery)) return -1;
      if (bName.startsWith(lowerQuery) && !aName.startsWith(lowerQuery)) return 1;
      return aName.localeCompare(bName);
    });

    const finalResults = results.slice(0, limitNum);

    // LOG 5: Final response
    console.log(`[SEARCH-${reqId}] Returning ${finalResults.length} results\n`);

    return res.status(200).json({
      success: true,
      data: finalResults,
      meta: {
        total: finalResults.length,
        publicCount: publicTransporters.length,
        tempCount: tempTransporters.length,
        query
      }
    });

  } catch (error) {
    console.error(`[SEARCH-${reqId}] ERROR:`, error.message);
    return res.status(500).json({
      success: false,
      message: error.message || "Search failed"
    });
  }
};

// =============================================================================
// SEARCH TRANSPORTER DETAIL (by ID + source)
// Used by AddVendor page to fetch full vendor data after Quick Lookup selection
// =============================================================================
export const getSearchTransporterDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const { source, customerID } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, message: 'Transporter ID is required' });
    }

    let vendor = null;

    // UTSF source
    if (source === 'utsf' && customerID) {
      const t = utsfService.getTransporterById ? utsfService.getTransporterById(id) : null;
      if (t) {
        const zoneKeys = Object.keys(t.serviceability || {});
        // Build serviceability array from UTSF
        const serviceabilityArr = [];
        for (const [zone, pincodes] of Object.entries(t.serviceability || {})) {
          if (Array.isArray(pincodes)) {
            pincodes.forEach(p => {
              serviceabilityArr.push({
                pincode: typeof p === 'object' ? String(p.pincode || '') : String(p),
                zone,
                state: typeof p === 'object' ? (p.state || '') : '',
                city: typeof p === 'object' ? (p.city || '') : '',
                isODA: typeof p === 'object' ? (p.isODA || false) : false,
              });
            });
          }
        }
        vendor = {
          id: t.id,
          source: 'utsf',
          isTemporary: true,
          companyName: t.companyName,
          legalCompanyName: t.companyName,
          displayName: t.companyName,
          vendorCode: t.vendorCode || '',
          vendorPhone: t.data?.meta?.phone || '',
          vendorEmail: t.data?.meta?.email || '',
          gstNo: t.data?.meta?.gstNo || '',
          contactPersonName: t.data?.meta?.contactPersonName || '',
          subVendor: '',
          address: t.data?.meta?.address || '',
          state: t.data?.meta?.state || '',
          city: t.data?.meta?.city || '',
          pincode: t.data?.meta?.pincode || '',
          mode: t.data?.meta?.transportMode || 'Road',
          transportMode: t.data?.meta?.transportMode || 'Road',
          rating: t.rating || 4,
          zones: zoneKeys,
          zoneConfigs: zoneKeys.map(z => ({
            zoneCode: z, zoneName: z,
            region: z.startsWith('NE') ? 'Northeast' : z.startsWith('N') ? 'North' : z.startsWith('S') ? 'South' : z.startsWith('E') ? 'East' : z.startsWith('W') ? 'West' : z.startsWith('C') ? 'Central' : 'Other',
            selectedStates: [], selectedCities: [], isComplete: true,
          })),
          serviceability: serviceabilityArr,
        };
      }
    }
    // Temporary transporter
    else if (source === 'temporary') {
      const t = await temporaryTransporterModel.findById(id).lean();
      if (t) {
        const zoneCodes = t.selectedZones || Object.keys(t.zoneConfig instanceof Map ? Object.fromEntries(t.zoneConfig) : (t.zoneConfig || {}));
        let zoneConfigs = [];
        if (t.zoneConfigurations?.length > 0) {
          zoneConfigs = t.zoneConfigurations;
        } else {
          zoneConfigs = zoneCodes.map(z => ({
            zoneCode: z, zoneName: z,
            region: z.startsWith('NE') ? 'Northeast' : z.startsWith('N') ? 'North' : z.startsWith('S') ? 'South' : z.startsWith('E') ? 'East' : z.startsWith('W') ? 'West' : z.startsWith('C') ? 'Central' : 'Other',
            selectedStates: [], selectedCities: [], isComplete: false,
          }));
        }
        vendor = {
          id: t._id?.toString(),
          source: 'temporary',
          isTemporary: true,
          companyName: t.companyName,
          legalCompanyName: t.companyName,
          displayName: t.displayName || t.companyName,
          contactPersonName: t.contactPersonName || '',
          vendorCode: t.vendorCode || '',
          vendorPhone: t.vendorPhone || '',
          vendorEmail: t.vendorEmail || '',
          gstNo: t.gstNo || '',
          subVendor: t.subVendor || '',
          address: t.address || '',
          state: t.state || '',
          city: t.city || '',
          pincode: t.pincode || '',
          mode: t.transportMode || 'Road',
          transportMode: t.transportMode || 'Road',
          serviceMode: t.serviceMode || '',
          rating: t.rating || 4,
          zones: zoneCodes,
          zoneConfigs,
          volumetricUnit: t.volumetricUnit || 'cm',
          cftFactor: t.cftFactor || null,
          charges: {
            ...(t.prices?.priceRate || {}),
            divisor: t.prices?.priceRate?.divisor || 5000,
          },
          priceChart: t.prices?.priceChart || {},
          invoiceValueCharges: t.prices?.invoiceValueCharges || {},
          serviceability: t.serviceability || [],
          serviceabilityChecksum: t.serviceabilityChecksum || '',
          serviceabilitySource: t.serviceabilitySource || '',
        };
      }
    }
    // Public (regular) transporter
    else if (source === 'public') {
      const t = await transporterModel.findById(id).lean();
      if (t) {
        const zones = t.serviceZones || t.serviceableZones || t.servicableZones || t.selectedZones || [];
        const zoneConfigKeys = Object.keys(t.zoneConfig || {});
        const finalZones = zones.length > 0 ? zones : zoneConfigKeys;

        // Build serviceability from service array
        const serviceability = (t.service || []).map(s => {
          if (typeof s === 'string') return { pincode: s, zone: '', state: '', city: '', isODA: false };
          return {
            pincode: String(s.pincode || s.Pincode || ''),
            zone: String(s.zone || s.Zone || '').toUpperCase(),
            state: s.state || s.State || '',
            city: s.city || s.City || '',
            isODA: s.isODA || s.IsODA || false,
          };
        });

        vendor = {
          id: t._id?.toString(),
          source: 'public',
          isTemporary: false,
          companyName: t.companyName,
          legalCompanyName: t.companyName,
          displayName: t.displayName || t.companyName,
          contactPersonName: '',
          vendorCode: t.vendorCode || '',
          vendorPhone: t.vendorPhone || t.phone || '',
          vendorEmail: t.vendorEmail || t.email || '',
          gstNo: t.gstNo || '',
          subVendor: '',
          address: t.address || '',
          state: t.state || '',
          city: t.city || '',
          pincode: t.pincode || '',
          mode: 'Road',
          transportMode: 'Road',
          rating: t.rating || 4,
          zones: finalZones.map(z => String(z).toUpperCase()),
          zoneConfigs: finalZones.map(z => ({
            zoneCode: String(z).toUpperCase(),
            zoneName: String(z).toUpperCase(),
            region: String(z).startsWith('NE') ? 'Northeast' : String(z).startsWith('N') ? 'North' : String(z).startsWith('S') ? 'South' : String(z).startsWith('E') ? 'East' : String(z).startsWith('W') ? 'West' : String(z).startsWith('C') ? 'Central' : 'Other',
            selectedStates: [], selectedCities: [], isComplete: false,
          })),
          serviceability,
          serviceabilityCount: t.service?.length || 0,
        };
      }
    }

    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Transporter not found' });
    }

    return res.status(200).json({ success: true, data: vendor });
  } catch (error) {
    console.error('[DETAIL] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Detail fetch failed' });
  }
};

// =============================================================================
// BOX LIBRARY CRUD OPERATIONS
// These functions persist Box Libraries to MongoDB (tied to customer account)
// =============================================================================

/**
 * GET /api/transporter/box-libraries
 * Fetch all box libraries for the authenticated user
 */
export const getBoxLibraries = async (req, res) => {
  try {
    const authCustomerId = req.customer?._id?.toString();

    if (!authCustomerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        data: [],
      });
    }

    const libraries = await BoxLibrary.find({
      customerId: new mongoose.Types.ObjectId(authCustomerId),
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Libraries fetched successfully",
      data: libraries,
    });
  } catch (error) {
    console.error("[BoxLibrary] getBoxLibraries failed", {
      authCustomerId: req.customer?._id,
      error: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Server Error",
      data: [],
    });
  }
};

/**
 * POST /api/transporter/box-libraries
 * Create a new box library
 */
export const createBoxLibrary = async (req, res) => {
  try {
    const { name, category, boxes } = req.body;
    const authCustomerId = req.customer?._id?.toString();

    if (!authCustomerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Library name is required",
      });
    }

    // Create new library
    const newLibrary = await new BoxLibrary({
      customerId: new mongoose.Types.ObjectId(authCustomerId),
      name: name.trim(),
      category: category || "general",
      boxes: Array.isArray(boxes) ? boxes : [],
    }).save();

    return res.status(201).json({
      success: true,
      message: "Library created successfully",
      data: newLibrary,
    });
  } catch (error) {
    console.error("[BoxLibrary] createBoxLibrary failed", {
      authCustomerId: req.customer?._id,
      error: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

/**
 * PUT /api/transporter/box-libraries/:id
 * Update an existing box library (rename, change category, add/remove boxes)
 */
export const updateBoxLibrary = async (req, res) => {
  try {
    const libraryId = req.params.id;
    const { name, category, boxes } = req.body;
    const authCustomerId = req.customer?._id?.toString();

    if (!authCustomerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(libraryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid library ID",
      });
    }

    // Find and verify ownership
    const library = await BoxLibrary.findById(libraryId);

    if (!library) {
      return res.status(404).json({
        success: false,
        message: "Library not found",
      });
    }

    if (library.customerId.toString() !== authCustomerId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Update fields
    if (name && name.trim()) library.name = name.trim();
    if (category) library.category = category;
    if (Array.isArray(boxes)) library.boxes = boxes;

    await library.save();

    return res.status(200).json({
      success: true,
      message: "Library updated successfully",
      data: library,
    });
  } catch (error) {
    console.error("[BoxLibrary] updateBoxLibrary failed", {
      libraryId: req.params?.id,
      authCustomerId: req.customer?._id,
      error: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

/**
 * DELETE /api/transporter/box-libraries/:id
 * Delete a box library
 */
export const deleteBoxLibrary = async (req, res) => {
  try {
    const libraryId = req.params.id;
    const authCustomerId = req.customer?._id?.toString();

    if (!authCustomerId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(libraryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid library ID",
      });
    }

    const library = await BoxLibrary.findById(libraryId);

    if (!library) {
      return res.status(404).json({
        success: false,
        message: "Library not found",
      });
    }

    if (library.customerId.toString() !== authCustomerId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    await library.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Library deleted successfully",
    });
  } catch (error) {
    console.error("[BoxLibrary] deleteBoxLibrary failed", {
      libraryId: req.params?.id,
      authCustomerId: req.customer?._id,
      error: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Server error while deleting library",
    });
  }
};