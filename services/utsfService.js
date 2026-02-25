/**
 * UTSF Service - Universal Transporter Save Format
 *
 * Provides UTSF file loading, serviceability checks, and price calculation.
 * Port of Python decoder from freight-compare-tester/unified_format/utsf_decoder.py
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Coverage modes from UTSF schema (support both naming conventions)
const ZoneCoverageMode = {
  FULL_ZONE: 'FULL_ZONE',
  FULL_MINUS_EXCEPTIONS: 'FULL_MINUS_EXCEPTIONS',
  FULL_MINUS_EXCEPT: 'FULL_MINUS_EXCEPT',  // Alternate name used in UTSF files
  ONLY_SERVED: 'ONLY_SERVED',
  NOT_SERVED: 'NOT_SERVED'
};

// Check if a mode is a "full minus exceptions" variant
function isFullMinusMode(mode) {
  return mode === 'FULL_MINUS_EXCEPTIONS' || mode === 'FULL_MINUS_EXCEPT';
}

/**
 * Expand pincode ranges and singles into a Set of pincodes.
 * @param {Array<[number, number]> | Array<{s: number, e: number}>} ranges - Array of [start, end] tuples or {s, e} objects
 * @param {Array<number|string>} singles - Array of individual pincodes
 * @returns {Set<number>} Set of all pincodes (as Integers)
 */
function expandPincodeRanges(ranges = [], singles = []) {
  const pincodes = new Set();

  // Add singles - FORCE PARSEINT to prevent string/number mismatch bugs
  if (Array.isArray(singles)) {
    singles.forEach(pin => {
      const p = parseInt(pin, 10);
      if (!isNaN(p)) {
        pincodes.add(p);
      }
    });
  }

  // Expand ranges (handle both array [start, end] and object {s, e} formats)
  if (Array.isArray(ranges)) {
    ranges.forEach(range => {
      let start, end;
      if (Array.isArray(range)) {
        [start, end] = range;
      } else if (range && typeof range === 'object') {
        start = range.s;
        end = range.e;
      } else {
        return; // Skip invalid range
      }

      // Ensure range bounds are numbers
      start = parseInt(start, 10);
      end = parseInt(end, 10);

      if (!isNaN(start) && !isNaN(end)) {
        for (let pin = start; pin <= end; pin++) {
          pincodes.add(pin);
        }
      }
    });
  }

  return pincodes;
}

/**
 * UTSF Transporter class - provides O(1) lookups via pre-built indexes
 */
class UTSFTransporter {
  constructor(utsfData, masterPincodes = {}) {
    this._data = utsfData;
    this._masterPincodes = masterPincodes; // { pincode: zone }

    // Pre-built indexes for O(1) lookups
    this._servedPincodes = new Set();
    this._odaPincodes = new Set();
    this._exceptionPincodes = new Set();
    this._softExclusionPincodes = new Set(); // Temporary exclusions (auto-removable)
    this._zoneServedPincodes = {}; // { zone: Set<pincode> }

    // v3.0: Zone Override map for dual-lookup pricing
    this._zoneOverrideMap = new Map(); // pincode -> transporter's zone

    this._buildIndexes();
  }

