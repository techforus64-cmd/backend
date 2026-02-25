/**
 * UTSF Service - Unified Transporter Save Format for Node.js Backend
 *
 * Provides fast serviceability checking and price calculation using UTSF files.
 * Designed to work alongside existing transportController.js
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// CONSTANTS
// ============================================================================

const UTSF_VERSION = "2.0";

const ZoneCoverageMode = {
    FULL_ZONE: "FULL_ZONE",
    FULL_MINUS_EXCEPTIONS: "FULL_MINUS_EXCEPT",
    ONLY_SERVED: "ONLY_SERVED",
    NOT_SERVED: "NOT_SERVED"
};

// ============================================================================
// UTSF TRANSPORTER CLASS
// ============================================================================

class UTSFTransporter {
    /**
     * Create a UTSF transporter from loaded data
     * @param {Object} utsfData - Loaded UTSF JSON data
     * @param {Map<number, string>} masterPincodes - Pincode to zone mapping
     */
    constructor(utsfData, masterPincodes = new Map()) {
        this._data = utsfData;
        this._masterPincodes = masterPincodes;

        // Build fast lookup indexes
        this._servedPincodes = new Set();
        this._odaPincodes = new Set();
        this._exceptionPincodes = new Set();
        this._zoneServedPincodes = new Map();

        this._buildIndexes();
    }

    /**
     * Build O(1) lookup indexes from UTSF data
     */
    _buildIndexes() {
        const serviceability = this._data.serviceability || {};
        const odaData = this._data.oda || {};

        for (const [zone, coverage] of Object.entries(serviceability)) {
            const mode = coverage.mode || '';
            this._zoneServedPincodes.set(zone, new Set());

            if (mode === ZoneCoverageMode.FULL_ZONE) {
                // All pincodes in zone are served - need master to expand
                for (const [pin, z] of this._masterPincodes.entries()) {
                    if (z === zone) {
                        this._servedPincodes.add(pin);
                        this._zoneServedPincodes.get(zone).add(pin);
                    }
                }
            } else if (mode === ZoneCoverageMode.FULL_MINUS_EXCEPTIONS) {
                // All except listed are served
                const exceptions = this._expandRanges(
                    coverage.exceptRanges || [],
                    coverage.exceptSingles || []
                );

                for (const pin of exceptions) {
                    this._exceptionPincodes.add(pin);
                }

                // Add all zone pincodes except exceptions
                for (const [pin, z] of this._masterPincodes.entries()) {
                    if (z === zone && !exceptions.has(pin)) {
                        this._servedPincodes.add(pin);
                        this._zoneServedPincodes.get(zone).add(pin);
                    }
                }
            } else if (mode === ZoneCoverageMode.ONLY_SERVED) {
                // Only listed pincodes are served
                const served = this._expandRanges(
                    coverage.servedRanges || [],
                    coverage.servedSingles || []
                );

                for (const pin of served) {
                    this._servedPincodes.add(pin);
                    this._zoneServedPincodes.get(zone).add(pin);
                }
            }
        }

        // Build ODA index
        for (const [zone, odaInfo] of Object.entries(odaData)) {
            const odaPins = this._expandRanges(
                odaInfo.odaRanges || [],
                odaInfo.odaSingles || []
            );

            for (const pin of odaPins) {
                this._odaPincodes.add(pin);
            }
        }
    }

    /**
     * Expand pincode ranges and singles to a Set
     */
    _expandRanges(ranges, singles) {
        const result = new Set();

        for (const range of ranges) {
            for (let pin = range.s; pin <= range.e; pin++) {
                result.add(pin);
            }
        }

        for (const pin of singles) {
            result.add(pin);
        }

        return result;
    }

    // =========================================================================
    // PROPERTIES
    // =========================================================================

    get id() {
        return this._data.meta?.id || '';
    }

    get companyName() {
        return this._data.meta?.companyName || '';
    }

    get transporterType() {
        return this._data.meta?.transporterType || 'regular';
    }

    get isTemporary() {
        return this.transporterType === 'temporary';
    }

    get rating() {
        return this._data.meta?.rating || 4.0;
    }

    get isVerified() {
        return this._data.meta?.isVerified || false;
    }

    get totalPincodes() {
        return this._data.stats?.totalPincodes || 0;
    }

    get activeZones() {
        const zones = [];
        for (const [zone, coverage] of Object.entries(this._data.serviceability || {})) {
            if ((coverage.servedCount || 0) > 0) {
                zones.push(zone);
            }
        }
        return zones.sort();
    }

    get priceRate() {
        return this._data.pricing?.priceRate || {};
    }

    get zoneRates() {
        return this._data.pricing?.zoneRates || {};
    }

    get stats() {
        return this._data.stats || {};
    }

    // =========================================================================
    // SERVICEABILITY QUERIES
    // =========================================================================

    /**
     * Check if a pincode is serviceable (O(1) lookup)
     * @param {number|string} pincode
     * @returns {boolean}
     */
    isServiceable(pincode) {
        return this._servedPincodes.has(Number(pincode));
    }

    /**
     * Check if a pincode is ODA
     * @param {number|string} pincode
     * @returns {boolean}
     */
    isOda(pincode) {
        return this._odaPincodes.has(Number(pincode));
    }

    /**
     * Get zone for a pincode (from master or internal lookup)
     * @param {number|string} pincode
     * @returns {string|null}
     */
    getZoneForPincode(pincode) {
        const pin = Number(pincode);

        // First try master
        if (this._masterPincodes.has(pin)) {
            return this._masterPincodes.get(pin);
        }

        // Then try internal lookup
        for (const [zone, pins] of this._zoneServedPincodes.entries()) {
            if (pins.has(pin)) {
                return zone;
            }
        }

        return null;
    }

    /**
     * Full serviceability check with details
     * @param {number|string} pincode
     * @returns {Object} { isServiceable, zone, isOda, coveragePercent, reason }
     */
    checkServiceability(pincode) {
        const pin = Number(pincode);
        const zone = this.getZoneForPincode(pin);

        if (!zone) {
            return {
                isServiceable: false,
                zone: null,
                isOda: false,
                coveragePercent: 0,
                reason: "Pincode not found in master database"
            };
        }

        const isServed = this._servedPincodes.has(pin);
        const isOda = this._odaPincodes.has(pin);

        // Get coverage percent for this zone
        const coverage = this._data.serviceability?.[zone] || {};
        const coveragePercent = coverage.coveragePercent || 0;

        let reason;
        if (isServed) {
            reason = `Served in zone ${zone}`;
            if (isOda) reason += " (ODA)";
        } else {
            const mode = coverage.mode || 'NOT_SERVED';
            if (mode === ZoneCoverageMode.NOT_SERVED) {
                reason = `Zone ${zone} not served by this transporter`;
            } else if (mode === ZoneCoverageMode.FULL_MINUS_EXCEPTIONS) {
                reason = `Pincode is an exception in zone ${zone}`;
            } else {
                reason = `Pincode not in served list for zone ${zone}`;
            }
        }

        return {
            isServiceable: isServed,
            zone,
            isOda,
            coveragePercent,
            reason
        };
    }

    /**
     * Check if transporter can serve a route
     * @param {number|string} fromPincode
     * @param {number|string} toPincode
     * @returns {{ canServe: boolean, reason: string, originZone?: string, destZone?: string }}
     */
    canServeRoute(fromPincode, toPincode) {
        const fromResult = this.checkServiceability(fromPincode);
        const toResult = this.checkServiceability(toPincode);

        if (!fromResult.isServiceable) {
            return { canServe: false, reason: `Origin ${fromPincode}: ${fromResult.reason}` };
        }

        if (!toResult.isServiceable) {
            return { canServe: false, reason: `Destination ${toPincode}: ${toResult.reason}` };
        }

        // Check if zone rates exist
        const originZone = fromResult.zone;
        const destZone = toResult.zone;

        if (originZone && destZone) {
            const zoneRates = this.zoneRates;
            if (zoneRates[originZone] && zoneRates[originZone][destZone] !== undefined) {
                return {
                    canServe: true,
                    reason: `Route serviceable: ${originZone} -> ${destZone}`,
                    originZone,
                    destZone
                };
            } else {
                return {
                    canServe: false,
                    reason: `No rate for zone combination ${originZone} -> ${destZone}`
                };
            }
        }

        return { canServe: true, reason: "Route serviceable", originZone, destZone };
    }

    // =========================================================================
    // PRICING QUERIES
    // =========================================================================

    /**
     * Get rate per kg for a zone combination
     * @param {string} originZone
     * @param {string} destZone
     * @returns {number|null}
     */
    getZoneRate(originZone, destZone) {
        const origin = originZone.toUpperCase();
        const dest = destZone.toUpperCase();

        const zoneRates = this.zoneRates;
        if (zoneRates[origin]) {
            return zoneRates[origin][dest] ?? null;
        }
        return null;
    }

    /**
     * Calculate freight price for a route
     * @param {Object} params
     * @param {number|string} params.fromPincode
     * @param {number|string} params.toPincode
     * @param {number} params.chargeableWeight - Weight in kg
     * @param {number} [params.invoiceValue=0]
     * @returns {Object|null} Price breakdown or null if not serviceable
     */
    calculatePrice({ fromPincode, toPincode, chargeableWeight, invoiceValue = 0 }) {
        // Check serviceability
        const fromResult = this.checkServiceability(fromPincode);
        const toResult = this.checkServiceability(toPincode);

        if (!fromResult.isServiceable || !toResult.isServiceable) {
            return null;
        }

        const originZone = fromResult.zone;
        const destZone = toResult.zone;

        // Get unit price
        const unitPrice = this.getZoneRate(originZone, destZone);
        if (unitPrice === null) {
            return null;
        }

        const pr = this.priceRate;

        // Base freight
        const baseFreight = unitPrice * chargeableWeight;

        // Apply minimum charges as floor
        const minCharges = pr.minCharges || 0;
        const effectiveBase = Math.max(baseFreight, minCharges);

        // Helper for variable/fixed charges
        const computeCharge = (config) => {
            if (!config) return 0;
            const variable = config.v ?? config.variable ?? 0;
            const fixed = config.f ?? config.fixed ?? 0;
            return Math.max((variable / 100) * baseFreight, fixed);
        };

        // Calculate all charges
        const fuelCharges = ((pr.fuel || 0) / 100) * effectiveBase;
        const rovCharges = computeCharge(pr.rovCharges);
        const insuranceCharges = computeCharge(pr.insuranceCharges);
        const handlingCharges = computeCharge(pr.handlingCharges);
        const fmCharges = computeCharge(pr.fmCharges);
        const appointmentCharges = computeCharge(pr.appointmentCharges);

        // ODA charges
        let odaCharges = 0;
        if (toResult.isOda) {
            const odaConfig = pr.odaCharges || {};
            const odaFixed = odaConfig.f ?? odaConfig.fixed ?? 0;
            const odaVariable = odaConfig.v ?? odaConfig.variable ?? 0;
            odaCharges = odaFixed + (chargeableWeight * odaVariable / 100);
        }

        // Fixed charges
        const docketCharges = pr.docketCharges || 0;
        const greenTax = pr.greenTax || 0;
        const daccCharges = pr.daccCharges || 0;
        const miscCharges = pr.miscCharges || 0;

        // Total
        const totalCharges = (
            effectiveBase +
            docketCharges +
            greenTax +
            daccCharges +
            miscCharges +
            fuelCharges +
            rovCharges +
            insuranceCharges +
            odaCharges +
            handlingCharges +
            fmCharges +
            appointmentCharges
        );

        return {
            unitPrice,
            baseFreight: Math.round(baseFreight * 100) / 100,
            effectiveBaseFreight: Math.round(effectiveBase * 100) / 100,
            chargeableWeight,
            totalCharges: Math.round(totalCharges * 100) / 100,
            breakdown: {
                docketCharges,
                greenTax,
                daccCharges,
                miscCharges,
                fuelCharges: Math.round(fuelCharges * 100) / 100,
                rovCharges: Math.round(rovCharges * 100) / 100,
                insuranceCharges: Math.round(insuranceCharges * 100) / 100,
                odaCharges: Math.round(odaCharges * 100) / 100,
                handlingCharges: Math.round(handlingCharges * 100) / 100,
                fmCharges: Math.round(fmCharges * 100) / 100,
                appointmentCharges: Math.round(appointmentCharges * 100) / 100
            },
            originZone,
            destZone,
            isOda: toResult.isOda,
            companyName: this.companyName,
            transporterId: this.id
        };
    }

    /**
     * Get comparison-friendly data
     */
    toComparisonObject() {
        return {
            id: this.id,
            companyName: this.companyName,
            transporterType: this.transporterType,
            totalPincodes: this.totalPincodes,
            activeZones: this.activeZones,
            rating: this.rating,
            isVerified: this.isVerified,
            coverageByRegion: this.stats.coverageByRegion || {},
            avgCoverage: this.stats.avgCoveragePercent || 0
        };
    }
}

