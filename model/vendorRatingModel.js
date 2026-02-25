/**
 * Vendor Rating Model
 *
 * Stores individual user ratings for vendors with 5-parameter breakdown.
 * Each rating captures: priceSupport, deliveryTime, tracking, salesSupport, damageLoss
 *
 * NOTE: Currently allows multiple ratings per user per vendor (development phase).
 * TODO: In future, add unique constraint on { vendorId, userId, vendorType }
 *       to allow only one rating per user per vendor.
 *
 * VENDOR TYPES:
 * - 'regular': Normal transporters from the Transporter collection
 * - 'temporary': Tied-up vendors from TemporaryTransporter collection
 * - 'special': Special vendors like Wheelseye FTL and LOCAL FTL (client-side injected)
 */

import mongoose from "mongoose";

/**
 * Special vendor IDs - these are string identifiers for client-side injected vendors
 * that don't exist in the database. Used for whitelist validation.
 */
export const SPECIAL_VENDOR_IDS = {
  WHEELSEYE_FTL: "wheelseye-ftl-transporter",
  LOCAL_FTL: "local-ftl-transporter",
};

/**
 * Check if a vendorId is a special vendor
 * @param {string} vendorId - The vendor ID to check
 * @returns {boolean} - True if it's a special vendor ID
 */
export const isSpecialVendorId = (vendorId) => {
  return Object.values(SPECIAL_VENDOR_IDS).includes(vendorId);
};

/**
 * Get special vendor name from ID
 * @param {string} vendorId - The vendor ID
 * @returns {string|null} - Vendor name or null if not a special vendor
 */
export const getSpecialVendorName = (vendorId) => {
  if (vendorId === SPECIAL_VENDOR_IDS.WHEELSEYE_FTL) return "Wheelseye FTL";
  if (vendorId === SPECIAL_VENDOR_IDS.LOCAL_FTL) return "LOCAL FTL";
  return null;
};

const vendorRatingSchema = new mongoose.Schema(
  {
    // Reference to the vendor being rated
    // For special vendors, this stores the string ID (e.g., "wheelseye-ftl-transporter")
    // For regular/temporary vendors, this stores the MongoDB ObjectId
    vendorId: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      index: true,
    },

    // Type of vendor: regular, temporary, or special
    // - 'regular': Normal transporters from Transporter collection
    // - 'temporary': Tied-up vendors from TemporaryTransporter collection
    // - 'special': Wheelseye FTL and LOCAL FTL (client-side injected)
    vendorType: {
      type: String,
      enum: ["regular", "temporary", "special"],
      required: true,
      default: "regular",
    },

    // DEPRECATED: Use vendorType instead. Kept for backward compatibility.
    // Maps: regular -> false, temporary -> true, special -> true
    isTemporaryVendor: {
      type: Boolean,
      required: false,
      default: false,
    },

    // User who submitted the rating (optional for now, can be added later)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "customers",
      default: null,
    },

    // Individual parameter ratings (1-5 scale, all required)
    ratings: {
      priceSupport: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
      },
      deliveryTime: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
      },
      tracking: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
      },
      salesSupport: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
      },
      damageLoss: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
      },
    },

    // Calculated overall rating (average of 5 parameters)
    overallRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    // Optional comment from the user
    comment: {
      type: String,
      maxlength: 500,
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes for efficient queries
vendorRatingSchema.index({ vendorId: 1, vendorType: 1 });
vendorRatingSchema.index({ vendorId: 1, isTemporaryVendor: 1 }); // Keep for backward compatibility
vendorRatingSchema.index({ createdAt: -1 });

// TODO: Uncomment this in future to enforce one rating per user per vendor
// vendorRatingSchema.index(
//   { vendorId: 1, userId: 1, vendorType: 1 },
//   { unique: true, sparse: true }
// );

export default mongoose.model("vendorRatings", vendorRatingSchema);
