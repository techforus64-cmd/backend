

import mongoose from "mongoose";

const temporaryTransporterModel = new mongoose.Schema(
  {
    customerID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "customers",
      required: true,
    },
    companyName: {
      type: String,
      required: true,
    },
    vendorCode: {
      type: String,
      required: true,
    },
    // APPROVAL: Whether vendor can appear in search results
    // Flow: pending → approved/rejected (by admin)
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected", "draft"],
      default: "approved",
    },
    // VERIFICATION: Manual trust indicator (separate from approval!)
    // Default is FALSE - admin must explicitly mark as verified
    // UI Logic: isVerified===true → green badge, else → yellow badge
    // ⚠️ DO NOT confuse with approvalStatus - these are independent
    isVerified: {
      type: Boolean,
      required: true,
    },
    vendorEmail: {
      type: String,
      required: true,
    },
    gstNo: {
      type: String,
      required: true,
    },
    transportMode: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      required: true,
    },
    pincode: {
      type: Number,
      required: true,
    },
    city: {
      type: String,
      default: "",
    },
    rating: {
      type: Number,
      default: 3,
    },
    // Total number of ratings received (for display purposes)
    totalRatings: {
      type: Number,
      default: 0,
    },
    // Individual vendor rating parameters (1-5 scale each)
    vendorRatings: {
      priceSupport: {
        type: Number,
        min: 0,
        max: 5,
        default: 0,
      },
      deliveryTime: {
        type: Number,
        min: 0,
        max: 5,
        default: 0,
      },
      tracking: {
        type: Number,
        min: 0,
        max: 5,
        default: 0,
      },
      salesSupport: {
        type: Number,
        min: 0,
        max: 5,
        default: 0,
      },
      damageLoss: {
        type: Number,
        min: 0,
        max: 5,
        default: 0,
      },
    },
    googleReviewUrl: {
      type: String,
      default: "",
    },
    googleReviewRating: {
      type: Number,
      default: null,
    },
    subVendor: {
      type: String,
      default: "",
    },
    // NEW: Contact person name for autofill
    contactPersonName: {
      type: String,
      default: "",
    },
    // NEW: Service mode (FTL, LTL, PTL, etc.)
    serviceMode: {
      type: String,
      enum: ['FTL', 'LTL', 'PTL', ''],
      default: "",
    },
    // NEW: Volumetric unit (cm, in, inches)
    volumetricUnit: {
      type: String,
      default: "cm",
    },
    // NEW: CFT factor
    cftFactor: {
      type: Number,
      default: null,
    },
    selectedZones: [{
      type: String,
    }],
    // Zone config: compact format { N1: ["201301","201302"], N2: ["110001"] }
    // Maps zone code to array of pincodes assigned to that zone by user
    zoneConfig: {
      type: Map,
      of: [String],
      default: {},
    },
    // NEW: Pincode-authoritative serviceability array
    // This is the CANONICAL source of truth for which pincodes this vendor services
    // Each entry contains: { pincode, zone (auto-assigned), state, city, isODA, active }
    serviceability: [{
      pincode: { type: String, required: true },
      zone: { type: String, required: true },
      state: { type: String, default: '' },
      city: { type: String, default: '' },
      isODA: { type: Boolean, default: false },
      active: { type: Boolean, default: true },
    }],
    // Checksum for serviceability data (for detecting changes)
    serviceabilityChecksum: {
      type: String,
      default: '',
    },
    // Source of serviceability: 'excel', 'manual', 'cloned', 'wizard'
    serviceabilitySource: {
      type: String,
      enum: ['excel', 'manual', 'cloned', 'wizard', ''],
      default: '',
    },
    prices: {
      priceRate: {
        minWeight: {
          type: Number,
          default: 0,
        },
        docketCharges: {
          type: Number,
          default: 0,
        },
        fuel: {
          type: Number,
          default: 0,
        },
        rovCharges: {
          variable: {
            type: Number,
            default: 0,
          },
          fixed: {
            type: Number,
            default: 0,
          },
          unit: {
            type: String,
            enum: ['per kg', 'per shipment', 'per piece', 'per box'],
            default: 'per kg',
          },
        },
        insuaranceCharges: {
          variable: {
            type: Number,
            default: 0,
          },
          fixed: {
            type: Number,
            default: 0,
          },
          unit: {
            type: String,
            enum: ['per kg', 'per shipment', 'per piece', 'per box'],
            default: 'per kg',
          },
        },
        odaCharges: {
          variable: {
            type: Number,
            default: 0,
          },
          fixed: {
            type: Number,
            default: 0,
          },
          unit: {
            type: String,
            enum: ['per kg', 'per shipment', 'per piece', 'per box'],
            default: 'per kg',
          },
        },
        codCharges: {
          variable: {
            type: Number,
            default: 0,
          },
          fixed: {
            type: Number,
            default: 0,
          },
          unit: {
            type: String,
            enum: ['per kg', 'per shipment', 'per piece', 'per box'],
            default: 'per kg',
          },
        },
        prepaidCharges: {
          variable: {
            type: Number,
            default: 0,
          },
          fixed: {
            type: Number,
            default: 0,
          },
          unit: {
            type: String,
            enum: ['per kg', 'per shipment', 'per piece', 'per box'],
            default: 'per kg',
          },
        },
        topayCharges: {
          variable: {
            type: Number,
            default: 0,
          },
          fixed: {
            type: Number,
            default: 0,
          },
          unit: {
            type: String,
            enum: ['per kg', 'per shipment', 'per piece', 'per box'],
            default: 'per kg',
          },
        },
        handlingCharges: {
          variable: {
            type: Number,
            default: 0,
          },
          fixed: {
            type: Number,
            default: 0,
          },
          unit: {
            type: String,
            enum: ['per kg', 'per shipment', 'per piece', 'per box'],
            default: 'per kg',
          },
        },
        fmCharges: {
          variable: {
            type: Number,
            default: 0,
          },
          fixed: {
            type: Number,
            default: 0,
          },
          unit: {
            type: String,
            enum: ['per kg', 'per shipment', 'per piece', 'per box'],
            default: 'per kg',
          },
        },
        appointmentCharges: {
          variable: {
            type: Number,
            default: 0,
          },
          fixed: {
            type: Number,
            default: 0,
          },
          unit: {
            type: String,
            enum: ['per kg', 'per shipment', 'per piece', 'per box'],
            default: 'per kg',
          },
        },
        divisor: {
          type: Number,
          default: 5000,  // Standard volumetric divisor for cm³ to kg conversion
        },
        minCharges: {
          type: Number,
          default: 0,
        },
        greenTax: {
          type: Number,
          default: 0,
        },
        daccCharges: {
          type: Number,
          default: 0,
        },
        miscellanousCharges: {
          type: Number,
          default: 0,
        },
      },
      priceChart: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      },
      invoiceValueCharges: {
        enabled: { type: Boolean, default: false },
        percentage: { type: Number, min: 0, max: 100, default: 0 },
        minimumAmount: { type: Number, min: 0, default: 0 },
        description: { type: String, default: 'Invoice Value Handling Charges' },
      },

      // ─── Custom / carrier-specific surcharges ───────────────────────────────
      surcharges: [{
        _id: false,
        id:      { type: String, required: true },
        label:   { type: String, required: true },
        formula: { type: String, enum: ['PCT_OF_BASE', 'PCT_OF_SUBTOTAL', 'FLAT', 'PER_KG', 'MAX_FLAT_PKG'], required: true },
        value:   { type: Number, default: 0 },
        value2:  { type: Number, default: 0 },
        order:   { type: Number, default: 99 },
        enabled: { type: Boolean, default: true },
      }],
    },
  },
  { timestamps: true, strict: true }
);

// Database indexes for query performance
temporaryTransporterModel.index({ customerID: 1 }); // Fast customer lookups
temporaryTransporterModel.index({ customerID: 1, approvalStatus: 1 }); // Compound index for filtered queries

export default mongoose.model(
  "temporaryTransporters",
  temporaryTransporterModel
);