// ============================================================================
// UTSF SERVICE CLASS
// ============================================================================

class UTSFService {
    /**
     * Create UTSF service
     * @param {string} masterPincodesPath - Path to master pincodes.json
     * @param {string} utsfDirectory - Directory containing UTSF files
     */
    constructor(masterPincodesPath, utsfDirectory) {
        this.masterPincodesPath = masterPincodesPath;
        this.utsfDirectory = utsfDirectory;

        /** @type {Map<number, string>} */
        this._masterPincodes = new Map();

        /** @type {Map<string, UTSFTransporter>} */
        this._transporters = new Map();

        this._initialized = false;
    }

    /**
     * Initialize the service (load master pincodes and UTSF files)
     */
    async initialize() {
        if (this._initialized) return;

        // Load master pincodes
        await this._loadMasterPincodes();

        // Load UTSF files
        await this._loadUTSFFiles();

        this._initialized = true;
        console.log(`[UTSF] Initialized with ${this._transporters.size} transporters`);
    }

    /**
     * Load master pincodes
     */
    async _loadMasterPincodes() {
        try {
            const data = fs.readFileSync(this.masterPincodesPath, 'utf8');
            const pincodes = JSON.parse(data);

            for (const entry of pincodes) {
                const pincode = Number(entry.pincode);
                const zone = (entry.zone || '').toUpperCase();
                if (zone) {
                    this._masterPincodes.set(pincode, zone);
                }
            }

            console.log(`[UTSF] Loaded ${this._masterPincodes.size} master pincodes`);
        } catch (error) {
            console.error('[UTSF] Error loading master pincodes:', error);
        }
    }

