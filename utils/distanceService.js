import axios from 'axios';
import pinMap from '../src/utils/pincodeMap.js';
import haversineDistanceKm from '../src/utils/haversine.js';

// In-memory cache: { "110020-560060": { estTime, distance, timestamp, source } }
const distanceCache = new Map();
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Configuration constants
const ROAD_DETOUR_FACTOR = 1.35; // Roads are ~35% longer than straight-line
const SANITY_CHECK_MULTIPLIER = 8; // Google shouldn't be >8× straight-line distance

/**
 * 🎯 SINGLE SOURCE OF TRUTH for Distance Calculation
 *
 * ⚠️ CRITICAL: This is the ONLY place distance calculation should be implemented.
 * ⚠️ DO NOT copy this function to other files
 * ⚠️ DO NOT create local distance calculation functions
 * ⚠️ ALWAYS import from this file
 *
 * STRATEGY:
 * 1. Use pincode_centroids.json for geocoding (pincode → lat/lng)
 * 2. For nearby pincodes (same first 2 digits): Use haversine × road factor (skip Google)
 * 3. For distant pincodes: Call Google Distance Matrix API with precise coordinates
 * 4. Sanity check: If Google result looks wrong, fallback to haversine
 * 5. Network fallback: If Google fails, use haversine × road factor
 *
 * @example
 * import { calculateDistanceBetweenPincode } from '../utils/distanceService.js';
 * const { estTime, distance, distanceKm, source } = await calculateDistanceBetweenPincode('110020', '560060');
 * // Returns: { estTime: "6", distance: "2100 km", distanceKm: 2100, source: "google-roads" }
 *
 * @param {string|number} originPincode - Origin pincode (e.g., "110020")
 * @param {string|number} destinationPincode - Destination pincode (e.g., "560060")
 * @returns {Promise<{estTime: string, distance: string, distanceKm: number, source: string}>}
 * @throws {Error} PINCODE_NOT_FOUND - Pincode doesn't exist in centroids database
 * @throws {Error} INVALID_PINCODE_FORMAT - Invalid pincode format
 */
