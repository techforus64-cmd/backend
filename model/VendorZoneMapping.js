// backend/model/VendorZoneMapping.js
import mongoose from "mongoose";

/**
 * VendorZoneMapping Schema
 * 
 * Purpose: Store vendor-specific pincode-to-zone mappings
 * This allows each vendor to define their own zone structure
 * independently of the global zone mapping.
 * 
 * Performance Optimizations:
 * - Compound index on (vendorId, pincode) for O(1) lookup
 * - Lean queries recommended for read operations
 * - Bulk operations for efficient data loading
 */

const vendorZoneMappingSchema = new mongoose.Schema(
  {
    // Reference to the vendor (temporaryTransporter or main transporter)
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true, // Indexed for vendor-specific queries
      ref: "temporaryTransporters", // Can also reference "transporters"
    },

    // The pincode (stored as both String and Number for flexibility)
    pincode: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function(v) {
          // Must be exactly 6 digits
          return /^[1-9]\d{5}$/.test(v);
        },
        message: props => `${props.value} is not a valid 6-digit pincode!`
      }
    },

    // Numeric pincode for faster lookups if needed
    pincodeNum: {
      type: Number,
      required: true,
      min: 100000,
      max: 999999,
    },

    // Zone code (e.g., "NE1", "WB1", "METRO-DEL")
    zone: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 20,
    },

    // Is this pincode in an Out of Delivery Area (ODA)?
    isOda: {
      type: Boolean,
      default: false,
      index: true, // Indexed for ODA filtering
    },

    // Optional: Zone display name for UI purposes
    zoneDisplayName: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    // Optional: State/City for reference (not used in pricing logic)
    state: {
      type: String,
      trim: true,
      maxlength: 50,
    },

    city: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    // Track who uploaded this mapping
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "customers",
    },

    // Source of this mapping (manual, csv, api)
    source: {
      type: String,
      enum: ['manual', 'csv', 'api', 'system'],
      default: 'csv',
    },

    // Enable/disable specific mappings without deletion
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    strict: true,
  }
);

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================

// CRITICAL: Compound index for ultra-fast lookups during pricing
// This makes the query: VendorZoneMapping.findOne({ vendorId, pincode }) lightning fast
vendorZoneMappingSchema.index({ vendorId: 1, pincode: 1 }, { unique: true });

// Additional useful indexes
vendorZoneMappingSchema.index({ vendorId: 1, zone: 1 }); // For zone-based filtering
vendorZoneMappingSchema.index({ vendorId: 1, isOda: 1 }); // For ODA reports
vendorZoneMappingSchema.index({ pincodeNum: 1 }); // For numeric pincode queries
vendorZoneMappingSchema.index({ isActive: 1, vendorId: 1 }); // For active mappings

// ============================================================================
// VIRTUAL FIELDS
// ============================================================================

// Virtual to get full pincode info as an object
vendorZoneMappingSchema.virtual('pincodeInfo').get(function() {
  return {
    pincode: this.pincode,
    zone: this.zone,
    isOda: this.isOda,
    state: this.state,
    city: this.city,
  };
});

// ============================================================================
// INSTANCE METHODS
// ============================================================================

/**
 * Check if this pincode is serviceable
 */
vendorZoneMappingSchema.methods.isServiceable = function() {
  return this.isActive && Boolean(this.zone);
};

/**
 * Get zone with ODA flag
 */
vendorZoneMappingSchema.methods.getZoneDetails = function() {
  return {
    zone: this.zone,
    isOda: this.isOda,
    zoneDisplayName: this.zoneDisplayName || this.zone,
  };
};

// ============================================================================
// STATIC METHODS FOR BULK OPERATIONS
// ============================================================================

/**
 * Bulk upsert zone mappings for a vendor
 * @param {String} vendorId - Vendor ObjectId
 * @param {Array} mappings - Array of { pincode, zone, isOda?, state?, city? }
 * @returns {Object} { inserted, updated, errors }
 */
