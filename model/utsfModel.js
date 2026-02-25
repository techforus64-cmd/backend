import mongoose from "mongoose";

/**
 * UTSF Model - Universal Transporter Save Format
 *
 * Uses Schema.Types.Mixed for all complex nested fields (serviceability, zoneRates,
 * oda, priceRate, etc.) so Mongoose never strips or coerces their contents.
 *
 * Key design decisions:
 *  - strict: false  → root document accepts any extra UTSF fields added in future versions
 *  - minimize: false → Mongoose will NOT delete empty objects like exceptRanges: []
 *  - Mixed fields   → exact JSON in, exact JSON out — no Map conversion needed
 *  - pre-save hook  → marks all Mixed paths as modified before every save, so
 *                     Object.assign() updates are always persisted correctly
 */

const utsfSchema = new mongoose.Schema({

  version: {
    type: String,
    required: true,
    default: "2.0"
  },

  generatedAt: {
    type: Date,
    default: Date.now
  },

  sourceFormat: {
    type: String,
    enum: ["mongodb", "manual", "imported", "webapp"],
    default: "mongodb"
  },

  // ── Meta ────────────────────────────────────────────────────────────────────
  meta: {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    companyName: {
      type: String,
      required: true,
      index: true
    },
    vendorCode:  String,
    customerID:  String,
    transporterType: {
      type: String,
      enum: ["regular", "temporary"],
      default: "regular"
    },
    transportMode: {
      type: String,
      enum: ["LTL", "FTL", "PTL", "AIR", "RAIL", "road", "air", "rail", "ship"],
      default: "LTL"
    },
    gstNo:   String,
    address: String,
    state:   String,
    city:    String,
    pincode: String,
    rating: {
      type: Number,
      default: 4.0,
      min: 0,
      max: 5
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved"
    },
    createdAt: Date,
    updatedAt: Date,
    // v3.0 Governance Headers
    created: {
      by:     { type: String, default: 'UNKNOWN' },
      at:     { type: Date,   default: Date.now },
      source: {
        type: String,
        enum: ['FE', 'Python', 'Admin', 'SYSTEM_REPAIR_BOT', 'UNKNOWN'],
        default: 'UNKNOWN'
      }
    },
    version:     { type: String, default: '3.0.0' },
    updateCount: { type: Number, default: 0 },
    integrityMode: { type: String, default: null }
  },

  // ── v3.0 Audit Trail ────────────────────────────────────────────────────────
  // Mixed so any future audit fields are stored without schema validation errors
  updates: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },

  // ── v3.0 Zone Overrides: pincode -> transporter zone ────────────────────────
  // Mixed instead of Map<String> so numeric pincode keys aren't coerced/dropped
  zoneOverrides: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // ── Pricing ─────────────────────────────────────────────────────────────────
  pricing: {
    // Mixed: priceRate carries fuel, fuelMax, surcharges[], minTotalCharges, etc.
    // A strict sub-schema would silently drop any key not declared above.
    priceRate: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    // Mixed: nested origin->dest->rate matrices; Mongoose Map-of-Maps is lossy
    zoneRates: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {}
    }
  },

  // ── Serviceability per zone ──────────────────────────────────────────────────
  // Mixed: each zone entry has mode, exceptRanges, exceptSingles, servedRanges,
  // servedSingles, softExclusions — all optional and schema-version-dependent.
  // Mongoose Map-of-Objects drops keys whose sub-schema doesn't list them.
  serviceability: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // ── ODA per zone ─────────────────────────────────────────────────────────────
  oda: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // ── Zone Discrepancies ───────────────────────────────────────────────────────
  zoneDiscrepancies: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // ── Statistics ───────────────────────────────────────────────────────────────
  stats: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }

}, {
  timestamps: true,
  strict: false,   // Accept any extra top-level UTSF keys (future-proofing)
  minimize: false  // Never delete empty objects/arrays (e.g. exceptRanges: [])
});

// ── Indexes ───────────────────────────────────────────────────────────────────
utsfSchema.index({ "meta.transporterType": 1 });
utsfSchema.index({ "meta.approvalStatus": 1 });
utsfSchema.index({ "meta.isVerified": 1 });

// ── Pre-save hook ─────────────────────────────────────────────────────────────
// Mongoose does NOT auto-detect mutations inside Mixed fields.
// Without markModified(), an Object.assign() update looks like "no change" and
// the save() call silently no-ops, leaving stale data in the DB.
utsfSchema.pre('save', function (next) {
  this.markModified('serviceability');
  this.markModified('oda');
  this.markModified('zoneOverrides');
  this.markModified('zoneDiscrepancies');
  this.markModified('stats');
  this.markModified('updates');
  this.markModified('pricing');
  this.markModified('pricing.priceRate');
  this.markModified('pricing.zoneRates');
  next();
});

// ── Virtuals ──────────────────────────────────────────────────────────────────
utsfSchema.virtual("companyName").get(function () {
  return this.meta?.companyName;
});

utsfSchema.virtual("transporterId").get(function () {
  return this.meta?.id;
});

// ── toUTSF ────────────────────────────────────────────────────────────────────
// Converts a Mongoose doc to a plain UTSF JSON object ready for the calculation
// engine. Because all complex fields are Mixed, toObject() returns them as plain
// JSON already — no Map iteration loops needed.
utsfSchema.methods.toUTSF = function () {
  const obj = this.toObject({ minimize: false });

  // Strip Mongo-internal fields
  delete obj._id;
  delete obj.__v;
  delete obj.createdAt;
  delete obj.updatedAt;

  console.log(`[UTSFModel] toUTSF: "${obj.meta?.companyName}" | serviceability zones=${Object.keys(obj.serviceability || {}).length} | zoneRates origins=${Object.keys(obj.pricing?.zoneRates || {}).length}`);

  return obj;
};

// ── Statics ───────────────────────────────────────────────────────────────────
utsfSchema.statics.fromUTSF = function (utsfData) {
  return new this(utsfData);
};

utsfSchema.statics.findByTransporterId = function (transporterId) {
  return this.findOne({ "meta.id": transporterId });
};

utsfSchema.statics.findByCompanyName = function (companyName) {
  return this.find({ "meta.companyName": new RegExp(companyName, "i") });
};

export default mongoose.model("utsf", utsfSchema);
