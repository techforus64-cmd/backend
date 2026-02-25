// backend/controllers/vendorZoneController.js
import VendorZoneMapping from "../model/VendorZoneMapping.js";
import temporaryTransporterModel from "../model/temporaryTransporterModel.js";
import Papa from "papaparse";

/**
 * ============================================================================
 * UPLOAD VENDOR ZONE MAPPING (CSV/JSON)
 * ============================================================================
 * POST /api/vendor/:vendorId/zone-map
 * 
 * Accepts either:
 * 1. CSV file upload (multipart/form-data)
 * 2. JSON array in body
 * 
 * CSV Format:
 * pincode,zone,isOda,state,city
 * 110001,METRO-DEL,false,Delhi,New Delhi
 * 400001,METRO-MUM,false,Maharashtra,Mumbai
 * 
 * JSON Format:
 * [
 *   { "pincode": "110001", "zone": "METRO-DEL", "isOda": false },
 *   { "pincode": "400001", "zone": "METRO-MUM", "isOda": false }
 * ]
 */
export const uploadVendorZoneMap = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const customerID = req.customer?._id || req.user?._id;

    // ========================================================================
    // STEP 1: VALIDATE VENDOR OWNERSHIP
    // ========================================================================
    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Verify the vendor belongs to this customer
    const vendor = await temporaryTransporterModel.findOne({
      _id: vendorId,
      customerID: customerID,
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found or access denied",
      });
    }

    // ========================================================================
    // STEP 2: PARSE INPUT (CSV FILE OR JSON BODY)
    // ========================================================================
    let mappings = [];

    // Case 1: CSV file upload
    if (req.file) {
      const csvContent = req.file.buffer.toString('utf8');
      
      const parseResult = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim().toLowerCase(),
      });

      if (parseResult.errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "CSV parsing failed",
          errors: parseResult.errors.slice(0, 10), // Show first 10 errors
        });
      }

      mappings = parseResult.data.map(row => ({
        pincode: String(row.pincode || row.pin || '').trim(),
        zone: String(row.zone || row.zonecode || row.zone_code || '').trim().toUpperCase(),
        isOda: row.isoda === 'true' || row.isoda === '1' || row.is_oda === 'true',
        state: row.state || null,
        city: row.city || null,
        zoneDisplayName: row.zonedisplayname || row.zone_display_name || null,
      }));
    }
    // Case 2: JSON array in body
    else if (req.body && Array.isArray(req.body.mappings)) {
      mappings = req.body.mappings.map(m => ({
        pincode: String(m.pincode || '').trim(),
        zone: String(m.zone || '').trim().toUpperCase(),
        isOda: Boolean(m.isOda),
        state: m.state || null,
        city: m.city || null,
        zoneDisplayName: m.zoneDisplayName || null,
      }));
    }
    // Case 3: Direct array in body
    else if (req.body && Array.isArray(req.body)) {
      mappings = req.body.map(m => ({
        pincode: String(m.pincode || '').trim(),
        zone: String(m.zone || '').trim().toUpperCase(),
        isOda: Boolean(m.isOda),
        state: m.state || null,
        city: m.city || null,
        zoneDisplayName: m.zoneDisplayName || null,
      }));
    }
    else {
      return res.status(400).json({
        success: false,
        message: "Invalid input. Provide either a CSV file or JSON array.",
      });
    }

    // ========================================================================
    // STEP 3: VALIDATE MAPPINGS
    // ========================================================================
    if (mappings.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid mappings found in input",
      });
    }

    if (mappings.length > 50000) {
      return res.status(400).json({
        success: false,
        message: "Too many mappings. Maximum 50,000 rows per upload.",
      });
    }

    // Filter out invalid entries
    const validMappings = mappings.filter(m => {
      return m.pincode && /^[1-9]\d{5}$/.test(m.pincode) && m.zone;
    });

    if (validMappings.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid pincode/zone pairs found",
      });
    }

    // ========================================================================
    // STEP 4: BULK UPSERT TO DATABASE
    // ========================================================================
    console.log(`[VendorZoneMap] Upserting ${validMappings.length} mappings for vendor ${vendorId}`);

    const result = await VendorZoneMapping.bulkUpsertMappings(
      vendorId,
      validMappings.map(m => ({
        ...m,
        source: req.file ? 'csv' : 'api',
        uploadedBy: customerID,
      }))
    );

    // ========================================================================
    // STEP 5: RETURN RESULT
    // ========================================================================
    return res.status(200).json({
      success: true,
      message: "Zone mappings uploaded successfully",
      data: {
        vendorId,
        vendorName: vendor.companyName,
        total: result.total,
        inserted: result.inserted,
        updated: result.updated,
        errors: result.errors.length,
        errorDetails: result.errors.slice(0, 20), // Show first 20 errors
      },
    });

  } catch (error) {
    console.error("[VendorZoneMap] Upload error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload zone mappings",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * ============================================================================
 * GET VENDOR ZONE MAPPINGS
 * ============================================================================
 * GET /api/vendor/:vendorId/zone-map
 * 
 * Query params:
 * - page: Page number (default 1)
 * - limit: Items per page (default 100, max 1000)
 * - zone: Filter by zone code
 * - isOda: Filter by ODA status (true/false)
 * - search: Search pincode
 */
export const getVendorZoneMap = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const customerID = req.customer?._id || req.user?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Verify vendor ownership
    const vendor = await temporaryTransporterModel.findOne({
      _id: vendorId,
      customerID: customerID,
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found or access denied",
      });
    }

    // Parse query params
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit) || 100));
    const skip = (page - 1) * limit;

    // Build filter
    const filter = { vendorId, isActive: true };
    
    if (req.query.zone) {
      filter.zone = req.query.zone.toString().toUpperCase();
    }
    
    if (req.query.isOda !== undefined) {
      filter.isOda = req.query.isOda === 'true';
    }
    
    if (req.query.search) {
      const searchTerm = req.query.search.toString().trim();
      filter.pincode = { $regex: `^${searchTerm}`, $options: 'i' };
    }

    // Execute queries
    const [mappings, total, stats] = await Promise.all([
      VendorZoneMapping.find(filter)
        .select('pincode zone isOda state city zoneDisplayName createdAt')
        .sort({ pincode: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      VendorZoneMapping.countDocuments(filter),
      VendorZoneMapping.getVendorStats(vendorId),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        vendorId,
        vendorName: vendor.companyName,
        mappings,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
        stats,
      },
    });

  } catch (error) {
    console.error("[VendorZoneMap] Get error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve zone mappings",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * ============================================================================
 * GET VENDOR ZONES LIST
 * ============================================================================
 * GET /api/vendor/:vendorId/zones
 * 
 * Returns unique list of zones for the vendor
 */
export const getVendorZones = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const customerID = req.customer?._id || req.user?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Verify vendor ownership
    const vendor = await temporaryTransporterModel.findOne({
      _id: vendorId,
      customerID: customerID,
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found or access denied",
      });
    }

    const zones = await VendorZoneMapping.getVendorZones(vendorId);

    return res.status(200).json({
      success: true,
      data: {
        vendorId,
        vendorName: vendor.companyName,
        zones,
        count: zones.length,
      },
    });

  } catch (error) {
    console.error("[VendorZoneMap] Get zones error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve zones",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * ============================================================================
 * DELETE VENDOR ZONE MAPPINGS
 * ============================================================================
 * DELETE /api/vendor/:vendorId/zone-map
 * 
 * Deletes all zone mappings for a vendor
 */
export const deleteVendorZoneMap = async (req, res) => {
  try {
    const { vendorId } = req.params;
    const customerID = req.customer?._id || req.user?._id;

    if (!customerID) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Verify vendor ownership
    const vendor = await temporaryTransporterModel.findOne({
      _id: vendorId,
      customerID: customerID,
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found or access denied",
      });
    }

    const deletedCount = await VendorZoneMapping.deleteVendorMappings(vendorId);

    return res.status(200).json({
      success: true,
      message: "Zone mappings deleted successfully",
      data: {
        vendorId,
        vendorName: vendor.companyName,
        deletedCount,
      },
    });

  } catch (error) {
    console.error("[VendorZoneMap] Delete error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete zone mappings",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/**
 * ============================================================================
 * LOOKUP ZONE FOR PINCODE (TESTING ENDPOINT)
 * ============================================================================
 * GET /api/vendor/:vendorId/zone-lookup/:pincode
 * 
 * Test endpoint to check zone for a specific pincode
 */
export const lookupZone = async (req, res) => {
  try {
    const { vendorId, pincode } = req.params;

    const mapping = await VendorZoneMapping.findZoneForPincode(vendorId, pincode);

    if (!mapping) {
      return res.status(404).json({
        success: false,
        message: "No zone mapping found for this pincode",
        data: { vendorId, pincode },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        vendorId,
        pincode,
        ...mapping,
      },
    });

  } catch (error) {
    console.error("[VendorZoneMap] Lookup error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to lookup zone",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};