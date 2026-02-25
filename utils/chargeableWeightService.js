/**
 * Chargeable Weight Calculation Service
 * 
 * Calculates chargeable weight based on:
 * - Actual Weight: Sum of (Box Weight × Quantity)
 * - Volumetric Weight: (L × W × H × Quantity) ÷ kFactor
 * - Chargeable Weight: Maximum of Actual vs Volumetric Weight
 * 
 * kFactor = 5000 for all modes (as per requirement)
 */

/**
 * Calculate chargeable weight for shipment details
 * @param {Array} shipmentDetails - Array of box objects with weight, length, width, height, count
 * @param {number} kFactor - Volumetric divisor (default: 5000)
 * @returns {Object} Weight breakdown object
 */
function calculateChargeableWeight(shipmentDetails, kFactor = 5000) {
  try {
    // Calculate actual weight
    const actualWeight = shipmentDetails.reduce(
      (sum, box) => sum + (box.weight || 0) * (box.count || 0),
      0
    );

    // Calculate volumetric weight
    const volumetricWeight = shipmentDetails.reduce(
      (sum, box) => {
        const volume = (box.length || 0) * (box.width || 0) * (box.height || 0) * (box.count || 0);
        return sum + (volume / kFactor);
      },
      0
    );

    // Chargeable weight is the higher of actual weight and volumetric weight
    const chargeableWeight = Math.max(actualWeight, volumetricWeight);

    return {
      actualWeight: parseFloat(actualWeight.toFixed(2)),
      volumetricWeight: parseFloat(volumetricWeight.toFixed(2)),
      chargeableWeight: parseFloat(chargeableWeight.toFixed(2)),
      kFactor: kFactor,
      weightType: actualWeight > volumetricWeight ? 'actual' : 'volumetric'
    };
  } catch (error) {
    console.error('Error calculating chargeable weight:', error);
    throw new Error('Failed to calculate chargeable weight');
  }
}

/**
 * Calculate chargeable weight for a single box
 * @param {Object} box - Box object with weight, length, width, height, count
 * @param {number} kFactor - Volumetric divisor (default: 5000)
 * @returns {Object} Weight breakdown object
 */
function calculateSingleBoxChargeableWeight(box, kFactor = 5000) {
  try {
    const actualWeight = (box.weight || 0) * (box.count || 0);
    const volume = (box.length || 0) * (box.width || 0) * (box.height || 0) * (box.count || 0);
    const volumetricWeight = volume / kFactor;
    const chargeableWeight = Math.max(actualWeight, volumetricWeight);

    return {
      actualWeight: parseFloat(actualWeight.toFixed(2)),
      volumetricWeight: parseFloat(volumetricWeight.toFixed(2)),
      chargeableWeight: parseFloat(chargeableWeight.toFixed(2)),
      kFactor: kFactor,
      weightType: actualWeight > volumetricWeight ? 'actual' : 'volumetric'
    };
  } catch (error) {
    console.error('Error calculating single box chargeable weight:', error);
    throw new Error('Failed to calculate single box chargeable weight');
  }
}

/**
 * Validate shipment details for weight calculation
 * @param {Array} shipmentDetails - Array of box objects
 * @returns {object} Validation result with isValid flag and error message
 * 
 * VALIDATION RULES:
 * - length, width, height must be > 0 (positive, prevents volumetric bypass)
 * - weight must be >= 0 (non-negative)
 * - count must be > 0 (at least 1 box)
 */
function validateShipmentDetails(shipmentDetails) {
  if (!Array.isArray(shipmentDetails)) {
    return { isValid: false, error: 'shipment_details must be an array' };
  }

  if (shipmentDetails.length === 0) {
    return { isValid: false, error: 'shipment_details cannot be empty' };
  }

  for (let i = 0; i < shipmentDetails.length; i++) {
    const box = shipmentDetails[i];
    const boxNum = i + 1;

    if (typeof box !== 'object' || box === null) {
      return { isValid: false, error: `Box ${boxNum}: must be an object` };
    }

    // Length must be positive (> 0)
    if (typeof box.length !== 'number' || box.length <= 0) {
      return { isValid: false, error: `Box ${boxNum}: length must be a positive number (got ${box.length})` };
    }

    // Width must be positive (> 0)
    if (typeof box.width !== 'number' || box.width <= 0) {
      return { isValid: false, error: `Box ${boxNum}: width must be a positive number (got ${box.width})` };
    }

    // Height must be positive (> 0)
    if (typeof box.height !== 'number' || box.height <= 0) {
      return { isValid: false, error: `Box ${boxNum}: height must be a positive number (got ${box.height})` };
    }

    // Weight must be non-negative (>= 0)
    if (typeof box.weight !== 'number' || box.weight < 0) {
      return { isValid: false, error: `Box ${boxNum}: weight must be a non-negative number (got ${box.weight})` };
    }

    // Count must be positive (> 0)
    if (typeof box.count !== 'number' || box.count <= 0 || !Number.isInteger(box.count)) {
      return { isValid: false, error: `Box ${boxNum}: count must be a positive integer (got ${box.count})` };
    }
  }

  return { isValid: true, error: null };
}

export {
  calculateChargeableWeight,
  calculateSingleBoxChargeableWeight,
  validateShipmentDetails
};
