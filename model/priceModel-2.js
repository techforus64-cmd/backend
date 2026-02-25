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
    },
    zoneRates: {
      type: Map,
      of: ToZoneRatesSchema,
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("prices", pricesSchema);