    /**
     * Load all UTSF files from directory
     */
    async _loadUTSFFiles() {
        try {
            if (!fs.existsSync(this.utsfDirectory)) {
                console.log('[UTSF] UTSF directory not found, creating...');
                fs.mkdirSync(this.utsfDirectory, { recursive: true });
                return;
            }

            const files = fs.readdirSync(this.utsfDirectory);
            const utsfFiles = files.filter(f => f.endsWith('.utsf.json'));

            for (const filename of utsfFiles) {
                try {
                    const filePath = path.join(this.utsfDirectory, filename);
                    const data = fs.readFileSync(filePath, 'utf8');
                    const utsfData = JSON.parse(data);

                    const transporter = new UTSFTransporter(utsfData, this._masterPincodes);
                    this._transporters.set(transporter.id, transporter);

                    console.log(`[UTSF] Loaded: ${transporter.companyName}`);
                } catch (error) {
                    console.error(`[UTSF] Error loading ${filename}:`, error.message);
                }
            }
        } catch (error) {
            console.error('[UTSF] Error loading UTSF files:', error);
        }
    }

    /**
     * Get all loaded transporters
     * @returns {UTSFTransporter[]}
     */
    getAllTransporters() {
        return Array.from(this._transporters.values());
    }

    /**
     * Get transporter by ID
     * @param {string} id
     * @returns {UTSFTransporter|null}
     */
    getTransporter(id) {
        return this._transporters.get(id) || null;
    }

