/**
 * Smart Shield — Pricing Anomaly Detection Engine
 *
 * Validates every quote returned by the calculator and flags anything that
 * looks wrong, absurd, or inconsistent. Each check produces a severity:
 *
 *   "error"   — definitely wrong (e.g. negative total, NaN)
 *   "warning" — likely wrong (e.g. fuel > base freight, extreme outlier)
 *   "info"    — worth noting (e.g. minCharges kicked in)
 *
 * Usage:
 *   import { validateQuote, validateAllQuotes } from '../utils/smartShield.js';
 *   const flags = validateQuote(quote);
 *   // or
 *   const allFlags = validateAllQuotes(quotes);
 */

// ---------------------------------------------------------------------------
// Thresholds (tunable)
// ---------------------------------------------------------------------------
const THRESHOLDS = {
  // Price sanity
  MAX_UNIT_PRICE_PER_KG: 500,        // No carrier charges > ₹500/kg normally
  MIN_TOTAL_CHARGES: 50,              // Below ₹50 is suspicious for any shipment
  MAX_TOTAL_CHARGES: 5_000_000,       // Above ₹50 lakh is suspicious for LTL

  // Charge-to-base ratios (percentage of baseFreight)
  MAX_FUEL_RATIO: 0.50,              // Fuel > 50% of base is unusual
  MAX_ODA_RATIO: 1.00,               // ODA > 100% of base is unusual
  MAX_HANDLING_RATIO: 0.40,          // Handling > 40% of base is unusual
  MAX_ROV_RATIO: 0.30,               // ROV > 30% of base is unusual
  MAX_INSURANCE_RATIO: 0.20,         // Insurance > 20% of base is unusual
  MAX_MISC_RATIO: 0.30,              // Misc > 30% of base is unusual

  // Weight sanity
  MAX_VOLUMETRIC_ACTUAL_RATIO: 100,  // Vol weight > 100× actual is suspicious
  MIN_CHARGEABLE_WEIGHT: 0.01,       // Nearly-zero weight

  // Outlier detection (relative to cohort)
  OUTLIER_LOW_FACTOR: 0.20,          // Quote < 20% of median = suspiciously cheap
  OUTLIER_HIGH_FACTOR: 5.0,          // Quote > 5× median = suspiciously expensive
};

// ---------------------------------------------------------------------------
// Individual quote validation
// ---------------------------------------------------------------------------

/**
 * Validate a single quote and return an array of anomaly flags.
 * @param {Object} quote - A pricing result (from tiedUpResult or companyResult)
 * @returns {{ flags: Array<{code: string, severity: string, message: string, field?: string, value?: any}>, score: number }}
 */
