// backend/routes/vendorRoute.js
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import WheelseyePricing from '../model/wheelseyePricingModel.js';
import { calculateChargeableWeight, validateShipmentDetails } from '../utils/chargeableWeightService.js';
import { calculateDistanceBetweenPincode } from '../utils/distanceService.js';
dotenv.config();

const router = express.Router();

// ---------- Locate & load the rate table ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ratesPath = path.resolve(__dirname, "..", "data", "wheelseyeRates.json");
console.log(
  "[FTL] Using rates file:",
  ratesPath,
  fs.existsSync(ratesPath) ? "(found)" : "(MISSING)"
);

let ratesTable = [];
try {
  if (fs.existsSync(ratesPath)) {
    const raw = fs.readFileSync(ratesPath, "utf-8");
    ratesTable = JSON.parse(raw);
  } else {
    console.warn("[FTL] wheelseyeRates.json not found at", ratesPath);
  }
} catch (e) {
  console.error("[FTL] Failed to parse wheelseyeRates.json:", e.message);
}

// ---------- Column detection (tolerant to naming) ----------
const COLS = Object.keys(ratesTable?.[0] || []);

const looksLikeDistance = (k) =>
  /(km|kms|kilometer)s?\b/i.test(k) || (/\d/.test(k) && !/weight|wt/i.test(k));

const DIST_KEYS = COLS.filter(looksLikeDistance);

// Prefer an explicit weight column; otherwise the first non-distance col
const WEIGHT_KEY =
  COLS.find((k) => /^(weight|wt)\b/i.test(k)) ||
  COLS.find((k) => !looksLikeDistance(k)) ||
  "weight";

// ---------- Helpers ----------
const toNumber = (v) => {
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return v;
  // strip currency/commas/etc.
  const s = String(v).replace(/[^0-9.]/g, "");
  return s ? Number(s) : NaN;
};

// weight like "0-50 kg", "51 – 100", "200+", "Upto 50" -> use the last number
const parseWeightLabel = (v) => {
  if (typeof v === "number") return v;
  const s = String(v || "");
  const nums = s.match(/\d+/g);
  if (!nums || !nums.length) return NaN;
  return parseInt(nums[nums.length - 1], 10);
};

// distance column like "451-500 kms", "300 km", "300 KMS" -> nearest by number
const parseDistanceFromCol = (k) => {
  const nums = String(k).match(/\d+/g);
  if (!nums || !nums.length) return NaN;
  return parseInt(nums[nums.length - 1], 10);
};

function pickNearestRowByWeight(weightKg) {
  let best = null;
  let bestDelta = Infinity;
  for (const row of ratesTable) {
    const w = parseWeightLabel(row[WEIGHT_KEY]);
    if (Number.isNaN(w)) continue;
    const d = Math.abs(w - weightKg);
    if (d < bestDelta) {
      best = row;
      bestDelta = d;
    }
  }
  return best;
}

function getPriceFromSlab(weightKg, distanceKm) {
  if (!ratesTable.length || !DIST_KEYS.length) {
    return { error: "Rate table not loaded or distance columns not detected" };
  }

  const row = pickNearestRowByWeight(weightKg);
  if (!row) {
    return {
      error: "No row matched for weight slab",
      debug: { weightKg, WEIGHT_KEY },
    };
  }

  // Choose the row column whose numeric distance is nearest to distanceKm
  let chosenKey = null;
  let chosenKeyNum = null;
  let bestDelta = Infinity;

  for (const k of DIST_KEYS) {
    const n = parseDistanceFromCol(k);
    if (Number.isNaN(n)) continue;
    const delta = Math.abs(n - distanceKm);
    if (delta < bestDelta) {
      bestDelta = delta;
      chosenKey = k;
      chosenKeyNum = n;
    }
  }

  if (!chosenKey) {
    return {
      error: "No distance column matched",
      debug: { distanceKm, DIST_KEYS },
    };
  }

  // Try the chosen key first; if empty, scan other distance cols in this row
  let raw = row[chosenKey];
  if (raw == null || raw === "" || Number.isNaN(toNumber(raw))) {
    for (const k of DIST_KEYS) {
      const v = row[k];
      if (v != null && v !== "" && !Number.isNaN(toNumber(v))) {
        raw = v;
        chosenKey = k;
        chosenKeyNum = parseDistanceFromCol(k);
        break;
      }
    }
  }

  const price = toNumber(raw);
  if (!isFinite(price)) {
    return {
      error: "No price available for nearest slabs",
      debug: { chosenKey, distanceKm, weightKg },
    };
  }

  return {
    vendor: "Wheelseye FTL",
    mode: "FTL",
    price,
    distanceKm: Number(distanceKm),
    weightKg: Number(weightKg),
    slab: {
      weightColumn: WEIGHT_KEY,
      weightValue: row[WEIGHT_KEY],
      distanceKey: chosenKey,
      distanceBucketKm: chosenKeyNum,
    },
    breakdown: { base: price },
  };
}