  /**
   * Build fast lookup indexes from UTSF data
   */
  _buildIndexes() {
    const serviceability = this._data.serviceability || {};
    const odaData = this._data.oda || {};

    // 1. Build zone -> pincodes mapping from master
    const zoneToPincodes = {};
    Object.entries(this._masterPincodes).forEach(([pin, zone]) => {
      const pincode = parseInt(pin, 10);
      if (!isNaN(pincode)) {
        if (!zoneToPincodes[zone]) {
          zoneToPincodes[zone] = new Set();
        }
        zoneToPincodes[zone].add(pincode);
      }
    });

    // =========================================================================
    // FIX V5: RELAXED EXCEPTION GATHERING + ROBUST PROPERTY ACCESS
    // 1. Look for exceptions in ALL modes (even FULL_ZONE)
    // 2. Check both camelCase and snake_case properties
    // =========================================================================

    // PASS 1: Global Exception Gathering (ALL ZONES)
    Object.entries(serviceability).forEach(([zone, coverage]) => {
      // Robust access: Try camelCase, then snake_case
      const exceptRanges = coverage.exceptRanges || coverage.except_ranges || [];
      const exceptSingles = coverage.exceptSingles || coverage.except_singles || [];

      // If exceptions exist, add them regardless of the 'mode' label
      // This fixes cases where mode="FULL_ZONE" but data still has exceptions
      if (exceptRanges.length > 0 || exceptSingles.length > 0) {
        const exceptions = expandPincodeRanges(exceptRanges, exceptSingles);
        exceptions.forEach(pin => this._exceptionPincodes.add(pin));
      }

      // PASS 1b: Gather soft exclusions (temporary blocks, auto-removable)
      const softExclusions = coverage.softExclusions || [];
      if (softExclusions.length > 0) {
        softExclusions.forEach(pin => {
          const p = parseInt(pin, 10);
          if (!isNaN(p)) {
            this._exceptionPincodes.add(p); // Block them
            this._softExclusionPincodes.add(p); // Track as soft
          }
        });
      }
    });

    // PASS 2: Build Served List (Check against Global Exceptions)
    Object.entries(serviceability).forEach(([zone, coverage]) => {
      const mode = coverage.mode;
      this._zoneServedPincodes[zone] = new Set();

      let candidates = new Set();

      if (mode === ZoneCoverageMode.FULL_ZONE || isFullMinusMode(mode)) {
        // Check if vendor also provides an explicit served whitelist
        const servedRanges = coverage.servedRanges || coverage.served_ranges || [];
        const servedSingles = coverage.servedSingles || coverage.served_singles || [];

        if (servedSingles.length > 0 || servedRanges.length > 0) {
          // HYBRID: vendor provides a served whitelist alongside FULL_ZONE/FULL_MINUS_EXCEPT
          // Use ONLY the whitelist as candidates (not the entire zone from master)
          candidates = expandPincodeRanges(servedRanges, servedSingles);
        } else {
          // TRUE FULL_ZONE with no whitelist: all zone pincodes from master
          candidates = zoneToPincodes[zone] || new Set();
        }
      }
      else if (mode === ZoneCoverageMode.ONLY_SERVED) {
        // Robust access: Try camelCase, then snake_case
        const servedRanges = coverage.servedRanges || coverage.served_ranges || [];
        const servedSingles = coverage.servedSingles || coverage.served_singles || [];

        candidates = expandPincodeRanges(servedRanges, servedSingles);
      }

      // Add to official served lists ONLY if not in global exceptions
      candidates.forEach(pin => {
        if (!this._exceptionPincodes.has(pin)) {
          this._servedPincodes.add(pin);
          this._zoneServedPincodes[zone].add(pin);
        }
      });
    });

    // Build ODA index
    if (Array.isArray(this._data.odaPincodes)) {
      this._data.odaPincodes.forEach(p => this._odaPincodes.add(p));
    }
    Object.values(odaData).forEach(odaInfo => {
      // Robust access: Try camelCase, then snake_case
      const odaRanges = odaInfo.odaRanges || odaInfo.oda_ranges || [];
      const odaSingles = odaInfo.odaSingles || odaInfo.oda_singles || [];

      const odaPins = expandPincodeRanges(odaRanges, odaSingles);
      odaPins.forEach(pin => this._odaPincodes.add(pin));
    });

    // PASS 3: Build Zone Override Map (v3.0)
    const overrides = this._data.zoneOverrides || {};
    if (overrides instanceof Map) {
      for (const [pin, zone] of overrides.entries()) {
        this._zoneOverrideMap.set(Number(pin), zone);
      }
    } else if (typeof overrides === 'object') {
      Object.entries(overrides).forEach(([pin, zone]) => {
        this._zoneOverrideMap.set(Number(pin), zone);
      });
    }

    // v3.0 Legacy Detection
    if (!this._data.meta?.created || !this._data.meta?.version || !this._data.updates) {
      console.warn(`[UTSF] ⚠️ Legacy UTSF detected for "${this._data.meta?.companyName || 'UNKNOWN'}" — missing governance headers. Run repair to upgrade.`);
    }

    // BOOT-TIME DIAGNOSTIC: Log exception counts for verification
    console.log(`[UTSF-BOOT] "${this._data.meta?.companyName || 'UNKNOWN'}" | served=${this._servedPincodes.size} | exceptions=${this._exceptionPincodes.size} (soft=${this._softExclusionPincodes.size}) | integrityMode=${this._data.meta?.integrityMode || 'NONE'}`);
  }

  // Properties
  get id() { return this._data.meta?.id || ''; }
  get companyName() { return this._data.meta?.companyName || ''; }
  get customerID() { return this._data.meta?.customerID || null; }
  get transporterType() { return this._data.meta?.transporterType || 'regular'; }
  get rating() { return this._data.meta?.rating || 4.0; }
  get isVerified() { return this._data.meta?.isVerified || false; }

  /**
   * Get all serviceable pincodes for this transporter
   * Returns an array of numbers
   */
  getServedPincodes() {
    // Return array from the Set
    return Array.from(this._servedPincodes);
  }