function validateQuote(quote) {
  const flags = [];
  const add = (code, severity, message, field, value) =>
    flags.push({ code, severity, message, field, value });

  if (!quote) {
    add('NULL_QUOTE', 'error', 'Quote object is null or undefined');
    return { flags, score: 0 };
  }

  const total = quote.totalCharges;
  const base = quote.baseFreight ?? quote.breakdown?.baseFreight ?? 0;
  const effectiveBase = quote.effectiveBaseFreight ?? quote.breakdown?.effectiveBaseFreight ?? base;
  const chargeableWeight = quote.chargeableWeight ?? 0;
  const actualWeight = quote.actualWeight ?? 0;
  const volumetricWeight = quote.volumetricWeight ?? 0;
  const unitPrice = quote.unitPrice ?? 0;

  // ---- 1. CRITICAL: NaN / undefined / negative checks ----
  if (total === undefined || total === null || isNaN(total)) {
    add('NAN_TOTAL', 'error', 'Total charges is NaN or missing', 'totalCharges', total);
  }
  if (typeof total === 'number' && total < 0) {
    add('NEGATIVE_TOTAL', 'error', `Total charges is negative: ₹${total}`, 'totalCharges', total);
  }
  if (typeof base === 'number' && base < 0) {
    add('NEGATIVE_BASE', 'error', `Base freight is negative: ₹${base}`, 'baseFreight', base);
  }

  // ---- 2. WEIGHT CONSISTENCY ----
  const expectedChargeable = Math.max(actualWeight, volumetricWeight);
  if (chargeableWeight > 0 && expectedChargeable > 0) {
    const diff = Math.abs(chargeableWeight - expectedChargeable);
    if (diff > 0.5 && diff / expectedChargeable > 0.01) {
      add('WEIGHT_MISMATCH', 'warning',
        `Chargeable weight (${chargeableWeight}kg) ≠ max(actual=${actualWeight}, vol=${volumetricWeight} = ${expectedChargeable}kg)`,
        'chargeableWeight', { chargeableWeight, actualWeight, volumetricWeight, expected: expectedChargeable });
    }
  }

  if (volumetricWeight > 0 && actualWeight > 0 && volumetricWeight / actualWeight > THRESHOLDS.MAX_VOLUMETRIC_ACTUAL_RATIO) {
    add('EXTREME_VOLUMETRIC', 'warning',
      `Volumetric weight (${volumetricWeight}kg) is ${Math.round(volumetricWeight / actualWeight)}× actual weight (${actualWeight}kg) — possibly incorrect dimensions`,
      'volumetricWeight', { volumetricWeight, actualWeight, ratio: volumetricWeight / actualWeight });
  }

  if (chargeableWeight < THRESHOLDS.MIN_CHARGEABLE_WEIGHT && chargeableWeight >= 0) {
    add('NEAR_ZERO_WEIGHT', 'warning',
      `Chargeable weight is near zero: ${chargeableWeight}kg`,
      'chargeableWeight', chargeableWeight);
  }

  // ---- 3. MIN CHARGES FLOOR ----
  if (effectiveBase > base && base > 0) {
    add('MIN_CHARGES_APPLIED', 'info',
      `Minimum charges applied: base ₹${base} → effective ₹${effectiveBase}`,
      'effectiveBaseFreight', { baseFreight: base, effectiveBaseFreight: effectiveBase });
  }

  // ---- 4. UNIT PRICE SANITY ----
  if (unitPrice > THRESHOLDS.MAX_UNIT_PRICE_PER_KG) {
    add('HIGH_UNIT_PRICE', 'warning',
      `Unit price ₹${unitPrice}/kg exceeds ₹${THRESHOLDS.MAX_UNIT_PRICE_PER_KG}/kg threshold`,
      'unitPrice', unitPrice);
  }
  if (unitPrice === 0 && total > 0) {
    add('ZERO_UNIT_PRICE', 'warning',
      `Unit price is ₹0 but total is ₹${total} — pricing from fixed charges only`,
      'unitPrice', unitPrice);
  }

  // ---- 5. TOTAL SANITY ----
  if (typeof total === 'number' && total > 0) {
    if (total < THRESHOLDS.MIN_TOTAL_CHARGES) {
      add('SUSPICIOUSLY_CHEAP', 'warning',
        `Total ₹${total} is below ₹${THRESHOLDS.MIN_TOTAL_CHARGES} — unusually cheap`,
        'totalCharges', total);
    }
    if (total > THRESHOLDS.MAX_TOTAL_CHARGES) {
      add('SUSPICIOUSLY_EXPENSIVE', 'warning',
        `Total ₹${total} exceeds ₹${THRESHOLDS.MAX_TOTAL_CHARGES} — unusually expensive for LTL`,
        'totalCharges', total);
    }
  }

  // ---- 6. CHARGE-TO-BASE RATIOS ----
  if (base > 0) {
    const checkRatio = (field, label, threshold) => {
      const val = quote[field] ?? quote.breakdown?.[field] ?? 0;
      if (val > 0 && val / base > threshold) {
        add('HIGH_' + field.toUpperCase(), 'warning',
          `${label} ₹${Math.round(val)} is ${Math.round(val / base * 100)}% of base freight ₹${Math.round(base)} (threshold: ${threshold * 100}%)`,
          field, { value: val, base, ratio: val / base });
      }
    };

    checkRatio('fuelCharges', 'Fuel charges', THRESHOLDS.MAX_FUEL_RATIO);
    checkRatio('odaCharges', 'ODA charges', THRESHOLDS.MAX_ODA_RATIO);
    checkRatio('handlingCharges', 'Handling charges', THRESHOLDS.MAX_HANDLING_RATIO);
    checkRatio('rovCharges', 'ROV charges', THRESHOLDS.MAX_ROV_RATIO);
    checkRatio('insuaranceCharges', 'Insurance charges', THRESHOLDS.MAX_INSURANCE_RATIO);
    checkRatio('miscCharges', 'Misc charges', THRESHOLDS.MAX_MISC_RATIO);
  }

  // ---- 7. ZERO BASE BUT NON-ZERO CHARGES ----
  if (base === 0 && total > 0) {
    const fixedTotal = (quote.docketCharge || 0) + (quote.greenTax || 0) +
      (quote.daccCharges || 0) + (quote.miscCharges || 0);
    if (fixedTotal === 0) {
      add('PHANTOM_CHARGES', 'error',
        `Total is ₹${total} but base freight and all fixed charges are ₹0 — charges appear from nowhere`,
        'totalCharges', total);
    }
  }

  // ---- 8. TOTAL RECONCILIATION ----
  // Check that the sum of parts approximately equals totalCharges
  if (typeof total === 'number' && total > 0) {
    const reconstructed =
      (effectiveBase || 0) +
      (quote.docketCharge ?? quote.breakdown?.docketCharge ?? 0) +
      (quote.greenTax ?? quote.breakdown?.greenTax ?? 0) +
      (quote.daccCharges ?? quote.breakdown?.daccCharges ?? 0) +
      (quote.miscCharges ?? quote.breakdown?.miscCharges ?? 0) +
      (quote.fuelCharges ?? quote.breakdown?.fuelCharges ?? 0) +
      (quote.rovCharges ?? quote.breakdown?.rovCharges ?? 0) +
      (quote.insuaranceCharges ?? quote.breakdown?.insuaranceCharges ?? 0) +
      (quote.odaCharges ?? quote.breakdown?.odaCharges ?? 0) +
      (quote.handlingCharges ?? quote.breakdown?.handlingCharges ?? 0) +
      (quote.fmCharges ?? quote.breakdown?.fmCharges ?? 0) +
      (quote.appointmentCharges ?? quote.breakdown?.appointmentCharges ?? 0) +
      (quote.invoiceAddon ?? quote.invoiceValueCharge ?? quote.breakdown?.invoiceValueCharges ?? 0);

    const diff = Math.abs(total - reconstructed);
    if (diff > 2 && diff / total > 0.01) { // >1% drift or >₹2
      add('TOTAL_MISMATCH', 'warning',
        `Reported total ₹${total} differs from sum-of-parts ₹${Math.round(reconstructed)} by ₹${Math.round(diff)}`,
        'totalCharges', { reported: total, reconstructed: Math.round(reconstructed), diff: Math.round(diff) });
    }
  }

  // ---- 9. MISSING VENDOR IDENTITY ----
  if (!quote.companyName && !quote.companyId && !quote._id) {
    add('NO_VENDOR_ID', 'error', 'Quote has no vendor identifier (companyName, companyId, _id)', null, null);
  }

  // Compute a health score (1.0 = perfect, 0 = fully broken)
  const errorCount = flags.filter(f => f.severity === 'error').length;
  const warningCount = flags.filter(f => f.severity === 'warning').length;
  const score = Math.max(0, 1.0 - (errorCount * 0.3) - (warningCount * 0.1));

  return { flags, score: Math.round(score * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Cohort-level validation (detects outliers across multiple quotes)
// ---------------------------------------------------------------------------

/**
 * Validate all quotes for a route and detect cross-quote anomalies (outliers).
 * @param {Array} quotes - Array of pricing results
 * @returns {{ quoteResults: Array, cohortFlags: Array, overallScore: number }}
 */
function validateAllQuotes(quotes) {
  if (!Array.isArray(quotes) || quotes.length === 0) {
    return {
      quoteResults: [], cohortFlags: [], overallScore: 1.0,
      summary: { totalQuotes: 0, errors: 0, warnings: 0, infos: 0, cleanQuotes: 0 }
    };
  }

  // 1. Validate each quote individually
  const quoteResults = quotes.map((q, i) => {
    const result = validateQuote(q);
    return {
      index: i,
      companyName: q.companyName || q._id || `Quote ${i}`,
      totalCharges: q.totalCharges,
      ...result
    };
  });

  // 2. Cohort-level outlier detection
  const cohortFlags = [];
  const validTotals = quotes
    .map(q => q.totalCharges)
    .filter(t => typeof t === 'number' && t > 0 && isFinite(t));

  if (validTotals.length >= 3) {
    validTotals.sort((a, b) => a - b);
    const median = validTotals[Math.floor(validTotals.length / 2)];

    quotes.forEach((q, i) => {
      const t = q.totalCharges;
      if (typeof t !== 'number' || !isFinite(t) || t <= 0) return;

      if (t < median * THRESHOLDS.OUTLIER_LOW_FACTOR) {
        cohortFlags.push({
          code: 'OUTLIER_CHEAP',
          severity: 'warning',
          message: `"${q.companyName}" at ₹${Math.round(t)} is ${Math.round(t / median * 100)}% of median ₹${Math.round(median)} — suspiciously cheap`,
          quoteIndex: i,
          companyName: q.companyName,
          value: { total: t, median, ratio: t / median }
        });
      }

      if (t > median * THRESHOLDS.OUTLIER_HIGH_FACTOR) {
        cohortFlags.push({
          code: 'OUTLIER_EXPENSIVE',
          severity: 'warning',
          message: `"${q.companyName}" at ₹${Math.round(t)} is ${(t / median).toFixed(1)}× median ₹${Math.round(median)} — suspiciously expensive`,
          quoteIndex: i,
          companyName: q.companyName,
          value: { total: t, median, ratio: t / median }
        });
      }
    });
  }

  // 3. Overall health score
  const totalErrors = quoteResults.reduce((s, q) => s + q.flags.filter(f => f.severity === 'error').length, 0);
  const totalWarnings = quoteResults.reduce((s, q) => s + q.flags.filter(f => f.severity === 'warning').length, 0)
    + cohortFlags.filter(f => f.severity === 'warning').length;
  const overallScore = Math.max(0, 1.0 - (totalErrors * 0.15) - (totalWarnings * 0.05));

  return {
    quoteResults,
    cohortFlags,
    overallScore: Math.round(overallScore * 100) / 100,
    summary: {
      totalQuotes: quotes.length,
      errors: totalErrors,
      warnings: totalWarnings,
      infos: quoteResults.reduce((s, q) => s + q.flags.filter(f => f.severity === 'info').length, 0),
      cleanQuotes: quoteResults.filter(q => q.flags.filter(f => f.severity !== 'info').length === 0).length,
    }
  };
}

export { validateQuote, validateAllQuotes, THRESHOLDS };
