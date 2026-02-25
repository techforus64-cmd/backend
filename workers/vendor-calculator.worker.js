/**
 * Vendor Calculator Worker Thread
 * Runs vendor price calculations in parallel on separate CPU threads
 * This eliminates the single-threaded bottleneck in calculatePrice
 */

import { parentPort } from 'worker_threads';

/**
 * Helper: Get unit price from price chart
 */
function getUnitPriceFromPriceChart(priceChart, originZoneCode, destZoneCode) {
    if (!priceChart || !originZoneCode || !destZoneCode) return null;
    const o = String(originZoneCode).trim().toUpperCase();
    const d = String(destZoneCode).trim().toUpperCase();

    // Direct lookup
    const direct =
        (priceChart[o] && priceChart[o][d]) ??
        (priceChart[d] && priceChart[d][o]);
    if (direct != null) return Number(direct);

    // Case-insensitive search
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

    return null;
}

/**
 * Calculate volumetric weight for a vendor
 */
function getVolumetricWeight(kFactor, shipment_details, legacyParams = {}) {
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

/**
 * Calculate invoice value charge
 */
function calculateInvoiceValueCharge(invoiceValue, invoiceValueCharges) {
    if (!invoiceValueCharges?.enabled || !invoiceValue || invoiceValue <= 0) {
        return 0;
    }

    const { percentage, minimumAmount } = invoiceValueCharges;
    const percentageCharge = (invoiceValue * (percentage || 0)) / 100;
    const finalCharge = Math.max(percentageCharge, minimumAmount || 0);

    return Math.round(finalCharge);
}

/**
 * Main vendor calculation function
 * This is the core logic extracted from transportController.js
 */
function calculateVendorPrice(vendor, context) {
    try {
        const {
            fromPincode, toPincode,
            fromZone, toZone,
            distanceKm, estTime,
            actualWeight,
            shipment_details, legacyParams,
            invoiceValue,
            customerID
        } = context;

        const vendorType = vendor.type; // 'tied-up' or 'public'
        const companyName = vendor.companyName;

        if (!companyName) return null;

        // Get pricing data
        let priceChart, priceRate, invoiceValueCharges;

        if (vendorType === 'tied-up') {
            priceChart = vendor.prices?.priceChart;
            priceRate = vendor.prices?.priceRate || {};
            invoiceValueCharges = vendor.invoiceValueCharges;
        } else {
            // Public vendor
            priceChart = vendor.priceData?.zoneRates;
            priceRate = vendor.priceData?.priceRate || {};
            invoiceValueCharges = vendor.priceData?.invoiceValueCharges || {};
        }

        if (!priceChart || !Object.keys(priceChart).length) return null;

        // Zone-based pricing
        const originZone = vendor.effectiveOriginZone || fromZone;
        const destZone = vendor.effectiveDestZone || toZone;
        const destIsOda = vendor.destIsOda || false;

        if (!originZone || !destZone) return null;

        // Get unit price
        const unitPrice = getUnitPriceFromPriceChart(priceChart, originZone, destZone);
        if (!unitPrice) return null;

        const pr = priceRate;
        const kFactor = pr.kFactor ?? pr.divisor ?? 5000;

        // Calculate weights
        const volumetricWeight = getVolumetricWeight(kFactor, shipment_details, legacyParams);
        const chargeableWeight = Math.max(volumetricWeight, actualWeight);

        // Calculate all charges
        const baseFreight = unitPrice * chargeableWeight;
        const docketCharge = pr.docketCharges || 0;
        const minCharges = pr.minCharges || 0;
        const greenTax = pr.greenTax || 0;
        const daccCharges = pr.daccCharges || 0;
        const miscCharges = pr.miscellanousCharges || 0;
        const fuelCharges = ((pr.fuel || 0) / 100) * baseFreight;
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

        // Apply minimum charges as floor
        const effectiveBaseFreight = Math.max(baseFreight, minCharges);

        const totalChargesBeforeAddon =
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

        // Invoice addon
        const invoiceAddon = calculateInvoiceValueCharge(invoiceValue, invoiceValueCharges);

        // Build result object
        return {
            companyId: vendor._id,
            companyName: companyName,
            originPincode: fromPincode,
            destinationPincode: toPincode,
            estimatedTime: estTime,
            distance: `${Math.round(distanceKm)} km`,
            distanceKm: distanceKm,
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
            rovCharges,
            insuaranceCharges,
            odaCharges,
            handlingCharges,
            fmCharges,
            appointmentCharges,
            invoiceValue,
            invoiceAddon: Math.round(invoiceAddon),
            invoiceValueCharge: Math.round(invoiceAddon),
            totalCharges: Math.round(totalChargesBeforeAddon + invoiceAddon),
            totalChargesWithoutInvoiceAddon: Math.round(totalChargesBeforeAddon),
            isHidden: vendor.isHidden || false,
            isTemporaryTransporter: vendorType === 'tied-up',
            isTiedUp: vendorType === 'tied-up' && vendor.customerID && vendor.customerID.toString() === customerID?.toString(),
            selectedZones: vendor.selectedZones || vendor.servicableZones || [],
            zoneConfig: vendor.zoneConfig || {},
            priceChart: priceChart || {},
            approvalStatus: vendor.approvalStatus || 'approved',
            isVerified: vendor.isVerified || false,
            rating: vendor.rating ?? 4,
            vendorRatings: vendor.vendorRatings || null,
            totalRatings: vendor.totalRatings || 0,
            phone: vendor.phone || null,
            email: vendor.email || null,
            servicePincodeCount: vendor.servicePincodeCount || 0,
            // Preserve type for filtering
            _workerType: vendorType
        };
    } catch (error) {
        // Return error info instead of throwing
        return {
            error: true,
            vendorName: vendor.companyName,
            errorMessage: error.message
        };
    }
}

/**
 * Worker message handler
 * Receives batch of vendors and calculates prices for all
 */
parentPort.on('message', ({ vendors, context }) => {
    const startTime = Date.now();

    // Calculate all vendors in this batch
    const results = vendors.map(vendor => calculateVendorPrice(vendor, context));

    // Filter out nulls and errors
    const validResults = results.filter(r => r && !r.error);
    const errors = results.filter(r => r && r.error);

    if (errors.length > 0) {
        console.warn(`[Worker ${process.pid}] ${errors.length} vendor calculations failed`);
    }

    const duration = Date.now() - startTime;

    // Send results back to main thread
    parentPort.postMessage({
        results: validResults,
        stats: {
            vendorsProcessed: vendors.length,
            validResults: validResults.length,
            errors: errors.length,
            duration
        }
    });
});

// Handle worker errors
parentPort.on('error', (error) => {
    console.error('[Worker] Error:', error);
});

console.log(`[Worker ${process.pid}] Ready`);
