/**
 * Validation utilities for FreightCompare backend
 */

/**
 * Validates zone code format
 * Valid zones: N1-N6, S1-S6, E1-E4, W1-W4, NE1-NE4, C1-C4, X1-X3 (special zones)
 */
export const validateZoneCode = (zoneCode) => {
  if (typeof zoneCode !== "string") return false;

  const zonePattern = /^(N[1-6]|S[1-6]|E[1-4]|W[1-4]|NE[1-4]|C[1-4]|X[1-3])$/;
  return zonePattern.test(zoneCode.toUpperCase());
};

/**
 * Validates zone matrix structure
 * @param {Object} priceChart - Zone price matrix
 * @param {Array<string>} selectedZones - Array of selected zone codes
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export const validateZoneMatrix = (priceChart, selectedZones) => {
  const errors = [];

  if (!priceChart || typeof priceChart !== "object") {
    errors.push("Price chart must be an object");
    return { valid: false, errors };
  }

  if (!Array.isArray(selectedZones) || selectedZones.length === 0) {
    errors.push("Selected zones must be a non-empty array");
    return { valid: false, errors };
  }

  // Validate all zone codes
  const invalidZones = selectedZones.filter((zone) => !validateZoneCode(zone));
  if (invalidZones.length > 0) {
    errors.push(`Invalid zone codes: ${invalidZones.join(", ")}`);
  }

  // Check all zones have entries
  for (const fromZone of selectedZones) {
    if (!priceChart[fromZone]) {
      errors.push(`Missing price chart entry for zone: ${fromZone}`);
      continue;
    }

    if (typeof priceChart[fromZone] !== "object") {
      errors.push(`Price chart entry for ${fromZone} must be an object`);
      continue;
    }

    // Check all destination zones have prices
    for (const toZone of selectedZones) {
      const price = priceChart[fromZone][toZone];

      if (price === undefined || price === null) {
        errors.push(`Missing price for route ${fromZone} → ${toZone}`);
        continue;
      }

      if (typeof price !== "number") {
        errors.push(`Price for ${fromZone} → ${toZone} must be a number`);
        continue;
      }

      if (price < 0) {
        errors.push(`Price for ${fromZone} → ${toZone} cannot be negative`);
        continue;
      }

      if (price > 999999) {
        errors.push(`Price for ${fromZone} → ${toZone} exceeds maximum (999999)`);
        continue;
      }

      if (!isFinite(price)) {
        errors.push(`Price for ${fromZone} → ${toZone} must be a finite number`);
        continue;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Validates distance-weight matrix structure
 * @param {Array} matrix - Distance-weight matrix entries
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export const validateDistanceWeightMatrix = (matrix) => {
  const errors = [];

  if (!Array.isArray(matrix)) {
    errors.push("Matrix must be an array");
    return { valid: false, errors };
  }

  if (matrix.length === 0) {
    errors.push("Matrix cannot be empty");
    return { valid: false, errors };
  }

  const seenCombinations = new Set();

  for (let i = 0; i < matrix.length; i++) {
    const entry = matrix[i];

    if (!entry || typeof entry !== "object") {
      errors.push(`Entry at index ${i} must be an object`);
      continue;
    }

    if (!entry.weightRange || typeof entry.weightRange !== "string") {
      errors.push(`Entry at index ${i} must have a valid weightRange`);
      continue;
    }

    if (!entry.distanceRange || typeof entry.distanceRange !== "string") {
      errors.push(`Entry at index ${i} must have a valid distanceRange`);
      continue;
    }

    // Check for duplicates
    const combination = `${entry.weightRange}-${entry.distanceRange}`;
    if (seenCombinations.has(combination)) {
      errors.push(`Duplicate entry: ${combination}`);
      continue;
    }
    seenCombinations.add(combination);

    // Validate price
    if (entry.price === undefined || entry.price === null) {
      // Allow null prices (not yet set)
      continue;
    }

    if (typeof entry.price !== "number") {
      errors.push(`Price for ${combination} must be a number`);
      continue;
    }

    if (entry.price < 0) {
      errors.push(`Price for ${combination} cannot be negative`);
      continue;
    }

    if (!isFinite(entry.price)) {
      errors.push(`Price for ${combination} must be a finite number`);
      continue;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Validates ODA entries
 * @param {Array} odaEntries - Array of ODA entries
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export const validateODAEntries = (odaEntries) => {
  const errors = [];

  if (!Array.isArray(odaEntries)) {
    errors.push("ODA entries must be an array");
    return { valid: false, errors };
  }

  const seenPincodes = new Set();

  for (let i = 0; i < odaEntries.length; i++) {
    const entry = odaEntries[i];

    if (!entry || typeof entry !== "object") {
      errors.push(`ODA entry at index ${i} must be an object`);
      continue;
    }

    if (!entry.pincode || typeof entry.pincode !== "string") {
      errors.push(`ODA entry at index ${i} must have a valid pincode`);
      continue;
    }

    // Validate pincode format (6 digits)
    if (!/^\d{6}$/.test(entry.pincode)) {
      errors.push(`Invalid pincode format at index ${i}: ${entry.pincode}`);
      continue;
    }

    // Check for duplicates
    if (seenPincodes.has(entry.pincode)) {
      errors.push(`Duplicate pincode: ${entry.pincode}`);
      continue;
    }
    seenPincodes.add(entry.pincode);

    if (typeof entry.isOda !== "boolean") {
      errors.push(`isOda at index ${i} must be a boolean`);
      continue;
    }

    if (!entry.zone || typeof entry.zone !== "string") {
      errors.push(`Zone at index ${i} must be a valid string`);
      continue;
    }

    if (!validateZoneCode(entry.zone)) {
      errors.push(`Invalid zone code at index ${i}: ${entry.zone}`);
      continue;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Sanitizes zone code (uppercase, trim)
 */
export const sanitizeZoneCode = (zoneCode) => {
  if (typeof zoneCode !== "string") return null;
  return zoneCode.trim().toUpperCase();
};

/**
 * Sanitizes array of zone codes
 */
export const sanitizeZoneCodes = (zoneCodes) => {
  if (!Array.isArray(zoneCodes)) return [];
  return zoneCodes
    .map((code) => sanitizeZoneCode(code))
    .filter((code) => code !== null);
};

/**
 * Validates GSTIN format
 */
export const validateGSTIN = (gstin) => {
  if (typeof gstin !== "string") return false;
  const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;
  return gstinPattern.test(gstin.trim());
};

/**
 * Validates email format
 */
export const validateEmail = (email) => {
  if (typeof email !== "string") return false;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email.trim());
};

/**
 * Validates phone number (10 digits, doesn't start with 0)
 */
export const validatePhone = (phone) => {
  if (typeof phone === "number") {
    phone = String(phone);
  }
  if (typeof phone !== "string") return false;
  const phonePattern = /^[1-9][0-9]{9}$/;
  return phonePattern.test(phone.replace(/\D/g, ""));
};

/**
 * Validates pincode (6 digits)
 */
export const validatePincode = (pincode) => {
  if (typeof pincode === "number") {
    pincode = String(pincode);
  }
  if (typeof pincode !== "string") return false;
  return /^\d{6}$/.test(pincode.trim());
};

/**
 * Sanitizes string input (trim, remove extra spaces)
 */
export const sanitizeString = (str, maxLength = null) => {
  if (typeof str !== "string") return "";
  let sanitized = str.trim().replace(/\s+/g, " ");
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  return sanitized;
};