  /** Get all soft-excluded pincodes (temporary blocks that can be auto-lifted) */
  getSoftExclusions() {
    return [...this._softExclusionPincodes];
  }
  get totalPincodes() { return this._data.stats?.totalPincodes || 0; }
  get priceRate() { return this._data.pricing?.priceRate || {}; }
  get zoneRates() { return this._data.pricing?.zoneRates || {}; }
  get stats() { return this._data.stats || {}; }
  get serviceability() { return this._data.serviceability || {}; }
  get data() { return this._data; }
  get complianceScore() { return this._data.stats?.complianceScore ?? 1.0; }
  get governanceVersion() { return this._data.meta?.version || 'legacy'; }
  get updates() { return this._data.updates || []; }
  get zoneOverrides() { return this._data.zoneOverrides || {}; }
  get isLegacy() { return !this._data.meta?.created || !this._data.meta?.version || !this._data.updates; }

  // Enhanced properties
  get vendorRatings() {
    return this._data.meta?.vendorRatings || null;
  }

  get volumetricConfig() {
    const pr = this.priceRate;
    return {
      unit: pr.volumetricUnit || 'cm',
      divisor: pr.divisor || 5000,
      kFactor: pr.kFactor || pr.divisor || 5000,
      cftFactor: pr.cftFactor || null
    };
  }

  get specialZones() {
    const special = {};
    const svc = this._data.serviceability || {};
    for (const zone of ['X1', 'X2', 'X3']) {
      if (svc[zone]) {
        special[zone] = {
          ...svc[zone],
          type: 'special',
          transportMode: zone === 'X3' ? 'road' : 'air_sea',
          remarks: zone === 'X1' ? 'Andaman & Nicobar' : zone === 'X2' ? 'Lakshadweep' : 'Leh Ladakh'
        };
      }
    }
    return Object.keys(special).length > 0 ? special : null;
  }

  /**
   * Check if pincode is serviceable (O(1) lookup)
   */
  isServiceable(pincode) {
    const pin = parseInt(pincode, 10);

    // 0. STRICT NUMBER VALIDATION
    if (isNaN(pin)) return false;

    // 1. PESSIMISTIC EXCEPTION CHECK (The "Number Trap" Fix)
    // Check for "No" before "Yes". If explicitly in exception list, BLOCK IT.
    if (this._exceptionPincodes.has(pin)) {
      // Diagnostic log for specific debugging
      console.log(`[UTSF-LOCKDOWN] Blocking Pincode ${pin} for "${this.companyName}": Found in exception list.`);
      return false;
    }

    // 2. v3.0 STRICT MODE: If integrityMode is STRICT, only allow explicitly served pincodes
    // This bypasses "FULL_ZONE" logic and relies 100% on the DNA of the raw file
    if (this._data.meta?.integrityMode === 'STRICT') {
      return this._servedPincodes.has(pin);
    }

    // 3. Legacy/Normal Mode: Allow if served OR if covered by zone rules
    // Note: _servedPincodes already filters out exceptions during build, but the explicit check above is safer.
    return this._servedPincodes.has(pin);
  }

  /**
   * Check if pincode is ODA
   */
  isOda(pincode) {
    return this._odaPincodes.has(parseInt(pincode, 10));
  }

  /**
   * Get zone for a pincode — DUAL LOOKUP (v3.0)
   * For pricing: use transporter's override zone if available
   * For routing: use master zone (returned as masterZone)
   */
  getZone(pincode) {
    const pin = parseInt(pincode, 10);
    return this._masterPincodes[pin] || null;
  }

  /**
   * Get the transporter's zone override for a pincode (v3.0)
   * Returns the transporter's mapped zone if different from master, else null
   */
  getTransporterZone(pincode) {
    const pin = parseInt(pincode, 10);
    return this._zoneOverrideMap.get(pin) || null;
  }

  /**
   * Get the effective zone for pricing (uses override if available, else master)
   */
  getEffectiveZone(pincode) {
    const pin = parseInt(pincode, 10);
    return this._zoneOverrideMap.get(pin) || this._masterPincodes[pin] || null;
  }

