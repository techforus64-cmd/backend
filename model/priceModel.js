import mongoose, { Schema } from "mongoose";

const ToZoneRatesSchema = new Schema(
  {},
  {
    _id: false,
    strict: false,
  }
);

const pricesSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "transporters",
      required: true,
    },
    priceRate: {
      minWeight: {
        type: Number,
        required: true,
        default: 0,
      },
      docketCharges: {
        type: Number,
        required: true,
        default: 0,
      },
      fuel: {
        type: Number,
        required: true,
        default: 0,
      },
      fuelMax: {
        type: Number,
        default: 0,
      },
      rovCharges: {
        variable: {
          type: Number,
          required: true,
          default: 0,
        },
        fixed: {
          type: Number,
          required: true,
          default: 0,
        },
      },
      insuaranceCharges: {
        variable: {
          type: Number,
          required: true,
          default: 0,
        },
        fixed: {
          type: Number,
          required: true,
          default: 0,
        },
      },
      odaCharges: {
        variable: {
          type: Number,
          required: true,
          default: 0,
        },
        fixed: {
          type: Number,
          required: true,
          default: 0,
        },
        thresholdWeight: {
          type: Number,
          default: 0,
        },
        mode: {
          type: String,
          enum: ['legacy', 'switch', 'excess'],
          default: 'legacy',
        },
      },
      codCharges: {
        variable: {
          type: Number,
          required: true,
          default: 0,
        },
        fixed: {
          type: Number,
          required: true,
          default: 0,
        },
      },
      prepaidCharges: {
        variable: {
          type: Number,
          required: true,
          default: 0,
        },
        fixed: {
          type: Number,
          required: true,
          default: 0,
        },
      },
      topayCharges: {
        variable: {
          type: Number,
          required: true,
          default: 0,
        },
        fixed: {
          type: Number,
          required: true,
          default: 0,
        },
      },
      handlingCharges: {
        variable: {
          type: Number,
          required: true,
          default: 0,
        },
        fixed: {
          type: Number,
          required: true,
          default: 0,
        },
        threshholdweight: {
          type: Number,
          required: true,
          default: 0,
        },
      },
      fmCharges: {
        variable: {
          type: Number,
          required: true,
          default: 0,
        },
        fixed: {
          type: Number,
          required: true,
          default: 0,
        },
      },
      appointmentCharges: {
        variable: {
          type: Number,
          required: true,
          default: 0,
        },
        fixed: {
          type: Number,
          required: true,
          default: 0,
        },
      },
      divisor: {
        type: Number,
        required: true,
        default: 1,
      },
      // NEW: kFactor overrides or falls back to divisor for volumetric calculations
      kFactor: {
        type: Number,
        required: true,
        default: function () {
          return this.divisor;
        },
      },
      minCharges: {
        type: Number,
        required: true,
        default: 0,
      },
      greenTax: {
        type: Number,
        required: true,
        default: 0,
      },
      daccCharges: {
        type: Number,
        required: true,
        default: 0,
      },
      miscellanousCharges: {
        type: Number,
        required: true,
        default: 0,
      },

      // ─── Custom / carrier-specific surcharges ───────────────────────────────
      // Supports any number of extra charges that the standard fields cannot express.
      // Formula types:
      //   PCT_OF_BASE      → (value/100) × baseFreight
      //   PCT_OF_SUBTOTAL  → (value/100) × running subtotal after standard charges
      //   FLAT             → fixed ₹ per shipment
      //   PER_KG           → value × chargeableWeight
      //   MAX_FLAT_PKG     → max(value, value2 × chargeableWeight)
      surcharges: [{
        _id: false,
        id:      { type: String, required: true },
        label:   { type: String, required: true },
        formula: { type: String, enum: ['PCT_OF_BASE', 'PCT_OF_SUBTOTAL', 'FLAT', 'PER_KG', 'MAX_FLAT_PKG'], required: true },
        value:   { type: Number, default: 0 },
        value2:  { type: Number, default: 0 }, // only for MAX_FLAT_PKG
        order:   { type: Number, default: 99 },
        enabled: { type: Boolean, default: true },
      }],
    },
    zoneRates: {
      type: Map,
      of: ToZoneRatesSchema,
      required: true,
    },
  },
  { timestamps: true }
);

// Database indexes for query performance
pricesSchema.index({ companyId: 1 }); // Critical: Enables fast lookups by vendor ID

export default mongoose.model("prices", pricesSchema);