vendorZoneMappingSchema.statics.bulkUpsertMappings = async function(vendorId, mappings) {
  const operations = [];
  const errors = [];
  let inserted = 0;
  let updated = 0;

  for (const mapping of mappings) {
    try {
      // Validate pincode format
      const pincode = String(mapping.pincode).trim();
      if (!/^[1-9]\d{5}$/.test(pincode)) {
        errors.push({ pincode, error: 'Invalid pincode format' });
        continue;
      }

      // Validate zone
      if (!mapping.zone || typeof mapping.zone !== 'string') {
        errors.push({ pincode, error: 'Zone is required' });
        continue;
      }

      const pincodeNum = parseInt(pincode, 10);
      const zone = mapping.zone.toString().trim().toUpperCase();

      operations.push({
        updateOne: {
          filter: { vendorId, pincode },
          update: {
            $set: {
              vendorId,
              pincode,
              pincodeNum,
              zone,
              isOda: Boolean(mapping.isOda),
              state: mapping.state || null,
              city: mapping.city || null,
              zoneDisplayName: mapping.zoneDisplayName || zone,
              isActive: true,
              source: mapping.source || 'csv',
            },
            $setOnInsert: {
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    } catch (err) {
      errors.push({ 
        pincode: mapping.pincode, 
        error: err.message 
      });
    }
  }

  if (operations.length > 0) {
    try {
      const result = await this.bulkWrite(operations, { ordered: false });
      inserted = result.upsertedCount || 0;
      updated = result.modifiedCount || 0;
    } catch (bulkError) {
      // Some operations may have succeeded
      console.error('Bulk write error:', bulkError);
      errors.push({ 
        error: 'Bulk write partially failed',
        details: bulkError.message 
      });
    }
  }

  return { inserted, updated, errors, total: mappings.length };
};

/**
 * Find zone for a pincode (vendor-specific)
 * @param {String} vendorId - Vendor ObjectId
 * @param {String} pincode - 6-digit pincode
 * @returns {Object|null} - { zone, isOda } or null
 */
vendorZoneMappingSchema.statics.findZoneForPincode = async function(vendorId, pincode) {
  const mapping = await this.findOne(
    { 
      vendorId, 
      pincode: String(pincode).trim(),
      isActive: true 
    },
    { zone: 1, isOda: 1, zoneDisplayName: 1, _id: 0 }
  ).lean();

  return mapping;
};

/**
 * Get all zones for a vendor
 * @param {String} vendorId - Vendor ObjectId
 * @returns {Array} - Unique list of zone codes
 */
vendorZoneMappingSchema.statics.getVendorZones = async function(vendorId) {
  const zones = await this.distinct('zone', { 
    vendorId, 
    isActive: true 
  });
  return zones.sort();
};

/**
 * Count mappings for a vendor
 * @param {String} vendorId - Vendor ObjectId
 * @returns {Object} - { total, oda, active }
 */
vendorZoneMappingSchema.statics.getVendorStats = async function(vendorId) {
  const [total, oda, active] = await Promise.all([
    this.countDocuments({ vendorId }),
    this.countDocuments({ vendorId, isOda: true }),
    this.countDocuments({ vendorId, isActive: true }),
  ]);

  return { total, oda, active };
};

/**
 * Delete all mappings for a vendor
 * @param {String} vendorId - Vendor ObjectId
 * @returns {Number} - Count of deleted documents
 */
vendorZoneMappingSchema.statics.deleteVendorMappings = async function(vendorId) {
  const result = await this.deleteMany({ vendorId });
  return result.deletedCount || 0;
};

// ============================================================================
// PRE-SAVE HOOK
// ============================================================================

vendorZoneMappingSchema.pre('save', function(next) {
  // Ensure pincodeNum is set
  if (this.pincode && !this.pincodeNum) {
    this.pincodeNum = parseInt(this.pincode, 10);
  }

  // Ensure zone is uppercase
  if (this.zone) {
    this.zone = this.zone.toUpperCase();
  }

  next();
});

// ============================================================================
// EXPORT MODEL
// ============================================================================

export default mongoose.model("VendorZoneMapping", vendorZoneMappingSchema);