  /**
   * Full serviceability check with details
   */
  checkServiceability(pincode) {
    const pin = parseInt(pincode, 10);
    const zone = this.getZone(pin);

    // =========================================================
    // 🛠️ DIAGNOSTIC LOG (Triggers ONLY for your specific pincodes)
    // =========================================================
    if (pin === 110020 || pin === 123304 || pin === 765011) {
      const isServed = this._servedPincodes.has(pin);
      const isGlobalException = this._exceptionPincodes.has(pin);
      const coverage = zone ? (this._data.serviceability?.[zone] || {}) : 'NO_ZONE_DATA';
      const exceptRanges = coverage.exceptRanges || coverage.except_ranges || [];
      const exceptSingles = coverage.exceptSingles || coverage.except_singles || [];

      console.log(`[UTSF DIAG] ${this.companyName} checking ${pin}:`);
      console.log(`  -> Zone in Master: ${zone}`);
      console.log(`  -> Mode: ${coverage.mode}`);
      console.log(`  -> Exceptions Found in JSON? ${exceptRanges.length > 0 || exceptSingles.length > 0}`);
      console.log(`  -> Is Global Exception? ${isGlobalException}`);
      console.log(`  -> Final Result: ${isServed ? 'SERVED' : 'NOT SERVED'}`);
    }
    // =========================================================

    if (!zone) {
      return {
        isServiceable: false,
        zone: null,
        isOda: false,
        coveragePercent: 0,
        reason: 'Pincode not found in master database'
      };
    }

    const isServed = this._servedPincodes.has(pin);
    const isOda = this._odaPincodes.has(pin);

    const coverage = this._data.serviceability?.[zone] || {};
    const coveragePercent = coverage.coveragePercent || 0;

    // v3.0: Check for zone override
    const transporterZone = this._zoneOverrideMap.get(pin) || null;

    let reason;
    if (isServed) {
      reason = `Served in zone ${zone}`;
      if (isOda) reason += ' (ODA)';
      if (transporterZone && transporterZone !== zone) {
        reason += ` [Override: transporter maps to ${transporterZone}]`;
      }
    } else {
      const mode = coverage.mode || 'NOT_SERVED';
      if (mode === ZoneCoverageMode.NOT_SERVED) {
        reason = `Zone ${zone} not served by this transporter`;
      } else if (isFullMinusMode(mode)) {
        reason = `Pincode is an exception in zone ${zone}`;
      } else {
        reason = `Pincode not in served list for zone ${zone}`;
      }
    }

    return {
      isServiceable: isServed,
      zone,
      transporterZone,
      isOda,
      coveragePercent,
      reason
    };
  }

  /**
   * Get zone rate (price per kg)
   */
  getZoneRate(originZone, destZone) {
    const origin = originZone.toUpperCase();
    const dest = destZone.toUpperCase();

    return this.zoneRates[origin]?.[dest] || null;
  }