export const calculateDistanceBetweenPincode = async (originPincode, destinationPincode) => {
  const origin = String(originPincode);
  const destination = String(destinationPincode);

  // Check cache first
  const cacheKey = `${origin}-${destination}`;
  const cached = distanceCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return {
      estTime: cached.estTime,
      distance: cached.distance,
      distanceKm: cached.distanceKm,
      source: cached.source
    };
  }

  // Validate pincode format
  const isValidFormat = (pin) => /^[1-9]\d{5}$/.test(pin);

  if (!isValidFormat(origin)) {
    const err = new Error(`Invalid origin pincode format: ${origin}. Must be 6 digits starting with 1-9.`);
    err.code = 'INVALID_PINCODE_FORMAT';
    err.field = 'origin';
    throw err;
  }
  if (!isValidFormat(destination)) {
    const err = new Error(`Invalid destination pincode format: ${destination}. Must be 6 digits starting with 1-9.`);
    err.code = 'INVALID_PINCODE_FORMAT';
    err.field = 'destination';
    throw err;
  }

  // Get coordinates from centroids (our single source of truth for geocoding)
  const originCoords = pinMap[origin];
  const destinationCoords = pinMap[destination];

  if (!originCoords) {
    const err = new Error(`Origin pincode ${origin} not found in centroids database`);
    err.code = 'PINCODE_NOT_FOUND';
    err.field = 'origin';
    throw err;
  }
  if (!destinationCoords) {
    const err = new Error(`Destination pincode ${destination} not found in centroids database`);
    err.code = 'PINCODE_NOT_FOUND';
    err.field = 'destination';
    throw err;
  }

  // Calculate straight-line distance using haversine
  const straightLineKm = haversineDistanceKm(
    originCoords.lat,
    originCoords.lng,
    destinationCoords.lat,
    destinationCoords.lng
  );

  // Check if pincodes are nearby (same first 2 digits = same region)
  const originPrefix = origin.substring(0, 2);
  const destPrefix = destination.substring(0, 2);
  const isNearby = originPrefix === destPrefix;

  // STRATEGY: For nearby pincodes (same city/region), skip Google to avoid 150km bug
  if (isNearby) {
    const roadDistanceKm = Math.round(straightLineKm * ROAD_DETOUR_FACTOR);
    const estTime = String(Math.max(1, Math.ceil(roadDistanceKm / 400)));

    const result = {
      estTime,
      distance: `${roadDistanceKm} km`,
      distanceKm: roadDistanceKm,
      source: 'centroid-nearby',
      timestamp: Date.now()
    };

    distanceCache.set(cacheKey, result);
    console.log(`📍 Nearby route: ${origin}→${destination} = ${roadDistanceKm} km (centroid-based, straight-line: ${straightLineKm.toFixed(1)} km)`);

    return {
      estTime: result.estTime,
      distance: result.distance,
      distanceKm: result.distanceKm,
      source: result.source
    };
  }

  // For distant pincodes, use Google with precise coordinates
  const key = process.env.GOOGLE_MAP_API_KEY;
  if (!key) {
    // No Google API key, fallback to haversine
    console.warn('⚠️ GOOGLE_MAP_API_KEY not configured, using haversine fallback');
    return createHaversineFallbackResult(origin, destination, straightLineKm);
  }

  try {
    // Call Google Distance Matrix API with COORDINATES (not pincode strings)
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originCoords.lat},${originCoords.lng}&destinations=${destinationCoords.lat},${destinationCoords.lng}&key=${key}&mode=driving`;
    const { data } = await axios.get(url, { timeout: 8000 });

    if (data.status !== 'OK') {
      console.warn(`⚠️ Google API status: ${data.status}, using haversine fallback`);
      return createHaversineFallbackResult(origin, destination, straightLineKm);
    }

    const element = data.rows?.[0]?.elements?.[0];
    if (!element) {
      console.warn('⚠️ No route data from Google, using haversine fallback');
      return createHaversineFallbackResult(origin, destination, straightLineKm);
    }

    // Handle no road route (e.g., islands) - throw error instead of fake distance
    if (element.status === 'ZERO_RESULTS' || element.status === 'NOT_FOUND') {
      // Known island pincode prefixes - genuinely no road access
      // 744xxx = Andaman & Nicobar
      // 68255x = Lakshadweep (approximate range 682551-682559)
      const isIsland = origin.startsWith('744') || destination.startsWith('744') ||
        (parseInt(origin, 10) >= 682551 && parseInt(origin, 10) <= 682559) ||
        (parseInt(destination, 10) >= 682551 && parseInt(destination, 10) <= 682559);

      if (isIsland) {
        // Genuine island - no road route is correct
        console.warn(`⚠️ No road route found by Google for island route ${origin}→${destination}`);
        const err = new Error(`No road route found between ${origin} and ${destination}`);
        err.code = 'NO_ROAD_ROUTE';
        throw err;
      }

      // Border area or remote region - Google is wrong/conservative, use haversine fallback
      // For border areas like J&K (19xxxx), 1.35x haversine is often very accurate (e.g. 193225 997km vs 1007km actual)
      console.warn(`⚠️ Google returned ${element.status} for ${origin}→${destination}, using haversine fallback (border/remote region)`);
      return createHaversineFallbackResult(origin, destination, straightLineKm);
    }

    if (element.status !== 'OK') {
      console.warn(`⚠️ Google route error: ${element.status}, using haversine fallback`);
      return createHaversineFallbackResult(origin, destination, straightLineKm);
    }

    const distanceMeters = element.distance?.value;
    if (!distanceMeters) {
      console.warn('⚠️ Distance not found in Google response, using haversine fallback');
      return createHaversineFallbackResult(origin, destination, straightLineKm);
    }

    const googleDistanceKm = Math.round(distanceMeters / 1000);

    // SANITY CHECK: Is Google being reasonable?
    const ratio = googleDistanceKm / straightLineKm;

    if (ratio > SANITY_CHECK_MULTIPLIER) {
      // Google is returning unrealistic distance (e.g., routing through wrong highway)
      console.warn(`⚠️ Google distance (${googleDistanceKm} km) is ${ratio.toFixed(1)}× straight-line (${straightLineKm.toFixed(1)} km) - suspiciously high, using haversine fallback`);
      return createHaversineFallbackResult(origin, destination, straightLineKm);
    }

    // Google result looks sane, use it
    const estTime = String(Math.max(1, Math.ceil(googleDistanceKm / 400)));
    const result = {
      estTime,
      distance: `${googleDistanceKm} km`,
      distanceKm: googleDistanceKm,
      source: 'google-roads',
      timestamp: Date.now()
    };

    distanceCache.set(cacheKey, result);
    console.log(`✅ Distance: ${origin}→${destination} = ${googleDistanceKm} km (Google, straight-line: ${straightLineKm.toFixed(1)} km, ratio: ${ratio.toFixed(2)}×)`);

    return {
      estTime: result.estTime,
      distance: result.distance,
      distanceKm: result.distanceKm,
      source: result.source
    };

  } catch (err) {
    // Re-throw NO_ROAD_ROUTE error - this is intentional, not a failure
    if (err.code === 'NO_ROAD_ROUTE') {
      throw err;
    }
    // Google API failed (network error, timeout, etc.)
    console.error(`❌ Google API error for ${origin}→${destination}: ${err.message}, using haversine fallback`);
    return createHaversineFallbackResult(origin, destination, straightLineKm);
  }
};

/**
 * Helper: Create result using haversine distance with road detour factor
 * @private
 */
function createHaversineFallbackResult(origin, destination, straightLineKm) {
  const roadDistanceKm = Math.round(straightLineKm * ROAD_DETOUR_FACTOR);
  const estTime = String(Math.max(1, Math.ceil(roadDistanceKm / 400)));

  const result = {
    estTime,
    distance: `${roadDistanceKm} km`,
    distanceKm: roadDistanceKm,
    source: 'centroid-fallback',
    timestamp: Date.now()
  };

  // Cache fallback results too (they're deterministic based on centroids)
  const cacheKey = `${origin}-${destination}`;
  distanceCache.set(cacheKey, result);

  console.log(`🔄 Fallback: ${origin}→${destination} = ${roadDistanceKm} km (haversine × ${ROAD_DETOUR_FACTOR}, straight-line: ${straightLineKm.toFixed(1)} km)`);

  return {
    estTime: result.estTime,
    distance: result.distance,
    distanceKm: result.distanceKm,
    source: result.source
  };
}

/**
 * Get coordinates for a pincode
 * @param {string|number} pincode - The pincode to get coordinates for
 * @returns {Object|null} Object with lat and lng, or null if not found
 */
export const getPincodeCoordinates = (pincode) => {
  const pincodeStr = String(pincode);
  return pinMap[pincodeStr] || null;
};