    /**
     * Check serviceability for a pincode across all transporters
     * @param {number|string} pincode
     * @returns {Object[]} List of { transporter, result }
     */
    checkServiceabilityAll(pincode) {
        const results = [];

        for (const transporter of this._transporters.values()) {
            const result = transporter.checkServiceability(pincode);
            results.push({
                transporterId: transporter.id,
                companyName: transporter.companyName,
                ...result
            });
        }

        return results;
    }

    /**
     * Compare prices for a route across all transporters
     * @param {Object} params
     * @param {number|string} params.fromPincode
     * @param {number|string} params.toPincode
     * @param {number} params.chargeableWeight
     * @param {number} [params.invoiceValue=0]
     * @returns {Object[]} Sorted by price (lowest first)
     */
    compareTransporters({ fromPincode, toPincode, chargeableWeight, invoiceValue = 0 }) {
        const quotes = [];

        for (const transporter of this._transporters.values()) {
            const result = transporter.calculatePrice({
                fromPincode,
                toPincode,
                chargeableWeight,
                invoiceValue
            });

            if (result) {
                quotes.push(result);
            }
        }

        // Sort by total charges
        quotes.sort((a, b) => a.totalCharges - b.totalCharges);

        return quotes;
    }

    /**
     * Reload all UTSF files (useful after encoding new files)
     */
    async reload() {
        this._transporters.clear();
        this._initialized = false;
        await this.initialize();
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    UTSF_VERSION,
    ZoneCoverageMode,
    UTSFTransporter,
    UTSFService
};