  /**
   * Calculate price for a route
   * Matches transportController.js calculation exactly (lines 782-841)
   */
  calculatePrice(fromPincode, toPincode, chargeableWeight, invoiceValue = 0) {
    const fromResult = this.checkServiceability(fromPincode);
    const toResult = this.checkServiceability(toPincode);

    if (!fromResult.isServiceable) {
      console.warn(`[UTSF PRICING FAIL] Transporter "${this.companyName}" (${this.id}) rejected: Origin unserviceable (${fromPincode} - ${fromResult.reason})`);
      return { error: `Origin ${fromPincode}: ${fromResult.reason}` };
    }

    if (!toResult.isServiceable) {
      console.warn(`[UTSF PRICING FAIL] Transporter "${this.companyName}" (${this.id}) rejected: Destination unserviceable (${toPincode} - ${toResult.reason})`);
      return { error: `Destination ${toPincode}: ${toResult.reason}` };
    }

    // Use transporter zone overrides for rate lookup if available (v3.0)
    // This ensures per-pincode rates (e.g., Safexpress W2_13 = ₹13/kg) are used
    // instead of the master zone rate (e.g., W2 = ₹14/kg)
    const originZone = fromResult.transporterZone || fromResult.zone;
    const destZone = toResult.transporterZone || toResult.zone;
    let unitPrice = this.getZoneRate(originZone, destZone);

    // Fallback: if override zone combo has no rate, try master zones
    if (unitPrice === null && (fromResult.transporterZone || toResult.transporterZone)) {
      unitPrice = this.getZoneRate(fromResult.zone, toResult.zone);
    }

    if (unitPrice === null) {
      console.warn(`[UTSF PRICING FAIL] Transporter "${this.companyName}" (${this.id}) rejected: No rate matrix found for zone combination ${originZone} -> ${destZone}`);
      return { error: `No rate for zone combination ${originZone} -> ${destZone}` };
    }

    const pr = this.priceRate;

    // Apply minimum billable weight (carriers specify a floor, e.g. Safexpress=20kg, DBS=50kg).
    // Only affects base freight — ODA and handling still use the actual chargeableWeight.
    const effectiveWeight = (pr.minWeight && pr.minWeight > chargeableWeight)
      ? pr.minWeight
      : chargeableWeight;

    // Base freight
    const baseFreight = unitPrice * effectiveWeight;

    // Apply minimum charges as floor to BASE freight (if configured as minBase)
    // DEPRECATED: Old behavior used minCharges as base floor. 
    // v4.0: Support distinct minBaseFreight vs minTotalCharges
    const minBaseFreight = pr.minBaseFreight || pr.minCharges || 0;

    // NOTE: For DB Schenker, "Min Freight 400" acts as a TOTAL floor in Excel formulas.
    // We will handle total floor at the end. 
    // However, strict UTSF spec usually treats minCharges as base floor.
    // To fix Test 1 without breaking others, we will rely on a new 'minTotalCharges' key if present,
    // OR if specific legacy logic requires it.

    // For now, keep effectiveBaseFreight for backward compatibility but allow skipping it
    // if 'minChargesApplyToTotal' is true
    const effectiveBaseFreight = pr.minChargesApplyToTotal ? baseFreight : Math.max(baseFreight, minBaseFreight);

    // Fixed charges
    const docketCharge = pr.docketCharges || 0;
    const greenTax = pr.greenTax || 0;
    const daccCharges = pr.daccCharges || 0;
    const miscCharges = pr.miscellanousCharges || pr.miscCharges || 0;

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
    // MUST stay in sync with Block 1 (~line 811) and Block 2 (~line 1087) in transportController.js.
    // ─────────────────────────────────────────────────────────────────
    // Fuel charges (percentage of baseFreight, NOT effectiveBase)
    const fuelCharges = Math.min(((pr.fuel || 0) / 100) * baseFreight, pr.fuelMax || Infinity);

    // Helper for variable/fixed charges (max of percentage * baseFreight or fixed)
    const computeCharge = (config) => {
      if (!config) return 0;
      const variable = config.v !== undefined ? config.v : (config.variable || 0);
      const fixed = config.f !== undefined ? config.f : (config.fixed || 0);
      return Math.max((variable / 100) * baseFreight, fixed);
    };

    // ROV, Insurance, FM, Appointment charges (lines 800-822)
    const rovCharges = computeCharge(pr.rovCharges);
    const insuaranceCharges = computeCharge(pr.insuaranceCharges || pr.insuranceCharges);
    const fmCharges = computeCharge(pr.fmCharges);
    const appointmentCharges = computeCharge(pr.appointmentCharges);

    // Handling charges: fixed + weight * variable% (lines 812-814)
    // Support threshold weight - only charge for weight above threshold
    const handlingConfig = pr.handlingCharges || {};
    const handlingFixed = handlingConfig.f !== undefined ? handlingConfig.f : (handlingConfig.fixed || 0);
    const handlingVariable = handlingConfig.v !== undefined ? handlingConfig.v : (handlingConfig.variable || 0);
    const thresholdWeight = handlingConfig.thresholdWeight || handlingConfig.threshholdweight || 0;
    const handlingWeight = Math.max(0, chargeableWeight - thresholdWeight);
    const handlingCharges = handlingFixed + (handlingWeight * handlingVariable / 100);

    // ODA charges — three modes:
    //   legacy:  f + w * v/100         (v is a percentage)
    //   excess:  f + max(0,w-thresh)*v  (v is per-kg, on weight above threshold)
    //   switch:  w > thresh ? v*w : f   (v is per-kg, applied to ALL weight)
    let odaCharges = 0;
    if (toResult.isOda) {
      const odaConfig = pr.odaCharges || {};
      const odaFixed = odaConfig.f !== undefined ? odaConfig.f : (odaConfig.fixed || 0);
      const odaVariable = odaConfig.v !== undefined ? odaConfig.v : (odaConfig.variable || 0);
      const odaMode = odaConfig.mode || 'legacy';
      const odaThreshold = odaConfig.thresholdWeight || 0;
      if (odaMode === 'switch') {
        odaCharges = chargeableWeight > odaThreshold ? odaVariable * chargeableWeight : odaFixed;
      } else if (odaMode === 'excess') {
        odaCharges = odaFixed + Math.max(0, chargeableWeight - odaThreshold) * odaVariable;
      } else {
        // legacy: fixed + weight * variable%
        odaCharges = odaFixed + (chargeableWeight * odaVariable / 100);
      }
    }

    // Invoice value charges
    let invoiceValueCharges = 0;
    const invoiceConfig = pr.invoiceValueCharges || this._data.pricing?.priceRate?.invoiceValueCharges;
    if (invoiceConfig?.enabled && invoiceValue > 0) {
      const percentage = invoiceConfig.percentage || invoiceConfig.v || 0;
      const minAmount = invoiceConfig.minimumAmount || invoiceConfig.f || 0;
      invoiceValueCharges = Math.max((percentage / 100) * invoiceValue, minAmount);
    }

    // Custom surcharges (carrier-specific: IDC, CAF, reattempt, etc.)
    const _standardSub = effectiveBaseFreight + docketCharge + greenTax + daccCharges
      + miscCharges + fuelCharges + rovCharges + insuaranceCharges + odaCharges
      + handlingCharges + fmCharges + appointmentCharges + invoiceValueCharges;
    const _customSurcharges = (pr.surcharges || [])
      .filter(s => s && s.enabled !== false)
      .sort((a, b) => (a.order || 99) - (b.order || 99))
      .reduce((acc, s) => {
        const v  = Number(s.value)  || 0;
        const v2 = Number(s.value2) || 0;
        switch (s.formula) {
          case 'PCT_OF_BASE':     return acc + (v / 100) * baseFreight;
          case 'PCT_OF_SUBTOTAL': return acc + (v / 100) * _standardSub;
          case 'FLAT':            return acc + v;
          case 'PER_KG':          return acc + v * chargeableWeight;
          case 'MAX_FLAT_PKG':    return acc + Math.max(v, v2 * chargeableWeight);
          default:                return acc;
        }
      }, 0);

    // Total (lines 828-841)
    let totalChargesBeforeAddon =
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
      appointmentCharges +
      invoiceValueCharges +
      _customSurcharges;

    // Apply minimum total charges if configured (e.g., DB Schenker 400 INR is total floor)
    // This uses the minBaseFreight key if minApplyToTotal is true, OR an explicit minTotalCharges key
    const minTotal = pr.minTotalCharges || (pr.minChargesApplyToTotal ? (pr.minBaseFreight || pr.minCharges || 0) : 0);
    if (totalChargesBeforeAddon < minTotal) {
      totalChargesBeforeAddon = minTotal;
    }

    const breakdown = {
      baseFreight: Math.round(baseFreight * 100) / 100,
      effectiveBaseFreight: Math.round(effectiveBaseFreight * 100) / 100,
      docketCharge,
      greenTax,
      daccCharges,
      miscCharges,
      fuelCharges: Math.round(fuelCharges * 100) / 100,
      rovCharges: Math.round(rovCharges * 100) / 100,
      insuaranceCharges: Math.round(insuaranceCharges * 100) / 100,
      odaCharges: Math.round(odaCharges * 100) / 100,
      handlingCharges: Math.round(handlingCharges * 100) / 100,
      fmCharges: Math.round(fmCharges * 100) / 100,
      appointmentCharges: Math.round(appointmentCharges * 100) / 100,
      invoiceValueCharges: Math.round(invoiceValueCharges * 100) / 100
    };

    return {
      unitPrice,
      baseFreight: breakdown.baseFreight,
      totalCharges: Math.round(totalChargesBeforeAddon * 100) / 100,
      breakdown,
      originZone,
      destZone,
      isOda: toResult.isOda,
      formulaParams: {
        source: 'UTSF',
        kFactor: pr.kFactor ?? pr.divisor ?? 5000,
        fuelPercent: pr.fuel || 0,
        fuelMax: pr.fuelMax || null,
        docketCharge: docketCharge,
        rovPercent: pr.rovCharges?.variable || pr.rovCharges?.v || 0,
        rovFixed: pr.rovCharges?.fixed || pr.rovCharges?.f || 0,
        minCharges: minBaseFreight,
        odaConfig: { isOda: toResult.isOda, fixed: pr.odaCharges?.f ?? pr.odaCharges?.fixed ?? 0, variable: pr.odaCharges?.v ?? pr.odaCharges?.variable ?? 0, thresholdWeight: pr.odaCharges?.thresholdWeight || 0, mode: pr.odaCharges?.mode || 'legacy' },
        unitPrice: unitPrice,
        baseFreight: breakdown.baseFreight,
        effectiveBaseFreight: breakdown.effectiveBaseFreight
      }
    };
  }

