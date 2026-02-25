/**
 * Invoice Charge Calculator Utility
 * Handles calculation of invoice value based charges for transporters
 */

/**
 * Calculate invoice value based charges for a transporter
 * @param {number} invoiceValue - Customer's shipment invoice value
 * @param {object} invoiceCharges - Transporter's invoice charge settings
 * @returns {object} - Calculated charge with detailed breakdown
 */
export const calculateInvoiceCharge = (invoiceValue, invoiceCharges) => {
  // If not enabled or no invoice value, return 0
  if (!invoiceCharges?.enabled || !invoiceValue || invoiceValue <= 0) {
    return {
      charge: 0,
      breakdown: null,
    };
  }

  const { percentage, minimumAmount } = invoiceCharges;

  // Calculate percentage-based charge
  const percentageCharge = (invoiceValue * percentage) / 100;

  // Take maximum of percentage charge or minimum amount
  const finalCharge = Math.max(percentageCharge, minimumAmount || 0);

  // Determine if minimum was applied
  const isMinimumApplied = finalCharge === minimumAmount && percentageCharge < minimumAmount;

  return {
    charge: parseFloat(finalCharge.toFixed(2)),
    breakdown: {
      invoiceValue: parseFloat(invoiceValue.toFixed(2)),
      percentage: percentage,
      percentageCharge: parseFloat(percentageCharge.toFixed(2)),
      minimumAmount: minimumAmount || 0,
      isMinimumApplied: isMinimumApplied,
      finalCharge: parseFloat(finalCharge.toFixed(2)),
      description: invoiceCharges.description || 'Invoice Value Handling Charges',
    },
  };
};

/**
 * Validate invoice charge settings
 * @param {object} invoiceCharges - Invoice charge settings to validate
 * @returns {object} - Validation result with errors if any
 */
export const validateInvoiceChargeSettings = (invoiceCharges) => {
  const errors = [];

  if (!invoiceCharges) {
    errors.push('Invoice charge settings are required');
    return {
      isValid: false,
      errors: errors,
    };
  }

  if (invoiceCharges.enabled) {
    if (typeof invoiceCharges.percentage !== 'number' || invoiceCharges.percentage < 0 || invoiceCharges.percentage > 100) {
      errors.push('Percentage must be a number between 0 and 100');
    }

    if (typeof invoiceCharges.minimumAmount !== 'number' || invoiceCharges.minimumAmount < 0) {
      errors.push('Minimum amount must be a non-negative number');
    }

    if (invoiceCharges.percentage === 0 && invoiceCharges.minimumAmount === 0) {
      errors.push('Either percentage or minimum amount must be greater than 0 when enabled');
    }
  }

  return {
    isValid: errors.length === 0,
    errors: errors,
  };
};

/**
 * Calculate invoice charges for multiple transporters
 * Useful for comparison views
 * @param {number} invoiceValue - Customer's invoice value
 * @param {array} transporters - Array of transporter objects
 * @returns {array} - Array with calculated charges for each transporter
 */
export const calculateInvoiceChargesForMultiple = (invoiceValue, transporters) => {
  if (!Array.isArray(transporters) || transporters.length === 0) {
    return [];
  }

  return transporters.map(transporter => {
    const result = calculateInvoiceCharge(invoiceValue, transporter.invoiceValueCharges);
    
    return {
      transporterId: transporter._id,
      transporterName: transporter.companyName,
      vendorCode: transporter.vendorCode,
      invoiceCharge: result.charge,
      invoiceChargeBreakdown: result.breakdown,
    };
  });
};

/**
 * Generate example calculation for preview
 * @param {object} invoiceCharges - Invoice charge settings
 * @param {number} sampleInvoiceValue - Sample invoice value for preview (default: 10000)
 * @returns {object} - Example calculation
 */
export const generateExampleCalculation = (invoiceCharges, sampleInvoiceValue = 10000) => {
  if (!invoiceCharges?.enabled) {
    return null;
  }

  const percentageCharge = (sampleInvoiceValue * invoiceCharges.percentage) / 100;
  const finalCharge = Math.max(percentageCharge, invoiceCharges.minimumAmount || 0);
  const isMinimumApplied = finalCharge === invoiceCharges.minimumAmount && percentageCharge < invoiceCharges.minimumAmount;

  return {
    sampleInvoiceValue,
    percentage: invoiceCharges.percentage,
    percentageCharge: parseFloat(percentageCharge.toFixed(2)),
    minimumAmount: invoiceCharges.minimumAmount || 0,
    finalCharge: parseFloat(finalCharge.toFixed(2)),
    isMinimumApplied,
    explanation: isMinimumApplied
      ? `Minimum charge of ₹${invoiceCharges.minimumAmount} applied (higher than ${invoiceCharges.percentage}% of ₹${sampleInvoiceValue})`
      : `${invoiceCharges.percentage}% of ₹${sampleInvoiceValue} = ₹${percentageCharge.toFixed(2)}`,
  };
};