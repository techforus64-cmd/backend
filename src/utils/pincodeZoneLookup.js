import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load FE pincodes.json for zone mapping; fall back to local data if provided
const FE_PINCODES_PATH = path.join(__dirname, "../../data/pincodes.json");
const LOCAL_PINCODES_PATH = path.join(__dirname, "../../data/pincodes.json");

let zoneMap = null;
let pincodeDataMap = null; // Full pincode data with city/state

function buildZoneMap(jsonArr) {
  const map = new Map();
  for (const item of jsonArr || []) {
    const pin = String(item.pincode || "");
    const zone = item.zone ? String(item.zone).toUpperCase() : null;
    if (pin && zone) map.set(pin, zone);
  }
  return map;
}

function buildPincodeDataMap(jsonArr) {
  const map = new Map();
  for (const item of jsonArr || []) {
    const pin = String(item.pincode || "");
    if (pin) {
      map.set(pin, {
        pincode: pin,
        zone: item.zone ? String(item.zone).toUpperCase() : '',
        state: item.state || '',
        city: item.city || ''
      });
    }
  }
  return map;
}

(() => {
  try {
    if (fs.existsSync(FE_PINCODES_PATH)) {
      const raw = JSON.parse(fs.readFileSync(FE_PINCODES_PATH, "utf-8"));
      zoneMap = buildZoneMap(raw);
      pincodeDataMap = buildPincodeDataMap(raw); // Build full data map
      return;
    }
  } catch (e) {
    // continue to local fallback
  }
  try {
    if (fs.existsSync(LOCAL_PINCODES_PATH)) {
      const raw = JSON.parse(fs.readFileSync(LOCAL_PINCODES_PATH, "utf-8"));
      zoneMap = buildZoneMap(raw);
      pincodeDataMap = buildPincodeDataMap(raw); // Build full data map
      return;
    }
  } catch (e) {
    // no-op; keep maps as null
  }
})();

export function zoneForPincode(pin) {
  if (!pin) return null;
  const p = String(pin);
  if (zoneMap && zoneMap.has(p)) return zoneMap.get(p);
  return null;
}

/**
 * Get full pincode data including zone, state, and city
 * @param {string|number} pin - Pincode to lookup
 * @returns {Object|null} - {pincode, zone, state, city} or null if not found
 */
export function getPincodeData(pin) {
  if (!pin) return null;
  const p = String(pin);
  if (pincodeDataMap && pincodeDataMap.has(p)) {
    return pincodeDataMap.get(p);
  }
  return null;
}