  /**
   * Get summary for comparison
   */
  toComparisonDict() {
    return {
      id: this.id,
      companyName: this.companyName,
      transporterType: this.transporterType,
      totalPincodes: this.totalPincodes,
      rating: this.rating,
      isVerified: this.isVerified,
      stats: this.stats,
      vendorRatings: this.vendorRatings,
      volumetricConfig: this.volumetricConfig,
      specialZones: this.specialZones,
      complianceScore: this.complianceScore,
      governanceVersion: this.governanceVersion,
      isLegacy: this.isLegacy
    };
  }
}

/**
 * UTSF Service - singleton that loads and manages all UTSF transporters
 */
class UTSFService {
  constructor() {
    this.transporters = new Map(); // id -> UTSFTransporter
    this.masterPincodes = {}; // pincode -> zone
    this.isLoaded = false;
  }

  /**
   * Load master pincodes from JSON file
   */
  loadMasterPincodes(pincodesPath) {
    try {
      const data = JSON.parse(fs.readFileSync(pincodesPath, 'utf8'));
      data.forEach(entry => {
        const pincode = parseInt(entry.pincode, 10);
        const zone = entry.zone?.toUpperCase();
        if (!isNaN(pincode) && zone) {
          this.masterPincodes[pincode] = zone;
        }
      });
      console.log(`[UTSF] Loaded ${Object.keys(this.masterPincodes).length} pincodes`);
    } catch (err) {
      console.error('[UTSF] Error loading master pincodes:', err.message);
    }
  }