// ---------- Routes ----------
router.post("/wheelseye-price", (req, res) => {
  const { weightKg, distanceKm } = req.body || {};
  if (!weightKg || !distanceKm) {
    return res
      .status(400)
      .json({ error: "weightKg and distanceKm are required" });
  }
  const result = getPriceFromSlab(Number(weightKg), Number(distanceKm));
  if (result.error) {
    console.warn("[FTL] price error:", result.error, result.debug || {});
    return res.status(404).json({ error: result.error, debug: result.debug });
  }
  return res.json(result);
});

// New endpoint: Get Wheelseye pricing from database with chargeable weight calculation
router.post("/wheelseye-pricing", async (req, res) => {
  console.log('💡 Wheelseye pricing endpoint hit with body:', req.body);
  try {
    const { weight, distance, shipment_details } = req.body;
    console.log('🔍 Parsed values:', { weight, distance, hasShipmentDetails: !!shipment_details, shipmentDetailsLength: shipment_details?.length });

    let chargeableWeight = weight;
    let weightBreakdown = null;

    // If shipment_details provided, calculate chargeable weight in backend
    if (shipment_details && Array.isArray(shipment_details) && shipment_details.length > 0) {
      console.log('📦 Calculating chargeable weight from shipment details');
      
      if (!validateShipmentDetails(shipment_details)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid shipment details format'
        });
      }

      weightBreakdown = calculateChargeableWeight(shipment_details);
      chargeableWeight = weightBreakdown.chargeableWeight;
      
      console.log('⚖️ Weight breakdown:', {
        actual: weightBreakdown.actualWeight,
        volumetric: weightBreakdown.volumetricWeight,
        chargeable: weightBreakdown.chargeableWeight,
        type: weightBreakdown.weightType
      });
    } else if (!weight && (!shipment_details || !Array.isArray(shipment_details) || shipment_details.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Either weight or shipment_details are required'
      });
    }

    if (!distance) {
      return res.status(400).json({
        success: false,
        message: 'Distance is required'
      });
    }

    const weightNum = parseFloat(chargeableWeight);
    const distanceNum = parseFloat(distance);

    if (isNaN(weightNum) || isNaN(distanceNum)) {
      return res.status(400).json({
        success: false,
        message: 'Weight and distance must be valid numbers'
      });
    }

    if (weightNum <= 0 || distanceNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Weight and distance must be greater than 0'
      });
    }

    const pricing = await WheelseyePricing.findPricing(weightNum, distanceNum);

    // Include weight breakdown in response if calculated
    if (weightBreakdown) {
      pricing.weightBreakdown = weightBreakdown;
    }

    res.json(pricing);

  } catch (error) {
    console.error('Error getting Wheelseye pricing:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

router.post("/wheelseye-distance", async (req, res) => {
  const { origin, destination } = req.body || {};
  if (!origin || !destination) {
    return res
      .status(400)
      .json({ error: "origin and destination are required" });
  }

  try {
    const { distanceKm } = await calculateDistanceBetweenPincode(origin, destination);
    res.json({
      distanceKm,
      status: "OK",
    });
  } catch (error) {
    // Handle NO_ROAD_ROUTE error
    if (error.code === 'NO_ROAD_ROUTE') {
      return res.status(400).json({
        error: "No direct road route exists",
        message: error.message,
        origin,
        destination
      });
    }
    // Handle PINCODE_NOT_FOUND error
    if (error.code === 'PINCODE_NOT_FOUND') {
      return res.status(400).json({
        error: "Invalid pincode",
        message: error.message,
        field: error.field
      });
    }
    // Handle API errors
    if (error.code === 'API_KEY_MISSING') {
      return res.status(500).json({ error: "GOOGLE_MAP_API_KEY not configured" });
    }
    // Generic error
    console.error("Distance calculation error:", error.message);
    res.status(500).json({ error: "Distance calculation failed" });
  }
});

export default router;
