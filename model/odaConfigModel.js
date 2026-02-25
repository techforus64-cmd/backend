import mongoose from "mongoose";

const odaConfigSchema = new mongoose.Schema(
  {
    customerID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "customers",
      required: true,
      index: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "temporaryTransporters", // Matches model name in temporaryTransporterModel.js
      index: true,
    },
    distanceWeightMatrix: [
      {
        weightRange: {
          type: String,
          required: true,
        },
        distanceRange: {
          type: String,
          required: true,
        },
        price: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],
    odaEntries: [
      {
        pincode: {
          type: String,
          required: true,
          match: /^\d{6}$/, // 6-digit pincode validation
        },
        isOda: {
          type: Boolean,
          default: false,
        },
        zone: {
          type: String,
          required: true,
        },
      },
    ],
    weightRanges: [String], // Array of weight range labels
    distanceRanges: [String], // Array of distance range labels
    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Compound index for faster queries
odaConfigSchema.index({ customerID: 1, vendorId: 1 });

export default mongoose.model("odaConfigs", odaConfigSchema);