  /**
   * Load all UTSF files from directory
   */
  loadAllUTSF(utsfDir, pincodesPath = null) {
    if (this.isLoaded) {
      console.log('[UTSF] Already loaded');
      return;
    }

    // Load master pincodes first
    if (!pincodesPath) {
      pincodesPath = path.resolve(__dirname, '../data/pincodes.json');
    }

    if (fs.existsSync(pincodesPath)) {
      this.loadMasterPincodes(pincodesPath);
    } else {
      console.warn('[UTSF] Master pincodes not found at:', pincodesPath);
    }

    // Load UTSF files
    if (!fs.existsSync(utsfDir)) {
      console.error('[UTSF] UTSF directory not found:', utsfDir);
      return;
    }

    const files = fs.readdirSync(utsfDir).filter(f => f.endsWith('.utsf.json'));

    console.log(`[UTSF] Loading ${files.length} UTSF files from ${utsfDir}`);

    files.forEach(filename => {
      try {
        const filePath = path.join(utsfDir, filename);
        const utsfData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        const transporter = new UTSFTransporter(utsfData, this.masterPincodes);
        this.transporters.set(transporter.id, transporter);

        console.log(`[UTSF] Loaded: ${transporter.companyName} (${transporter.totalPincodes} pincodes)`);
      } catch (err) {
        console.error(`[UTSF] Error loading ${filename}:`, err.message);
      }
    });

    this.isLoaded = true;
    console.log(`[UTSF] Successfully loaded ${this.transporters.size} transporters`);
  }

  /**
   * Get all transporters
   */
  getAllTransporters() {
    return Array.from(this.transporters.values());
  }

  /**
   * Get transporter by ID
   */
  getTransporterById(id) {
    return this.transporters.get(id);
  }

  /**
   * Check if pincode is serviceable by any transporter
   */
  isServiceable(pincode) {
    const pin = parseInt(pincode, 10);
    for (const transporter of this.transporters.values()) {
      if (transporter.isServiceable(pin)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all transporters that serve a pincode
   */
  getTransportersForPincode(pincode) {
    const pin = parseInt(pincode, 10);
    return this.getAllTransporters().filter(t => t.isServiceable(pin));
  }

  /**
   * Calculate prices for all serviceable transporters on a route
   */
  calculatePricesForRoute(fromPincode, toPincode, chargeableWeight, invoiceValue = 0) {
    const results = [];

    for (const transporter of this.transporters.values()) {
      const priceResult = transporter.calculatePrice(
        fromPincode,
        toPincode,
        chargeableWeight,
        invoiceValue
      );

      if (priceResult && !priceResult.error) {
        results.push({
          transporterId: transporter.id,
          companyName: transporter.companyName,
          customerID: transporter.customerID,
          rating: transporter.rating,
          isVerified: transporter.isVerified,
          vendorRatings: transporter.vendorRatings || null,
          totalRatings: transporter._data?.meta?.totalRatings || 0,
          approvalStatus: transporter._data?.meta?.approvalStatus || 'approved',
          transporterType: transporter.transporterType,
          ...priceResult,
          source: 'utsf'
        });
      } else {
        // 🛑 REJECTION LOGGING 🛑
        console.warn(`\n[UTSF REJECTED ROUTE] ---------------------------------------------`);
        console.warn(`   Transporter : ${transporter.companyName} (${transporter.id})`);
        console.warn(`   Route       : ${fromPincode} -> ${toPincode} | Weight: ${chargeableWeight}kg`);
        console.warn(`   Reason      : ${priceResult?.error || 'Unknown Error / Calculation Failed'}`);
        console.warn(`-------------------------------------------------------------------`);
      }
    }

    // Sort by price
    results.sort((a, b) => a.totalCharges - b.totalCharges);

    return results;
  }

  /**
   * Add or update a transporter from UTSF data
   */
  addTransporter(utsfData) {
    const transporter = new UTSFTransporter(utsfData, this.masterPincodes);
    this.transporters.set(transporter.id, transporter);
    console.log(`[UTSF] Added/updated: ${transporter.companyName}`);
    return transporter;
  }

  /**
   * Remove transporter by ID
   */
  removeTransporter(id) {
    const deleted = this.transporters.delete(id);
    if (deleted) {
      console.log(`[UTSF] Removed transporter: ${id}`);
    }
    return deleted;
  }

  /**
   * Reload a single transporter from its disk file
   */
  reloadTransporter(id) {
    const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
    const filePath = path.join(UTSF_DIR, `${id}.utsf.json`);
    if (!fs.existsSync(filePath)) return false;

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const transporter = new UTSFTransporter(data, this.masterPincodes);
      this.transporters.set(transporter.id, transporter);
      console.log(`[UTSF] Reloaded: ${transporter.companyName}`);
      return true;
    } catch (err) {
      console.error(`[UTSF] Error reloading ${id}:`, err.message);
      return false;
    }
  }

  /**
   * Load a single transporter from MongoDB by ID and inject into memory.
   * Removes any existing in-memory version first to avoid duplicates.
   * Use this after saving/updating a Mongo doc to keep memory in sync.
   */
  async loadSingleFromMongo(transporterId) {
    try {
      console.log(`[UTSF] loadSingleFromMongo: Looking up "${transporterId}" in MongoDB...`);
      const UTSFModel = (await import('../model/utsfModel.js')).default;
      const doc = await UTSFModel.findByTransporterId(transporterId);

      if (!doc) {
        console.warn(`[UTSF] loadSingleFromMongo: No MongoDB doc found for id="${transporterId}"`);
        return false;
      }

      const utsfData = doc.toUTSF();

      // Remove stale in-memory entry to avoid duplicates
      if (this.transporters.has(transporterId)) {
        this.transporters.delete(transporterId);
        console.log(`[UTSF] loadSingleFromMongo: Removed stale in-memory entry for "${transporterId}"`);
      }

      // Ensure master pincodes are loaded before building indexes
      if (Object.keys(this.masterPincodes).length === 0) {
        const pincodesPath = path.resolve(__dirname, '../data/pincodes.json');
        if (fs.existsSync(pincodesPath)) {
          this.loadMasterPincodes(pincodesPath);
          console.log(`[UTSF] loadSingleFromMongo: Loaded master pincodes for index building`);
        } else {
          console.warn(`[UTSF] loadSingleFromMongo: Master pincodes file not found — transporter indexes may be incomplete`);
        }
      }

      const transporter = this.addTransporter(utsfData);
      console.log(`[UTSF] loadSingleFromMongo: ✅ "${transporter.companyName}" (${transporterId}) is now active in memory (${transporter._servedPincodes?.size || 0} pincodes)`);
      return true;
    } catch (err) {
      console.error(`[UTSF] loadSingleFromMongo: ❌ Error for "${transporterId}":`, err.message);
      return false;
    }
  }

  /**
   * Get all transporters tied to a specific customer
   */
  getTransportersByCustomerId(customerId) {
    if (!customerId) return [];

    const results = [];
    for (const transporter of this.transporters.values()) {
      // Ensure strict string comparison for IDs
      if (transporter.customerID && String(transporter.customerID) === String(customerId)) {
        results.push(transporter);
      }
    }
    return results;
  }

  /**
   * Load UTSF transporters from MongoDB (fallback when disk is empty/ephemeral)
   * Skips any transporters already loaded from disk.
   * Should be called AFTER database connection is established.
   */
  async loadFromMongoDB() {
    try {
      // Dynamic import to avoid circular dependency and allow loading before DB connects
      const UTSFModel = (await import('../model/utsfModel.js')).default;

      const docs = await UTSFModel.find({});
      if (!docs || docs.length === 0) {
        console.log('[UTSF] No UTSF documents found in MongoDB');
        return 0;
      }

      // Ensure master pincodes are loaded (needed for index building)
      if (Object.keys(this.masterPincodes).length === 0) {
        const pincodesPath = path.resolve(__dirname, '../data/pincodes.json');
        if (fs.existsSync(pincodesPath)) {
          this.loadMasterPincodes(pincodesPath);
        } else {
          console.warn('[UTSF] Master pincodes not found - MongoDB transporters may have limited functionality');
        }
      }

      let loadedCount = 0;
      for (const doc of docs) {
        const utsfData = doc.toUTSF();
        const transporterId = utsfData.meta?.id;

        // Skip if already loaded from disk
        if (transporterId && this.transporters.has(transporterId)) {
          continue;
        }

        try {
          const transporter = new UTSFTransporter(utsfData, this.masterPincodes);
          this.transporters.set(transporter.id, transporter);
          loadedCount++;
          console.log(`[UTSF] Loaded from MongoDB: ${transporter.companyName} (${transporter.totalPincodes} pincodes)`);
        } catch (err) {
          console.error(`[UTSF] Error loading MongoDB doc ${transporterId}:`, err.message);
        }
      }

      this.isLoaded = true;
      console.log(`[UTSF] Loaded ${loadedCount} transporters from MongoDB (total: ${this.transporters.size})`);
      return loadedCount;
    } catch (err) {
      console.error('[UTSF] Error loading from MongoDB:', err.message);
      return 0;
    }
  }

  /**
   * Reload all UTSF files
   */
  reload(utsfDir, pincodesPath = null) {
    this.transporters.clear();
    this.masterPincodes = {};
    this.isLoaded = false;
    this.loadAllUTSF(utsfDir, pincodesPath);
  }
}

// Singleton instance
const utsfService = new UTSFService();

// Auto-load on module import
const UTSF_DIR = path.resolve(__dirname, '../data/utsf');
const PINCODES_PATH = path.resolve(__dirname, '../data/pincodes.json');

if (fs.existsSync(UTSF_DIR)) {
  utsfService.loadAllUTSF(UTSF_DIR, PINCODES_PATH);
}

export default utsfService;
export { UTSFTransporter, ZoneCoverageMode };